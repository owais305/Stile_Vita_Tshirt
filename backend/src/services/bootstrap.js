'use strict';
// Creates the first admin account (username/password from .env, default admin / admin123).
const { C } = require('../db');
const { hashPw } = require('../utils/security');

async function ensureAdmin() {
  const u = String(process.env.ADMIN_USER || 'admin').toLowerCase();
  if (!(await C.admins.findOne({ username: u }))) { await C.admins.insertOne({ username: u, name: 'Store Admin', passwordHash: hashPw(process.env.ADMIN_PASS || 'admin123'), createdAt: new Date() }); console.log(`Admin created -> username: ${u}  password: ${process.env.ADMIN_PASS || 'admin123'} (change it in the admin panel)`); }
}

module.exports = { ensureAdmin };
