'use strict';
// Web server: JSON API (/api/...) + static files of the frontend.
const http = require('http'), fs = require('fs'), path = require('path');
const { HttpError, bad, toId } = require('./utils/helpers');
const { C } = require('./db');
const { verify } = require('./utils/security');
const { routes } = require('./routes/shared');
['public', 'customer', 'payments', 'admin'].forEach((r) => require('./routes/' + r));   // registers the routes

// ============================ web server ============================
// frontend folders are served like this:  /uploads -> backend/uploads   /img, /css -> frontend/shared   /admin -> frontend/admin   everything else -> frontend/client
const BACKEND = path.join(__dirname, '..'), FRONTEND = path.join(BACKEND, '..', 'frontend');
const MOUNTS = [['/uploads', path.join(BACKEND, 'uploads')], ['/img', path.join(FRONTEND, 'shared', 'img')], ['/css', path.join(FRONTEND, 'shared', 'css')], ['/admin', path.join(FRONTEND, 'admin')], ['', path.join(FRONTEND, 'client')]];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://*.razorpay.com; style-src 'self' 'unsafe-inline'; script-src 'self' https://checkout.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; connect-src 'self' https://lumberjack.razorpay.com https://api.razorpay.com; form-action 'self' https://api.razorpay.com; frame-ancestors 'none'" };
const send = (res, st, data, h = {}) => { res.writeHead(st, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC, ...h }); res.end(JSON.stringify(data)); };
const cookies = (h) => Object.fromEntries(String(h || '').split(';').map((p) => { const i = p.indexOf('='); return i > 0 ? [p.slice(0, i).trim(), decodeURIComponent(p.slice(i + 1).trim())] : []; }).filter((x) => x.length));
const readBody = (req) => new Promise((ok, no) => { const ch = []; let n = 0; req.on('data', (c) => { n += c.length; if (n > 4e6) { no(new HttpError(413, 'Request is too large')); req.destroy(); } else ch.push(c); }); req.on('end', () => { req.rawBody = Buffer.concat(ch).toString(); if (!ch.length) return ok({}); try { ok(JSON.parse(req.rawBody) || {}); } catch (e) { no(bad('Invalid JSON')); } }); req.on('error', no); });

async function api(req, res, url) {
  let hit = null, exists = false;
  for (const r of routes) { const m = r.re.exec(url.pathname); if (!m) continue; exists = true; if (r.m !== req.method) continue; hit = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; break; }
  if (!hit) throw new HttpError(exists ? 405 : 404, exists ? 'Method not allowed' : 'Not found');
  let body = {}; if (req.method !== 'GET') { if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Content-Type must be application/json'); body = await readBody(req); }
  const ck = cookies(req.headers.cookie), out = [];
  const ctx = { req, params: hit.params, body, query: Object.fromEntries(url.searchParams), ip: req.socket.remoteAddress || '', user: null, admin: null, setCookie: (n, v, age) => out.push(`${n}=${encodeURIComponent(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}`) };
  const a = hit.r.opts.auth;
  if (a === 'customer' || a === 'customer?') { const t = verify(ck.ts_token); if (t && t.role === 'customer') ctx.user = await C.customers.findOne({ _id: toId(t.id) }); if (!ctx.user && a === 'customer') throw new HttpError(401, 'Please log in first'); }
  if (a === 'admin' || a === 'admin?') { const t = verify(ck.ts_admin); if (t && t.role === 'admin') ctx.admin = await C.admins.findOne({ _id: toId(t.id) }); if (!ctx.admin && a === 'admin') throw new HttpError(401, 'Admin login required'); }
  let r = await hit.r.fn(ctx), st = 200; if (r && r.__created) { st = 201; r = r.data; }
  send(res, st, r === undefined ? { ok: true } : r, out.length ? { 'Set-Cookie': out } : {});
}
function serveStatic(req, res, p) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SEC); return res.end(); }
  p = decodeURIComponent(p);
  const [prefix, root] = MOUNTS.find(([x]) => x === '' || p === x || p.startsWith(x + '/'));
  let rel = p.slice(prefix.length) || '/'; if (rel.endsWith('/')) rel += 'index.html';
  const f = path.normalize(path.join(root, rel)); if (!f.startsWith(root + path.sep)) { res.writeHead(403, SEC); return res.end('Forbidden'); }
  fs.stat(f, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain', ...SEC }); return res.end('Page not found'); }
    const x = path.extname(f).toLowerCase(); res.writeHead(200, { 'Content-Type': TYPES[x] || 'application/octet-stream', 'Cache-Control': ['.html', '.js', '.css'].includes(x) ? 'no-cache' : 'public, max-age=3600', ...SEC });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(f).pipe(res);
  });
}
const createServer = () => http.createServer(async (req, res) => {
  try { const url = new URL(req.url, 'http://localhost'); if (url.pathname.startsWith('/api/')) await api(req, res, url); else serveStatic(req, res, url.pathname); }
  catch (e) { if (e instanceof HttpError) return send(res, e.status, { error: e.message }); if (e && e.code === 11000) return send(res, 409, { error: 'This record already exists' }); console.error(e); send(res, 500, { error: 'Something went wrong on the server' }); }
});

module.exports = { createServer };
