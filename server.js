const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'meeting-platform-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));

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

app.listen(PORT, () => {
  console.log(`Meeting platform running at http://localhost:${PORT}`);
});