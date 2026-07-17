// db.js — simple JSON file database using lowdb v1 (synchronous, no native build tools needed)
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const adapter = new FileSync(path.join(__dirname, 'data', 'db.json'));
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
  users: [],   // { id, name, email, password(hash), role: 'superadmin'|'dept_admin'|'employee', departmentId }
  meetings: [], // { id, title, description, date, time, departmentId, createdBy, participantIds: [] }
  messages: []  // { id, fromId, toId, text, attachment: {filename, url, mimetype, size} | null, createdAt, read }
}).write();

module.exports = db;