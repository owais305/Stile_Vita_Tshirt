'use strict';
// Passwords (scrypt hash), signed session tokens (HMAC) and a tiny login rate-limiter.
const crypto = require('crypto');

// ============================ passwords + sessions ============================
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const hashPw = (p) => { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + crypto.scryptSync(p, s, 64).toString('hex'); };
const checkPw = (p, st) => { try { const [s, k] = String(st).split(':'); const a = crypto.scryptSync(p, Buffer.from(s, 'hex'), 64), b = Buffer.from(k, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); } catch (e) { return false; } };
const sign = (o, ttl) => { const b = Buffer.from(JSON.stringify({ ...o, exp: Date.now() + ttl })).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); };
const verify = (t) => {
  if (!t || t.indexOf('.') < 0) return null; const [b, s] = t.split('.');
  const e = crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
  try { const d = JSON.parse(Buffer.from(b, 'base64url').toString()); return d.exp > Date.now() ? d : null; } catch (x) { return null; }
};
const tries = new Map();
const blocked = (k) => (tries.get(k) || []).filter((t) => Date.now() - t < 600000).length >= 8;
const fail = (k) => tries.set(k, [...(tries.get(k) || []), Date.now()]);

module.exports = { hashPw, checkPw, sign, verify, blocked, fail };
