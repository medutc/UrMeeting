// auth.js — stateless, HMAC-signed auth tokens stored in an httpOnly cookie.
//
// Why this exists
// ---------------
// The previous setup used `express-session` + `session-file-store` which writes
// session data to disk. Render's Web Services (including the free tier) use an
// ephemeral filesystem: every time the container restarts, redeploys, or — on
// the free tier — sleeps after 15 minutes of inactivity, the disk is wiped.
// That destroyed every active session even though the user's `connect.sid`
// cookie was still in the browser, so opening a new browser window forced a
// re-login.
//
// A signed token written into a long-lived httpOnly cookie has no server-side
// state at all. The browser keeps the cookie, the cookie contains the user
// identity (signed with SESSION_SECRET), and the server only needs to verify
// the signature. Restarts, redeploys and sleep cycles no longer log anyone
// out — and the same cookie is automatically shared with every new window
// the user opens on the same origin.
//
// Threat model & guarantees
// -------------------------
// - HMAC-SHA256 with SESSION_SECRET (must be set in env). If the secret leaks,
//   tokens can be forged — set a strong random value in Render's env vars.
// - HttpOnly + SameSite=Lax + Secure (in prod) prevents JS theft and CSRF.
// - Constant-time signature comparison via crypto.timingSafeEqual.
// - Payload is tiny: { userId, exp }. Expiry defaults to 30 days; tokens past
//   `exp` are rejected even if the signature is valid.
// - Tampered tokens (changed payload or signature) are rejected.

const crypto = require('crypto');

const COOKIE_NAME        = 'urmeeting_token';
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---------- base64url helpers (token-safe, URL-safe) ----------
function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlDecode(str) {
  const pad = (4 - (str.length % 4)) % 4;
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  return Buffer.from(normalized, 'base64');
}

// ---------- token sign / verify ----------
function signToken(payload, secret) {
  if (!secret) throw new Error('signToken: secret is required');
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig  = b64urlEncode(
    crypto.createHmac('sha256', secret).update(body).digest()
  );
  return `${body}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || !secret) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;

  const body = token.slice(0, dot);
  const sig  = token.slice(dot + 1);

  let expected;
  try {
    expected = b64urlEncode(
      crypto.createHmac('sha256', secret).update(body).digest()
    );
  } catch (_) {
    return null;
  }

  // Constant-time compare. Buffers must be equal length for timingSafeEqual.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(b64urlDecode(body).toString('utf8'));
    if (typeof payload.userId !== 'string' || !payload.userId) return null;
    if (typeof payload.exp   !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

// ---------- cookie helpers ----------
// Read a named cookie from a Node http request (works for Express, Socket.IO
// engine.io handshakes and any plain http.IncomingMessage).
function readCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';');
  for (const raw of parts) {
    const idx = raw.indexOf('=');
    if (idx < 0) continue;
    const key = raw.slice(0, idx).trim();
    if (key === name) {
      try {
        return decodeURIComponent(raw.slice(idx + 1).trim());
      } catch (_) {
        return null;
      }
    }
  }
  return null;
}

// Build a Set-Cookie header value. We deliberately avoid `cookie-parser` to
// keep the dependency graph small — and Express's `res.append('Set-Cookie', …)`
// is the standard way to add it without clobbering other cookies.
function buildSetCookie(name, value, opts) {
  const o = opts || {};
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path || '/'}`];

  if (o.httpOnly !== false) parts.push('HttpOnly');
  if (o.secure)             parts.push('Secure');
  parts.push(`SameSite=${o.sameSite || 'Lax'}`);

  if (typeof o.maxAge === 'number') {
    parts.push(`Max-Age=${Math.floor(o.maxAge / 1000)}`);
  } else if (o.expires instanceof Date) {
    parts.push(`Expires=${o.expires.toUTCString()}`);
  }
  return parts.join('; ');
}

function buildClearCookie(name) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

module.exports = {
  COOKIE_NAME,
  DEFAULT_MAX_AGE_MS,
  signToken,
  verifyToken,
  readCookie,
  buildSetCookie,
  buildClearCookie
};
