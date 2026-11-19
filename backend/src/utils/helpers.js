'use strict';
// Small helpers: HttpError, input validation (str, intv, money, email, phone, pin, oneOf), id helpers.
const { ObjectId } = require('mongodb');

// ============================ small helpers ============================
class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
const bad = (m) => new HttpError(400, m);
const str = (v, l, max = 200, req = true) => {
  if (v == null || String(v).trim() === '') { if (req) throw bad(`${l} is required`); return ''; }
  if (typeof v !== 'string') throw bad(`${l} must be text`);
  v = v.trim(); if (v.length > max) throw bad(`${l} is too long (max ${max})`); return v;
};
const intv = (v, l, min = 0, max = 100000) => { const n = Number(v); if (v === '' || v == null || !Number.isInteger(n) || n < min || n > max) throw bad(`${l} must be a whole number (${min}-${max})`); return n; };
const money = (v, l, min = 0, max = 1e7) => { const n = Number(v); if (v === '' || v == null || !Number.isFinite(n) || n < min || n > max) throw bad(`${l} must be a number (${min}-${max})`); return Math.round(n * 100) / 100; };
const email = (v) => { v = str(v, 'E-mail', 120).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v)) throw bad('Enter a valid e-mail address'); return v; };
const phone = (v) => { v = str(v, 'Phone', 15); if (!/^[0-9+\-\s]{7,15}$/.test(v)) throw bad('Enter a valid phone number'); return v; };
const pin = (v) => { v = str(v, 'Pincode', 6); if (!/^\d{6}$/.test(v)) throw bad('Pincode must be 6 digits'); return v; };
const oneOf = (v, l, list) => { if (!list.includes(v)) throw bad(`${l} is not valid`); return v; };
const r2 = (n) => Math.round(n * 100) / 100;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toId = (v) => (v instanceof ObjectId ? v : typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v) ? new ObjectId(v) : null);
const mustId = (v, l = 'id') => { const i = toId(v); if (!i) throw bad(`Invalid ${l}`); return i; };
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const created = (data) => ({ __created: true, data });

module.exports = { HttpError, bad, str, intv, money, email, phone, pin, oneOf, r2, esc, toId, mustId, addDays, created };
