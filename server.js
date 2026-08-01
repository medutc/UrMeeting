


// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const nodemailer = require('nodemailer');
const db = require('./db');

const app = express();
app.set('trust proxy', 1); // we run behind Railway/Render's HTTPS-terminating reverse proxy
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;

// ---------- File upload setup (for direct messages: images, videos, any file) ----------
// In production, point UPLOAD_DIR at a persistent volume so uploads survive redeployments.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}-${safeName}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

// ---------- Email setup (uses environment variables for security) ----------
// Pick ONE delivery path on Render:
//
//   A. TRUE GMAIL (recommended if the meeting invitations must literally come
//      from your Gmail address):
//      Set GMAIL_REFRESH_TOKEN + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET +
//      GMAIL_FROM_ADDRESS. Uses Google Gmail API over HTTPS — the ONLY way Gmail
//      actually works on Render (Render blocks the raw SMTP ports Gmail would
//      normally use).
//      Setup: see the README / the comment block on sendViaGmailApi() below.
//
//   B. HTTPS provider (Brevo / SendGrid / Resend). Free tiers, works on Render,
//      deliver to Gmail inboxes. EMAIL_FROM is the sender address (verify it at
//      the provider first). You can verify your own Gmail there so invitations
//      still appear "from" your Gmail even though the relay is HTTPS.
//
//   C. Gmail SMTP on port 465 (legacy / local dev only). Pass GMAIL_USER +
//      GMAIL_PASSWORD. GMAIL_PASSWORD MUST be a 16-char App Password, not your
//      normal Gmail login. On Render this WILL time out and fall through to the
//      next provider — it is kept here only so you can run tests on your
//      laptop and so any partial setup still fails fast and loudly.
//
//   D. Generic SMTP. Set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS.
const emailConfig = {
  smtp: {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  }
};

const emailTransporter = (() => {
  if (process.env.GMAIL_USER && process.env.GMAIL_PASSWORD) {
    // Force smtp.gmail.com:465 with TLS-on-connect (secure:true). This is the
    // most reliable Gmail SMTP config and matches what nodemailer resolves the
    // shortcut `service: 'gmail'` to anyway. We pin it explicitly so it's
    // obvious in the code and the console. Tight timeouts make Render block
    // failures show up in logs within ~10s rather than the 60s+ nodemailer
    // default.
    console.log(`[EMAIL] Gmail SMTP transporter enabled for ${process.env.GMAIL_USER} on smtp.gmail.com:465`);
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASSWORD
      },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 15000,
      tls: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: process.env.GMAIL_TLS_REJECT_UNAUTHORIZED !== 'false'
      }
    });
  } else if (process.env.SMTP_HOST) {
    return nodemailer.createTransport(emailConfig.smtp);
  }
  return null; // Email disabled if nothing is configured (still allowed via HTTPS providers)
})();

// ============================================================
// Gmail API via HTTPS — the ONLY real-Gmail delivery path that works on Render.
//
// Render (and Railway / Heroku free tier) block the raw SMTP ports Gmail uses,
// so `GMAIL_USER + GMAIL_PASSWORD` will silently time out from a Render deploy.
// The Gmail API uses gmail.googleapis.com over plain HTTPS, which Render never
// blocks. We exchange a long-lived OAuth2 refresh token for a short access
// token at send time, then POST the email to the REST endpoint. The sender
// address is the Gmail account that owns the project's OAuth client.
//
// ONE-TIME SETUP (in your Google account / GCP project):
//   1. Go to https://console.cloud.google.com and create a project.
//   2. APIs & Services > Library > search "Gmail API" > Enable.
//   3. APIs & Services > OAuth consent screen > External > fill in app name +
//      your email > add your email under "Test users" > Save.
//   4. APIs & Services > Credentials > Create Credentials > OAuth client ID >
//      Application type = "Web application". Authorized redirect URI =
//      http://localhost:3000 (we won't actually hit it from a browser, but
//      Google requires one). Save and copy Client ID + Client Secret.
//   5. Get a refresh token. Easiest path (run locally once):
//        git clone this repo, then:
//        npm i google-auth-library
//        node -e "const {OAuth2Client}=require('google-auth-library'); \
//          const o=new OAuth2Client( \
//            process.env.GMAIL_CLIENT_ID,process.env.GMAIL_CLIENT_SECRET, \
//            'http://localhost:3000'); \
//          console.log(o.generateAuthUrl({ \
//            access_type:'offline',prompt:'consent', \
//            scope:['https://www.googleapis.com/auth/gmail.send']}))"
//      Open the printed URL in a browser, sign in with the Gmail you want to
//      send FROM, grant, get redirected to localhost with ?code=.... Then:
//        node -e "const {OAuth2Client}=require('google-auth-library'); \
//          const o=new OAuth2Client(process.env.GMAIL_CLIENT_ID, \
//            process.env.GMAIL_CLIENT_SECRET,'http://localhost:3000'); \
//          o.getToken('PASTE_CODE_HERE', (e,t)=>{ \
//            if(e)return console.error(e);console.log(t.refresh_token);})"
//   6. Set these Render env vars:
//        GMAIL_CLIENT_ID       = ...apps.googleusercontent.com
//        GMAIL_CLIENT_SECRET   = ...
//        GMAIL_REFRESH_TOKEN   = the long refresh_token from step 5
//        GMAIL_FROM_ADDRESS    = the Gmail address you granted in step 5
//        EMAIL_FROM_NAME       = (optional) "UrMeeting"
//
// Returns true on success, null when not configured (lets callers fall
// through), throws on failure (lets callers log the real error).
async function sendViaGmailApi(toEmail, toName, subject, html) {
  if (!process.env.GMAIL_REFRESH_TOKEN || !process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    return null; // not configured, caller will fall back to other providers
  }
  const fromEmail = process.env.GMAIL_FROM_ADDRESS || process.env.GMAIL_USER;
  if (!fromEmail) {
    throw new Error('GMAIL_FROM_ADDRESS is missing (the Gmail account that owns the refresh token).');
  }
  const fromName = process.env.EMAIL_FROM_NAME || 'UrMeeting';

  // 1) Exchange refresh_token -> short-lived access_token via Google's HTTPS
  //    OAuth2 endpoint. Plain fetch, no extra dependencies.
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    }).toString()
  });
  if (!tokenResp.ok) {
    const errText = await tokenResp.text().catch(() => tokenResp.statusText);
    throw new Error(`Gmail OAuth2 token exchange failed (${tokenResp.status}): ${errText}`);
  }
  const tokenBody = await tokenResp.json();
  const accessToken = tokenBody.access_token;
  if (!accessToken) {
    throw new Error('Gmail OAuth2 token endpoint returned no access_token: ' + JSON.stringify(tokenBody));
  }

  // 2) Build a raw RFC822 message and base64url-encode it (Gmail's REST send
  //    endpoint accepts any MIME-encodable content; raw is the most compatible).
  const safeSubject = String(subject).replace(/\r?\n/g, ' ');
  const headers = [
    `From: ${fromName} <${fromEmail}>`,
    `To: ${toName ? `${String(toName).replace(/[<>]/g, '')} <${toEmail}>` : toEmail}`,
    `Subject: =?UTF-8?B?${Buffer.from(safeSubject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8'
  ].join('\r\n');
  const rawMessage = Buffer.from(headers + '\r\n\r\n' + html, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // 3) POST to gmail.googleapis.com (HTTPS). Works on Render.
  const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: rawMessage })
  });
  if (!sendResp.ok) {
    const errText = await sendResp.text().catch(() => sendResp.statusText);
    throw new Error(`Gmail API send failed (${sendResp.status}): ${errText}`);
  }
  return true;
}

// Railway (and many other PaaS hosts) block outbound SMTP ports (465/587) on
// their network, which makes Gmail/SMTP nodemailer connections time out even
// with correct credentials. Brevo (formerly Sendinblue) and Resend both send
// over plain HTTPS (port 443), which is never blocked, so we prefer them
// when their API keys are configured. Brevo is checked first since that's
// the provider this app is configured to use.
// Sign up free at https://www.brevo.com, verify a sender email/domain under
// Senders & IP, generate an API key under SMTP & API > API Keys, then set
// BREVO_API_KEY + EMAIL_FROM (must be a verified sender in Brevo).
async function sendViaBrevo(participantEmail, participantName, subject, html) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return null; // not configured, caller should fall back to other providers

  const fromEmail = process.env.EMAIL_FROM || process.env.BREVO_SENDER_EMAIL;
  if (!fromEmail) {
    throw new Error('BREVO_API_KEY is set but EMAIL_FROM (a verified Brevo sender email) is missing.');
  }
  const fromName = process.env.EMAIL_FROM_NAME || 'UrMeeting';

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: participantEmail, name: participantName || undefined }],
      subject,
      htmlContent: html
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Brevo API error (${response.status}): ${errText}`);
  }
  return true;
}

// SendGrid (HTTPS-based, port 443). No domain required — verify a single
// sender email under Settings > Sender Authentication > Single Sender
// Verification, then generate an API key under Settings > API Keys and set
// SENDGRID_API_KEY + EMAIL_FROM (must match the verified sender email).
async function sendViaSendGrid(participantEmail, participantName, subject, html) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return null; // not configured, caller should fall back to other providers

  const fromEmail = process.env.EMAIL_FROM || process.env.SENDGRID_SENDER_EMAIL;
  if (!fromEmail) {
    throw new Error('SENDGRID_API_KEY is set but EMAIL_FROM (your verified SendGrid sender email) is missing.');
  }
  const fromName = process.env.EMAIL_FROM_NAME || 'UrMeeting';

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: participantEmail, name: participantName || undefined }] }],
      from: { email: fromEmail, name: fromName },
      subject,
      content: [{ type: 'text/html', value: html }]
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`SendGrid API error (${response.status}): ${errText}`);
  }
  return true;
}

async function sendViaResend(participantEmail, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null; // not configured, caller should fall back to SMTP

  const from = process.env.EMAIL_FROM || 'UrMeeting <onboarding@resend.dev>';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from, to: [participantEmail], subject, html })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Resend API error (${response.status}): ${errText}`);
  }
  return true;
}

async function sendMeetingInviteEmail(participantEmail, participantName, meeting, creatorName) {
  // Treat Gmail API (when configured) as a "provider" too, so this guard fires
  // with the full list of HTTPS / Gmail paths you can enable.
  const anyProvider = process.env.BREVO_API_KEY || process.env.SENDGRID_API_KEY
    || process.env.RESEND_API_KEY || process.env.GMAIL_REFRESH_TOKEN
    || (process.env.GMAIL_USER && process.env.GMAIL_PASSWORD)
    || process.env.SMTP_HOST;
  if (!anyProvider) {
    console.log('[EMAIL DISABLED] No email provider configured. On Render, set GMAIL_REFRESH_TOKEN + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_FROM_ADDRESS (true Gmail via HTTPS) OR BREVO_API_KEY + EMAIL_FROM (HTTPS, 300 free/day).');
    return false;
  }

  const emailContent = `
    <h2>You're invited to a meeting!</h2>
    <p>Hi ${participantName},</p>
    <p><strong>${creatorName}</strong> has invited you to a meeting:</p>

    <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
      <h3 style="margin-top: 0;">${meeting.title}</h3>
      <p><strong>Description:</strong> ${meeting.description || '(No description provided)'}</p>
      <p><strong>Date:</strong> ${meeting.date}</p>
      <p><strong>Time:</strong> ${meeting.time}</p>
      <p><strong>Organizer:</strong> ${creatorName}</p>
    </div>

    <p><a href="${process.env.APP_URL || 'http://localhost:3000'}/meeting-room.html?id=${meeting.id}"
         style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
      Join Meeting
    </a></p>

    <p style="color: #666; font-size: 12px; margin-top: 32px;">
      This is an automated message from UrMeeting. Please do not reply to this email.
    </p>
  `;

  const subject = `Meeting Invitation: ${meeting.title}`;

  // 1) Gmail API (HTTPS, true Gmail delivery, works on Render). Checked first
  //    because if it's set, that's almost certainly what the user wants on
  //    Render and it bypasses the SMTP timeout trap entirely.
  if (process.env.GMAIL_REFRESH_TOKEN) {
    try {
      await sendViaGmailApi(participantEmail, participantName, subject, emailContent);
      console.log(`[EMAIL SENT via Gmail API] to ${participantEmail}`);
      return true;
    } catch (err) {
      console.error(`[EMAIL ERROR] Gmail API failed to send to ${participantEmail}:`, err.message);
      console.error('[EMAIL HINT] Check GMAIL_REFRESH_TOKEN + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_FROM_ADDRESS. The refresh token must be issued with access_type=offline + scope gmail.send.');
    }
  }

  // 2) Brevo (HTTPS). Works on Render.
  if (process.env.BREVO_API_KEY) {
    try {
      await sendViaBrevo(participantEmail, participantName, subject, emailContent);
      console.log(`[EMAIL SENT via Brevo] to ${participantEmail}`);
      return true;
    } catch (err) {
      console.error(`[EMAIL ERROR] Brevo failed to send to ${participantEmail}:`, err.message);
    }
  }

  // 3) SendGrid (HTTPS). Works on Render.
  if (process.env.SENDGRID_API_KEY) {
    try {
      await sendViaSendGrid(participantEmail, participantName, subject, emailContent);
      console.log(`[EMAIL SENT via SendGrid] to ${participantEmail}`);
      return true;
    } catch (err) {
      console.error(`[EMAIL ERROR] SendGrid failed to send to ${participantEmail}:`, err.message);
    }
  }

  // 4) Resend (HTTPS). Works on Render.
  if (process.env.RESEND_API_KEY) {
    try {
      await sendViaResend(participantEmail, subject, emailContent);
      console.log(`[EMAIL SENT via Resend] to ${participantEmail}`);
      return true;
    } catch (err) {
      console.error(`[EMAIL ERROR] Resend failed to send to ${participantEmail}:`, err.message);
      if (!emailTransporter) return false;
    }
  }

  // 5) SMTP (Gmail on 465 OR generic SMTP_HOST). On Render this almost always
  //    fails because Render blocks outbound SMTP. The transporter has tight
  //    timeouts so the failure shows up quickly with a clear hint.
  if (emailTransporter) {
    try {
      await emailTransporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.GMAIL_USER || process.env.SMTP_USER,
        to: participantEmail,
        subject,
        html: emailContent
      });
      console.log(`[EMAIL SENT via SMTP] to ${participantEmail}`);
      return true;
    } catch (err) {
      console.error(`[EMAIL ERROR] SMTP failed to send to ${participantEmail}:`, err.message);
      const msg = String(err && err.message || '');
      if (/timeout|ETIMEDOUT|ENOTFOUND|ENETUNREACH|Connection.*closed|EHOSTUNREACH/i.test(msg)) {
        console.error('[EMAIL HINT] Render/Railway/Heroku-free block outbound SMTP. Switch to GMAIL_REFRESH_TOKEN (true Gmail via HTTPS) or BREVO_API_KEY (HTTPS relay) — see README.');
      } else if (/Invalid login|Username and Password not accepted|535|534/i.test(msg)) {
        console.error('[EMAIL HINT] Gmail rejected the credentials. GMAIL_PASSWORD must be a 16-char App Password (Google Account > Security > 2-Step Verification > App passwords), NOT your normal Gmail password.');
      } else if (/self.signed certificate|TLS/i.test(msg) && process.env.GMAIL_USER) {
        console.error('[EMAIL HINT] TLS error to smtp.gmail.com. Try setting GMAIL_TLS_REJECT_UNAUTHORIZED=false or switching to GMAIL_REFRESH_TOKEN.');
      }
      return false;
    }
  }

  // HTTPS providers were tried but all failed above.
  if (process.env.BREVO_API_KEY || process.env.SENDGRID_API_KEY || process.env.RESEND_API_KEY || process.env.GMAIL_REFRESH_TOKEN) {
    return false;
  }
  return false;
}

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
// Serve uploaded files from UPLOAD_DIR (may live on a persistent volume in production)
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- Session store ----------
// Previously sessions lived only in express-session's default MemoryStore,
// which is wiped out every time the Node process restarts. Railway restarts
// (or sleeps/redeploys) the container far more often than a long-lived VM
// would, so every restart silently logged everyone out even though their
// cookie was still valid. Persisting sessions to disk (ideally on the same
// persistent volume as DATA_DIR/db.json) means a restart no longer forces
// a fresh login. The cookie itself is also extended to 30 days and set to
// "rolling" so it renews on every request instead of hard-expiring at a
// fixed 8-hour mark while someone is still actively using the app.
const SESSIONS_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const sessionMiddleware = session({
  store: new FileStore({ path: SESSIONS_DIR, logFn: () => {} }),
  secret: process.env.SESSION_SECRET || 'meeting-platform-secret-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true, // refresh the cookie's expiry on every request while the user is active
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    secure: process.env.NODE_ENV === 'production', // HTTPS-only in prod (trust proxy reads X-Forwarded-Proto)
    sameSite: 'lax'
  }
});
app.use(sessionMiddleware);
// Socket.IO must read the same signed-in session as the HTTP API. This prevents
// a client from claiming another user's ID when joining or moderating a room.
io.engine.use(sessionMiddleware);

// ---------- Helpers ----------
function sanitizeUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const user = db.get('users').find({ id: req.session.userId }).value();
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    }
    req.currentUser = user;
    next();
  };
}

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.get('users').find({ email: (email || '').toLowerCase().trim() }).value();
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const ok = bcrypt.compareSync(password || '', user.password);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  req.session.userId = user.id;
  res.json({ user: sanitizeUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireLogin, (req, res) => {
  const user = db.get('users').find({ id: req.session.userId }).value();
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ user: sanitizeUser(user) });
});

// WebRTC ICE servers — STUN for NAT discovery, TURN relays media when P2P fails (required on Railway).
function buildIceServers() {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  const turnUrl = process.env.TURN_URL;
  const turnUser = process.env.TURN_USERNAME;
  const turnCred = process.env.TURN_CREDENTIAL;
  if (turnUrl && turnUser && turnCred) {
    turnUrl.split(',').map(u => u.trim()).filter(Boolean).forEach(url => {
      iceServers.push({ urls: url, username: turnUser, credential: turnCred });
    });
  } else {
    // Public relay fallback so cross-network calls don't fail outright without a
    // custom TURN setup, BUT this free shared relay (openrelay.metered.ca) is
    // heavily used, rate-limited, and often refuses/drops connections in
    // production. If you see black screens / no audio between people on
    // different networks (e.g. your Railway deployment), this fallback is the
    // most likely cause.
    //
    // Fix: sign up for a free TURN server (e.g. https://www.metered.ca/tools/openrelay/
    // dashboard, Twilio NTS, Xirsys, or self-hosted coturn) and set these env vars
    // in Railway -> your service -> Variables:
    //   TURN_URL        e.g. turn:relay.metered.ca:80,turn:relay.metered.ca:443,turn:relay.metered.ca:443?transport=tcp
    //   TURN_USERNAME   the credential username from your TURN provider
    //   TURN_CREDENTIAL the credential password/secret from your TURN provider
    console.warn('[ICE] No TURN_URL/TURN_USERNAME/TURN_CREDENTIAL set - falling back to the free, unreliable openrelay.metered.ca relay. Cross-network calls (e.g. you + a friend on different networks) may fail with no video/audio/screen-share. Set your own TURN server env vars on Railway for reliable calls.');
    iceServers.push({
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:80?transport=tcp',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    });
  }

  return iceServers;
}

app.get('/api/ice-config', requireLogin, (req, res) => {
  res.json({ iceServers: buildIceServers() });
});

// ---------- Departments ----------
app.get('/api/departments', requireLogin, (req, res) => {
  res.json({ departments: db.get('departments').value() });
});

// ---------- User management (Super Admin only) ----------
// List all users (optionally filter by department)
app.get('/api/users', requireLogin, requireRole('superadmin', 'dept_admin'), (req, res) => {
  let users = db.get('users').value();
  if (req.currentUser.role === 'dept_admin') {
    users = users.filter(u => u.departmentId === req.currentUser.departmentId && u.role === 'employee');
  }
  res.json({ users: users.map(sanitizeUser) });
});

// Create a user: superadmin can create dept_admin or employee for any department
app.post('/api/users', requireLogin, requireRole('superadmin'), (req, res) => {
  const { name, email, password, role, departmentId } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password, role are required' });
  }
  if (!['dept_admin', 'employee'].includes(role)) {
    return res.status(400).json({ error: 'role must be dept_admin or employee' });
  }
  const dept = db.get('departments').find({ id: departmentId }).value();
  if (!dept) return res.status(400).json({ error: 'Invalid departmentId' });

  const emailNorm = email.toLowerCase().trim();
  if (db.get('users').find({ email: emailNorm }).value()) {
    return res.status(409).json({ error: 'Email already in use' });
  }

  const newUser = {
    id: uuidv4(),
    name,
    email: emailNorm,
    password: bcrypt.hashSync(password, 10),
    role,
    departmentId
  };
  db.get('users').push(newUser).write();
  res.status(201).json({ user: sanitizeUser(newUser) });
});

// Delete a user (super admin only)
app.delete('/api/users/:id', requireLogin, requireRole('superadmin'), (req, res) => {
  const target = db.get('users').find({ id: req.params.id }).value();
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'superadmin') return res.status(400).json({ error: 'Cannot delete super admin' });

  db.get('users').remove({ id: req.params.id }).write();
  // Also remove them from any meeting participant lists
  const meetings = db.get('meetings').value();
  meetings.forEach(m => {
    if (m.participantIds.includes(req.params.id)) {
      db.get('meetings').find({ id: m.id }).assign({
        participantIds: m.participantIds.filter(pid => pid !== req.params.id)
      }).write();
    }
  });
  res.json({ ok: true });
});

// ---------- Employees list for a dept admin (to pick meeting participants) ----------
app.get('/api/employees', requireLogin, requireRole('dept_admin'), (req, res) => {
  const employees = db.get('users')
    .filter({ role: 'employee', departmentId: req.currentUser.departmentId })
    .value();
  res.json({ employees: employees.map(sanitizeUser) });
});

// ---------- Meetings ----------
// Dept admin creates a meeting for their own department
app.post('/api/meetings', requireLogin, requireRole('dept_admin'), (req, res) => {
  const { title, description, date, time, participantIds } = req.body;
  if (!title || !date || !time) {
    return res.status(400).json({ error: 'title, date, time are required' });
  }

  const validIds = db.get('users')
    .filter({ role: 'employee', departmentId: req.currentUser.departmentId })
    .map('id')
    .value();

  const chosen = Array.isArray(participantIds)
    ? participantIds.filter(id => validIds.includes(id))
    : [];

  const meeting = {
    id: uuidv4(),
    title,
    description: description || '',
    date,
    time,
    departmentId: req.currentUser.departmentId,
    createdBy: req.currentUser.id,
    participantIds: chosen,
    createdAt: new Date().toISOString()
  };
  db.get('meetings').push(meeting).write();

  // Send invitation emails to all invited participants asynchronously
  // (don't block the response on email delivery)
  if (chosen.length > 0) {
    (async () => {
      for (const participantId of chosen) {
        const participant = db.get('users').find({ id: participantId }).value();
        if (participant) {
          await sendMeetingInviteEmail(
            participant.email,
            participant.name,
            meeting,
            req.currentUser.name
          );
        }
      }
    })().catch(err => console.error('[EMAIL BATCH ERROR]', err));
  }

  res.status(201).json({ meeting });
});

// Dept admin: list meetings they created (their department)
app.get('/api/meetings/department', requireLogin, requireRole('dept_admin'), (req, res) => {
  const meetings = db.get('meetings')
    .filter({ departmentId: req.currentUser.departmentId })
    .value();
  res.json({ meetings: enrichMeetings(meetings) });
});

// Employee: list meetings they are invited to
app.get('/api/meetings/mine', requireLogin, requireRole('employee'), (req, res) => {
  const meetings = db.get('meetings')
    .filter(m => m.participantIds.includes(req.currentUser.id))
    .value();
  res.json({ meetings: enrichMeetings(meetings) });
});

// Super admin: view ALL meetings across all departments
app.get('/api/meetings/all', requireLogin, requireRole('superadmin'), (req, res) => {
  const meetings = db.get('meetings').value();
  res.json({ meetings: enrichMeetings(meetings) });
});

// Update a meeting (only its creator dept_admin)
app.put('/api/meetings/:id', requireLogin, requireRole('dept_admin'), (req, res) => {
  const meeting = db.get('meetings').find({ id: req.params.id }).value();
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  if (meeting.createdBy !== req.currentUser.id) return res.status(403).json({ error: 'Not your meeting' });

  const { title, description, date, time, participantIds } = req.body;
  const validIds = db.get('users')
    .filter({ role: 'employee', departmentId: req.currentUser.departmentId })
    .map('id')
    .value();
  const chosen = Array.isArray(participantIds)
    ? participantIds.filter(id => validIds.includes(id))
    : meeting.participantIds;

  db.get('meetings').find({ id: req.params.id }).assign({
    title: title ?? meeting.title,
    description: description ?? meeting.description,
    date: date ?? meeting.date,
    time: time ?? meeting.time,
    participantIds: chosen
  }).write();

  res.json({ meeting: db.get('meetings').find({ id: req.params.id }).value() });
});

// Delete a meeting (only its creator dept_admin).
// Before removing it, snapshot attendance into meetingHistory so the dept admin can
// still see: how long the meeting actually ran, who joined (and their total time in
// the call), and who was invited but never showed up.
app.delete('/api/meetings/:id', requireLogin, requireRole('dept_admin'), (req, res) => {
  const meeting = db.get('meetings').find({ id: req.params.id }).value();
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  if (meeting.createdBy !== req.currentUser.id) return res.status(403).json({ error: 'Not your meeting' });

  const historyEntry = buildMeetingHistoryEntry(meeting);
  db.get('meetingHistory').push(historyEntry).write();

  db.get('attendance').remove({ meetingId: meeting.id }).write();
  db.get('meetings').remove({ id: req.params.id }).write();
  res.json({ ok: true, history: historyEntry });
});

// Dept admin: list history of meetings they deleted (their department), most recent first
app.get('/api/meetings/history', requireLogin, requireRole('dept_admin'), (req, res) => {
  const history = db.get('meetingHistory')
    .filter({ departmentId: req.currentUser.departmentId })
    .value()
    .slice()
    .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  res.json({ history });
});

// Get a single meeting — used by the meeting room page. Access allowed for:
// the dept_admin who created it, any invited employee, or the superadmin.
app.get('/api/meetings/:id', requireLogin, (req, res) => {
  const meeting = db.get('meetings').find({ id: req.params.id }).value();
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

  const user = db.get('users').find({ id: req.session.userId }).value();
  const allowed = user.role === 'superadmin' ||
    meeting.createdBy === user.id ||
    meeting.participantIds.includes(user.id);

  if (!allowed) return res.status(403).json({ error: 'You are not invited to this meeting' });

  res.json({ meeting: enrichMeetings([meeting])[0] });
});

// ---------- Email diagnostic (super admin only) ----------
// Sends a single test invitation without creating a fake meeting so you can
// verify which provider your Render deploy is actually using. Look for the
// `[EMAIL SENT via ...]` or `[EMAIL ERROR] ...` log lines in Render > Logs.
//
// Example (browser console / curl):
//   curl -X POST https://your-app.onrender.com/api/test-email \
//     -H 'Content-Type: application/json' \
//     -b cookies.txt \
//     -d '{"to":"you@gmail.com"}'
app.post('/api/test-email', requireLogin, requireRole('superadmin'), async (req, res) => {
  const to = (req.body && req.body.to) || (req.currentUser && req.currentUser.email);
  if (!to) {
    return res.status(400).json({ error: '`to` is required (or sign in with the email you want to test to)' });
  }
  try {
    const ok = await sendMeetingInviteEmail(
      to,
      'Test Recipient',
      {
        id: 'test-msg-id',
        title: 'UrMeeting test email',
        description: 'Sent from POST /api/test-email. If you read this in your inbox, your Render deployment is correctly wired up.',
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toISOString().slice(11, 16)
      },
      req.currentUser.name
    );
    res.json({
      ok,
      sent_to: to,
      message: ok
        ? `Email dispatched to ${to}. Look for "[EMAIL SENT via ...]" in Render logs to see which provider handled it. Recipient should see it in their inbox (check Spam).`
        : `Email NOT sent to ${to}. Look at Render logs for the "[EMAIL ERROR] ..." line — the [EMAIL HINT] below it will tell you exactly which env vars to fix.`
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- Attendance tracking (used to build the deleted-meeting history) ----------
function formatDuration(totalSeconds) {
  const secs = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m || h) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function recordAttendanceJoin(meetingId, userId, name, socketId) {
  db.get('attendance').push({
    id: uuidv4(),
    meetingId,
    userId,
    name,
    socketId,
    joinedAt: new Date().toISOString(),
    leftAt: null
  }).write();
}

function recordAttendanceLeave(socketId) {
  const session = db.get('attendance').find({ socketId, leftAt: null }).value();
  if (!session) return;
  db.get('attendance').find({ id: session.id }).assign({ leftAt: new Date().toISOString() }).write();
}

// Builds the snapshot stored in meetingHistory when a meeting is deleted, using
// whatever attendance sessions were recorded (a still-open session for anyone still
// connected is closed off "now" so their time in the meeting is still counted).
function buildMeetingHistoryEntry(meeting) {
  const now = new Date();
  const users = db.get('users').value();
  const depts = db.get('departments').value();
  const sessions = db.get('attendance').filter({ meetingId: meeting.id }).value();

  // Close any still-open session (participant connected when the meeting got deleted)
  const normalized = sessions.map(s => ({
    ...s,
    leftAt: s.leftAt || now.toISOString()
  }));

  const byUser = {};
  normalized.forEach(s => {
    if (!byUser[s.userId]) byUser[s.userId] = [];
    byUser[s.userId].push(s);
  });

  const joined = Object.keys(byUser).map(userId => {
    const userSessions = byUser[userId];
    const totalSeconds = userSessions.reduce((sum, s) => sum + (new Date(s.leftAt) - new Date(s.joinedAt)) / 1000, 0);
    const u = users.find(x => x.id === userId);
    return {
      id: userId,
      name: (u && u.name) || userSessions[0].name || 'Unknown',
      email: u ? u.email : null,
      totalSeconds: Math.round(totalSeconds),
      totalFormatted: formatDuration(totalSeconds),
      sessions: userSessions.map(s => ({ joinedAt: s.joinedAt, leftAt: s.leftAt }))
    };
  }).sort((a, b) => b.totalSeconds - a.totalSeconds);

  const notJoined = meeting.participantIds
    .filter(id => !byUser[id])
    .map(id => {
      const u = users.find(x => x.id === id);
      return { id, name: u ? u.name : 'Unknown', email: u ? u.email : null };
    });

  // Overall meeting duration: span from the earliest join to the latest leave across
  // everyone who attended. If nobody ever joined, duration is 0.
  let durationSeconds = 0;
  if (normalized.length > 0) {
    const earliest = Math.min(...normalized.map(s => new Date(s.joinedAt).getTime()));
    const latest = Math.max(...normalized.map(s => new Date(s.leftAt).getTime()));
    durationSeconds = Math.round((latest - earliest) / 1000);
  }

  return {
    id: uuidv4(),
    meetingId: meeting.id,
    title: meeting.title,
    description: meeting.description,
    date: meeting.date,
    time: meeting.time,
    departmentId: meeting.departmentId,
    departmentName: (depts.find(d => d.id === meeting.departmentId) || {}).name || meeting.departmentId,
    createdBy: meeting.createdBy,
    createdByName: (users.find(u => u.id === meeting.createdBy) || {}).name || 'Unknown',
    participantIds: meeting.participantIds,
    durationSeconds,
    durationFormatted: formatDuration(durationSeconds),
    joined,
    notJoined,
    deletedAt: now.toISOString()
  };
}

function enrichMeetings(meetings) {
  const users = db.get('users').value();
  const depts = db.get('departments').value();
  return meetings.map(m => ({
    ...m,
    departmentName: (depts.find(d => d.id === m.departmentId) || {}).name || m.departmentId,
    createdByName: (users.find(u => u.id === m.createdBy) || {}).name || 'Unknown',
    participants: m.participantIds
      .map(id => users.find(u => u.id === id))
      .filter(Boolean)
      .map(u => ({ id: u.id, name: u.name, email: u.email }))
  }));
}

// ---------- Company Directory + Direct Messages (any user <-> any user) ----------

// Everyone (any role) can see everyone else, across all departments, to start a chat
app.get('/api/directory', requireLogin, (req, res) => {
  const depts = db.get('departments').value();
  const users = db.get('users')
    .filter(u => u.id !== req.session.userId)
    .value()
    .map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      departmentId: u.departmentId,
      departmentName: (depts.find(d => d.id === u.departmentId) || {}).name || (u.role === 'superadmin' ? 'Management' : '-')
    }));
  res.json({ users });
});

// List of conversations (one row per other user you've exchanged messages with, or all users
// with a flag) so the UI can show previews + unread counts.
app.get('/api/messages/conversations', requireLogin, (req, res) => {
  const meId = req.session.userId;
  const allMessages = db.get('messages').value();
  const users = db.get('users').value();
  const byUser = {};

  allMessages.forEach(m => {
    if (m.fromId !== meId && m.toId !== meId) return;
    if ((m.deletedFor || []).includes(meId)) return; // I deleted this one "for me"
    const otherId = m.fromId === meId ? m.toId : m.fromId;
    if (!byUser[otherId] || new Date(m.createdAt) > new Date(byUser[otherId].createdAt)) {
      byUser[otherId] = m;
    }
  });

  const conversations = Object.keys(byUser).map(otherId => {
    const u = users.find(x => x.id === otherId);
    const last = byUser[otherId];
    const unreadCount = allMessages.filter(m => m.fromId === otherId && m.toId === meId && !m.read && !(m.deletedFor || []).includes(meId)).length;
    let preview;
    if (last.deletedForAll) preview = 'This message was deleted';
    else if (last.attachment && last.attachment.mimetype && last.attachment.mimetype.startsWith('audio/')) preview = '🎤 Voice message';
    else preview = last.text || (last.attachment ? `📎 ${last.attachment.filename}` : '');
    return {
      userId: otherId,
      name: u ? u.name : 'Unknown user',
      lastMessage: preview,
      lastMessageAt: last.createdAt,
      unreadCount
    };
  }).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

  res.json({ conversations });
});

// Full conversation thread with a specific user (marks their messages to me as read)
app.get('/api/messages/:userId', requireLogin, (req, res) => {
  const meId = req.session.userId;
  const otherId = req.params.userId;
  const other = db.get('users').find({ id: otherId }).value();
  if (!other) return res.status(404).json({ error: 'User not found' });

  const thread = db.get('messages')
    .filter(m => (m.fromId === meId && m.toId === otherId) || (m.fromId === otherId && m.toId === meId))
    .value()
    .filter(m => !(m.deletedFor || []).includes(meId)) // hide messages this user deleted "for me"
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  // Mark incoming messages as read
  db.get('messages')
    .filter(m => m.fromId === otherId && m.toId === meId && !m.read)
    .each(m => { m.read = true; })
    .write();

  res.json({ messages: thread, otherUser: { id: other.id, name: other.name, email: other.email } });
});

// Delete a message: mode "me" hides it only for the requester, mode "all" wipes its
// content for everyone (WhatsApp-style "Delete for everyone") and is only allowed
// for the message's original sender.
app.delete('/api/messages/:id', requireLogin, (req, res) => {
  const meId = req.session.userId;
  const mode = req.body && req.body.mode === 'all' ? 'all' : 'me';
  const message = db.get('messages').find({ id: req.params.id }).value();
  if (!message) return res.status(404).json({ error: 'Message not found' });
  if (message.fromId !== meId && message.toId !== meId) {
    return res.status(403).json({ error: 'Not your conversation' });
  }

  if (mode === 'all') {
    if (message.fromId !== meId) {
      return res.status(403).json({ error: 'Only the sender can delete a message for everyone' });
    }
    db.get('messages').find({ id: req.params.id }).assign({
      text: '',
      attachment: null,
      deletedForAll: true
    }).write();
    const otherId = message.fromId === meId ? message.toId : message.fromId;
    io.to('user:' + meId).emit('message-deleted', { id: req.params.id, mode: 'all' });
    io.to('user:' + otherId).emit('message-deleted', { id: req.params.id, mode: 'all' });
  } else {
    const deletedFor = new Set(message.deletedFor || []);
    deletedFor.add(meId);
    db.get('messages').find({ id: req.params.id }).assign({ deletedFor: Array.from(deletedFor) }).write();
    io.to('user:' + meId).emit('message-deleted', { id: req.params.id, mode: 'me' });
  }

  res.json({ success: true });
});

// Send a direct message: JSON text-only, OR multipart/form-data with an optional file
// (image, video, or any document) attached.
app.post('/api/messages', requireLogin, upload.single('file'), (req, res) => {
  const meId = req.session.userId;
  const { toId, text } = req.body;

  if (!toId) return res.status(400).json({ error: 'toId is required' });
  const recipient = db.get('users').find({ id: toId }).value();
  if (!recipient) return res.status(404).json({ error: 'Recipient not found' });
  if (!text && !req.file) return res.status(400).json({ error: 'Message must have text or an attachment' });

  let attachment = null;
  if (req.file) {
    attachment = {
      filename: req.file.originalname,
      url: '/uploads/' + req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size
    };
  }

  const message = {
    id: uuidv4(),
    fromId: meId,
    toId,
    text: text || '',
    attachment,
    createdAt: new Date().toISOString(),
    read: false
  };
  db.get('messages').push(message).write();

  // Real-time delivery if the recipient is online
  io.to('user:' + toId).emit('direct-message', message);

  res.status(201).json({ message });
});

// ---------- Socket.io: WebRTC signaling + live chat ----------
// Rooms are keyed by meetingId. Every socket that joins must belong to that
// meeting (creator, invited employee, or superadmin) — verified server-side.
function getSocketUser(socket) {
  const userId = socket.request.session && socket.request.session.userId;
  return userId ? db.get('users').find({ id: userId }).value() : null;
}

function isMeetingOwner(socket, meetingId) {
  if (!meetingId || socket.data.meetingId !== meetingId) return false;
  const meeting = db.get('meetings').find({ id: meetingId }).value();
  return Boolean(meeting && meeting.createdBy === socket.data.userId);
}

function sendModerationError(socket, message) {
  socket.emit('moderation-error', message);
}

// ---------- In-meeting chat extras: polls + pinned message ----------
// These live only in memory (mirroring the existing chat, which is not persisted
// to db.json either) and are keyed by meetingId so late joiners can be caught up.
const meetingPolls = {};   // meetingId -> { pollId -> poll }
const meetingPinned = {};  // meetingId -> pinned message object

function getPollsForMeeting(meetingId) {
  if (!meetingPolls[meetingId]) meetingPolls[meetingId] = {};
  return meetingPolls[meetingId];
}

function cleanupMeetingChatState(meetingId) {
  const room = io.sockets.adapter.rooms.get(meetingId);
  if (!room || room.size === 0) {
    delete meetingPolls[meetingId];
    delete meetingPinned[meetingId];
  }
}

function getModerationTargets(socket, meetingId, targetSocketId) {
  const room = io.sockets.adapter.rooms.get(meetingId);
  if (!room) return [];
  if (targetSocketId) {
    if (targetSocketId === socket.id || !room.has(targetSocketId)) return null;
    return [targetSocketId];
  }
  return Array.from(room).filter(socketId => socketId !== socket.id);
}

io.on('connection', (socket) => {
  // Any logged-in user registers their personal room so direct messages reach them live,
  // regardless of whether they're in a meeting room or just browsing the dashboard.
  socket.on('register', () => {
    const user = getSocketUser(socket);
    if (!user) return;
    socket.data.registeredUserId = user.id;
    socket.join('user:' + user.id);
  });

  socket.on('join-room', ({ meetingId }) => {
    const meeting = db.get('meetings').find({ id: meetingId }).value();
    const user = getSocketUser(socket);
    if (!meeting || !user) return socket.emit('join-error', 'Meeting or user not found');

    const allowed = user.role === 'superadmin' ||
      meeting.createdBy === user.id ||
      meeting.participantIds.includes(user.id);
    if (!allowed) return socket.emit('join-error', 'You are not invited to this meeting');

    socket.data.meetingId = meetingId;
    socket.data.userId = user.id;
    socket.data.name = user.name;

    // Track attendance so a full record survives even after the meeting is later
    // deleted by its dept_admin (see buildMeetingHistoryEntry).
    recordAttendanceJoin(meetingId, user.id, user.name, socket.id);

    // Tell the new socket who is already in the room
    const room = io.sockets.adapter.rooms.get(meetingId) || new Set();
    const existingUsers = Array.from(room).map(sid => {
      const s = io.sockets.sockets.get(sid);
      return {
        socketId: sid,
        userId: s.data.userId,
        name: s.data.name,
        sharingScreen: !!s.data.sharingScreen,
        handRaised: !!s.data.handRaised,
        micMuted: !!s.data.micMuted,
        cameraOn: s.data.cameraOn !== false
      };
    });
    socket.emit('existing-users', existingUsers);

    // Catch the joining socket up on any active polls and the currently pinned message
    socket.emit('existing-polls', Object.values(getPollsForMeeting(meetingId)));
    if (meetingPinned[meetingId]) {
      socket.emit('message-pinned', meetingPinned[meetingId]);
    }

    socket.join(meetingId);
    socket.to(meetingId).emit('user-joined', {
      socketId: socket.id,
      userId: user.id,
      name: user.name,
      sharingScreen: false,
      handRaised: false,
      micMuted: false,
      cameraOn: true
    });
  });

  // WebRTC signaling relay (offer / answer / ICE candidates)
  socket.on('signal', ({ to, data }) => {
    const target = io.sockets.sockets.get(to);
    if (!target || !socket.data.meetingId || target.data.meetingId !== socket.data.meetingId) return;
    io.to(to).emit('signal', { from: socket.id, name: socket.data.name, data });
  });

  socket.on('chat-message', ({ meetingId, text }) => {
    if (!meetingId || socket.data.meetingId !== meetingId || !text) return;
    io.to(meetingId).emit('chat-message', {
      id: uuidv4(),
      from: socket.data.userId,
      name: socket.data.name || 'Unknown',
      text: String(text).slice(0, 2000),
      time: new Date().toISOString()
    });
  });

  // ---- Polls (WhatsApp-style) — any participant can create/vote ----
  socket.on('create-poll', ({ meetingId, question, options, allowMultiple }) => {
    if (!meetingId || socket.data.meetingId !== meetingId) return;
    const cleanQuestion = String(question || '').trim().slice(0, 300);
    if (!cleanQuestion) return sendModerationError(socket, 'A poll needs a question.');

    const cleanOptions = Array.isArray(options)
      ? options.map(o => String(o || '').trim().slice(0, 120)).filter(Boolean)
      : [];
    const uniqueOptions = [...new Set(cleanOptions)];
    if (uniqueOptions.length < 2 || uniqueOptions.length > 6) {
      return sendModerationError(socket, 'A poll needs between 2 and 6 unique options.');
    }

    const poll = {
      id: uuidv4(),
      meetingId,
      question: cleanQuestion,
      allowMultiple: !!allowMultiple,
      createdBy: socket.data.userId,
      createdByName: socket.data.name || 'Unknown',
      createdAt: new Date().toISOString(),
      options: uniqueOptions.map(text => ({ id: uuidv4(), text, votes: [] }))
    };

    getPollsForMeeting(meetingId)[poll.id] = poll;
    io.to(meetingId).emit('poll-created', poll);
  });

  socket.on('vote-poll', ({ meetingId, pollId, optionId }) => {
    if (!meetingId || socket.data.meetingId !== meetingId) return;
    const poll = getPollsForMeeting(meetingId)[pollId];
    if (!poll) return sendModerationError(socket, 'This poll no longer exists.');
    const option = poll.options.find(o => o.id === optionId);
    if (!option) return sendModerationError(socket, 'That poll option no longer exists.');

    const userId = socket.data.userId;
    const alreadyVoted = option.votes.includes(userId);

    if (!poll.allowMultiple) {
      // Single-choice: clear this user's vote from every option first.
      poll.options.forEach(o => { o.votes = o.votes.filter(v => v !== userId); });
    } else {
      option.votes = option.votes.filter(v => v !== userId);
    }

    if (!alreadyVoted) {
      option.votes.push(userId);
    }

    io.to(meetingId).emit('poll-updated', poll);
  });

  // ---- Pinned message (meeting owner only) ----
  socket.on('pin-message', ({ meetingId, message }) => {
    if (!isMeetingOwner(socket, meetingId)) {
      return sendModerationError(socket, 'Only this meeting’s owner can pin messages.');
    }
    if (!message || !message.text) return;
    const pinned = {
      id: message.id || uuidv4(),
      from: message.from,
      name: message.name || 'Unknown',
      text: String(message.text).slice(0, 2000),
      time: message.time || new Date().toISOString(),
      pinnedBy: socket.data.name || 'Meeting owner'
    };
    meetingPinned[meetingId] = pinned;
    io.to(meetingId).emit('message-pinned', pinned);
  });

  socket.on('unpin-message', ({ meetingId }) => {
    if (!isMeetingOwner(socket, meetingId)) {
      return sendModerationError(socket, 'Only this meeting’s owner can unpin messages.');
    }
    delete meetingPinned[meetingId];
    io.to(meetingId).emit('message-unpinned');
  });

  // ---- Screen sharing presence (actual media swap happens peer-to-peer via renegotiation;
  // this just tells everyone in the room who is currently presenting so the UI can react) ----
  socket.on('screen-share-started', ({ meetingId }) => {
    if (!meetingId || socket.data.meetingId !== meetingId) return;
    socket.data.sharingScreen = true;
    io.to(meetingId).emit('screen-share-changed', {
      socketId: socket.id, userId: socket.data.userId, name: socket.data.name, sharing: true
    });
  });

  socket.on('screen-share-stopped', ({ meetingId }) => {
    if (!meetingId || socket.data.meetingId !== meetingId) return;
    socket.data.sharingScreen = false;
    io.to(meetingId).emit('screen-share-changed', {
      socketId: socket.id, userId: socket.data.userId, name: socket.data.name, sharing: false
    });
  });

  // ---- Mic mute status (so everyone in the room sees who's muted) ----
  socket.on('mic-changed', ({ meetingId, muted }) => {
    if (!meetingId || socket.data.meetingId !== meetingId) return;
    socket.data.micMuted = !!muted;
    io.to(meetingId).emit('mic-changed', {
      socketId: socket.id, userId: socket.data.userId, name: socket.data.name, muted: !!muted
    });
  });

  // ---- Camera status (used by attendee tiles and the owner controls) ----
  socket.on('camera-changed', ({ meetingId, enabled }) => {
    if (!meetingId || socket.data.meetingId !== meetingId) return;
    socket.data.cameraOn = !!enabled;
    io.to(meetingId).emit('camera-changed', {
      socketId: socket.id, userId: socket.data.userId, name: socket.data.name, enabled: !!enabled
    });
  });

  // ---- Meeting owner moderation ----
  // Each command is authorized against the meeting creator stored in the database.
  // `targetSocketId` is optional: omitted means every attendee except the owner.
  socket.on('admin-audio-state', ({ meetingId, targetSocketId, muted }) => {
    if (!isMeetingOwner(socket, meetingId)) return sendModerationError(socket, 'Only this meeting’s owner can change attendee microphones.');
    if (typeof muted !== 'boolean') return sendModerationError(socket, 'Invalid microphone setting.');
    const targets = getModerationTargets(socket, meetingId, targetSocketId);
    if (!targets) return sendModerationError(socket, 'That attendee is no longer in this meeting.');
    targets.forEach(socketId => io.to(socketId).emit('admin-audio-state', { muted }));
  });

  socket.on('admin-camera-state', ({ meetingId, targetSocketId, enabled }) => {
    if (!isMeetingOwner(socket, meetingId)) return sendModerationError(socket, 'Only this meeting’s owner can change attendee cameras.');
    if (typeof enabled !== 'boolean') return sendModerationError(socket, 'Invalid camera setting.');
    const targets = getModerationTargets(socket, meetingId, targetSocketId);
    if (!targets) return sendModerationError(socket, 'That attendee is no longer in this meeting.');
    targets.forEach(socketId => io.to(socketId).emit('admin-camera-state', { enabled }));
  });

  socket.on('admin-stop-screen-share', ({ meetingId, targetSocketId }) => {
    if (!isMeetingOwner(socket, meetingId)) return sendModerationError(socket, 'Only this meeting’s owner can stop attendee screen sharing.');
    const targets = getModerationTargets(socket, meetingId, targetSocketId);
    if (!targets) return sendModerationError(socket, 'That attendee is no longer in this meeting.');
    targets.forEach(socketId => io.to(socketId).emit('admin-stop-screen-share'));
  });

  // ---- Live captions ----
  // Browsers create the transcript locally; final text is relayed only to the
  // other people in the same meeting who have chosen to display captions.
  socket.on('caption-text', ({ meetingId, text }) => {
    if (!meetingId || socket.data.meetingId !== meetingId || typeof text !== 'string') return;
    const cleanText = text.trim().slice(0, 1000);
    if (!cleanText) return;
    socket.to(meetingId).emit('caption-received', {
      speaker: socket.data.name || 'Unknown',
      text: cleanText
    });
  });

  // ---- Raise / lower hand ----
  socket.on('raise-hand', ({ meetingId, raised }) => {
    if (!meetingId || socket.data.meetingId !== meetingId) return;
    socket.data.handRaised = !!raised;
    io.to(meetingId).emit('hand-raised', {
      socketId: socket.id, userId: socket.data.userId, name: socket.data.name, raised: !!raised
    });
  });

  // ---- Emoji reactions (ephemeral, not stored) ----
  socket.on('reaction', ({ meetingId, emoji }) => {
    if (!meetingId || socket.data.meetingId !== meetingId || !emoji) return;
    const allowed = ['👍', '❤️', '😂', '😮', '👏', '🎉', '🙌', '✅'];
    if (!allowed.includes(emoji)) return;
    io.to(meetingId).emit('reaction', {
      socketId: socket.id, userId: socket.data.userId, name: socket.data.name, emoji
    });
  });

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room !== socket.id) {
        socket.to(room).emit('user-left', { socketId: socket.id, userId: socket.data.userId, name: socket.data.name });
      }
    }
    if (socket.data.meetingId) {
      recordAttendanceLeave(socket.id);
    }
    if (socket.data.meetingId) {
      const meetingId = socket.data.meetingId;
      // Room membership hasn't been updated yet during 'disconnecting', so a room
      // size of 1 here means this socket is the last one still present.
      const room = io.sockets.adapter.rooms.get(meetingId);
      if (!room || room.size <= 1) {
        setImmediate(() => cleanupMeetingChatState(meetingId));
      }
    }
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Meeting platform running on port ${PORT}`);
});
