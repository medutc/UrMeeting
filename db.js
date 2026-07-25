
// db.js — simple JSON file database using lowdb v1 (synchronous, no native build tools needed)
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');

// In production, set DATA_DIR to a persistent volume path so db.json survives redeployments.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const adapter = new FileSync(path.join(DATA_DIR, 'db.json'));
const db = low(adapter);

// Default structure
db.defaults({
  departments: [
    { id: 'operations', name: 'Operations' },
    { id: 'sales_marketing', name: 'Sales & Marketing' },
    { id: 'supply_chain', name: 'Supply Chain & Logistics' },
    { id: 'finance', name: 'Finance' },
    { id: 'hr', name: 'Human Resources' }
  ],
  users: [],   // { id, name, email, password(hash), role, departmentId }
  meetings: [], // { id, title, description, date, time, departmentId, createdBy, participantIds: [] }
  messages: [],  // { id, fromId, toId, text, attachment, createdAt, read }
  // Live attendance sessions for meetings that are currently open (or were open before
  // deletion). Each entry represents one continuous stretch a given user was present.
  // { id, meetingId, userId, name, socketId, joinedAt (ISO), leftAt (ISO|null) }
  attendance: [],
  // Snapshot created when a dept_admin deletes a meeting: duration, who actually joined
  // (with their total time in the meeting), and who was invited but never joined.
  // { id, meetingId, title, description, date, time, departmentId, departmentName,
  //   createdBy, createdByName, participantIds, durationSeconds, durationFormatted,
  //   joined: [{ id, name, email, totalSeconds, totalFormatted, sessions: [{joinedAt, leftAt}] }],
  //   notJoined: [{ id, name, email }], deletedAt }
  meetingHistory: []
}).write();

module.exports = db;
