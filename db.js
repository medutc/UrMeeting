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
  messages: []  // { id, fromId, toId, text, attachment, createdAt, read }
}).write();

module.exports = db;