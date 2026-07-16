// seed.js — creates the ONE super admin account (you). Run once: `npm run seed`
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const SUPERADMIN_EMAIL = 'admin@company.com';
const SUPERADMIN_PASSWORD = 'ChangeMe123!'; // change this after first login

const existing = db.get('users').find({ role: 'superadmin' }).value();

if (existing) {
  console.log('A super admin already exists:', existing.email);
} else {
  const hash = bcrypt.hashSync(SUPERADMIN_PASSWORD, 10);
  db.get('users')
    .push({
      id: uuidv4(),
      name: 'Super Admin',
      email: SUPERADMIN_EMAIL,
      password: hash,
      role: 'superadmin',
      departmentId: null
    })
    .write();

  console.log('✅ Super admin created!');
  console.log('   Email:   ', SUPERADMIN_EMAIL);
  console.log('   Password:', SUPERADMIN_PASSWORD);
  console.log('⚠️  Please log in and note this is the only account with full access.');
}