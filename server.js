
// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
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
// For Gmail: set GMAIL_USER and GMAIL_PASSWORD (use "App Password" not your actual password)
// For other SMTP: set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
const emailConfig = {
  gmail: {
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASSWORD
    }
  },
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
    return nodemailer.createTransport(emailConfig.gmail);
  } else if (process.env.SMTP_HOST) {
    return nodemailer.createTransport(emailConfig.smtp);
  }
  return null; // Email disabled if no config provided
})();

async function sendMeetingInviteEmail(participantEmail, participantName, meeting, creatorName) {
  if (!emailTransporter) {
    console.log('[EMAIL DISABLED] Configure GMAIL_USER/GMAIL_PASSWORD or SMTP_* env vars to enable emails.');
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

  try {
    await emailTransporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.GMAIL_USER || process.env.SMTP_USER,
      to: participantEmail,
      subject: `Meeting Invitation: ${meeting.title}`,
      html: emailContent
    });
    console.log(`[EMAIL SENT] to ${participantEmail}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL ERROR] Failed to send to ${participantEmail}:`, err.message);
    return false;
  }
}

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
// Serve uploaded files from UPLOAD_DIR (may live on a persistent volume in production)
app.use('/uploads', express.static(UPLOAD_DIR));
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'meeting-platform-secret-change-me',
  resave: false,
  saveUninitialized: false,
    cookie: {
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
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
    // Public relay fallback so cross-network calls work without custom TURN setup.
    // For production, set TURN_URL / TURN_USERNAME / TURN_CREDENTIAL in Railway env vars.
    iceServers.push({
      urls: [
        'turn:openrelay.metered.ca:80',
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

// Delete a meeting (only its creator dept_admin)
app.delete('/api/meetings/:id', requireLogin, requireRole('dept_admin'), (req, res) => {
  const meeting = db.get('meetings').find({ id: req.params.id }).value();
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  if (meeting.createdBy !== req.currentUser.id) return res.status(403).json({ error: 'Not your meeting' });

  db.get('meetings').remove({ id: req.params.id }).write();
  res.json({ ok: true });
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
    const otherId = m.fromId === meId ? m.toId : m.fromId;
    if (!byUser[otherId] || new Date(m.createdAt) > new Date(byUser[otherId].createdAt)) {
      byUser[otherId] = m;
    }
  });

  const conversations = Object.keys(byUser).map(otherId => {
    const u = users.find(x => x.id === otherId);
    const last = byUser[otherId];
    const unreadCount = allMessages.filter(m => m.fromId === otherId && m.toId === meId && !m.read).length;
    return {
      userId: otherId,
      name: u ? u.name : 'Unknown user',
      lastMessage: last.text || (last.attachment ? `📎 ${last.attachment.filename}` : ''),
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
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  // Mark incoming messages as read
  db.get('messages')
    .filter(m => m.fromId === otherId && m.toId === meId && !m.read)
    .each(m => { m.read = true; })
    .write();

  res.json({ messages: thread, otherUser: { id: other.id, name: other.name, email: other.email } });
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
      from: socket.data.userId,
      name: socket.data.name || 'Unknown',
      text: String(text).slice(0, 2000),
      time: new Date().toISOString()
    });
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
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Meeting platform running on port ${PORT}`);
});
