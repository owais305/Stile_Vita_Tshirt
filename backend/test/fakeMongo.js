'use strict';
// IN-MEMORY stand-in for the `mongodb` driver, used ONLY by `npm test` (so tests run without a MongoDB server).
// It implements just the driver calls used by this project. The real app uses the real `mongodb` package.
const crypto = require('crypto');
class ObjectId {
  constructor(i) { this.id = i instanceof ObjectId ? i.id : typeof i === 'string' && /^[0-9a-f]{24}$/i.test(i) ? i.toLowerCase() : crypto.randomBytes(12).toString('hex'); }
  toString() { return this.id; } toJSON() { return this.id; } equals(o) { return String(o) === this.id; }
}
const isObj = (v) => v && typeof v === 'object' && !(v instanceof ObjectId) && !(v instanceof Date) && !Array.isArray(v) && !(v instanceof RegExp);
const clone = (v) => v instanceof ObjectId ? new ObjectId(v.id) : v instanceof Date ? new Date(v) : Array.isArray(v) ? v.map(clone) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v;
const norm = (v) => (v instanceof ObjectId ? 'oid:' + v.id : v instanceof Date ? +v : v);
function getPath(doc, path) {
  let cur = [doc];
  for (const k of path.split('.')) { const nx = []; for (const o of cur) { if (o == null) nx.push(undefined); else if (Array.isArray(o) && !/^\d+$/.test(k)) o.forEach((x) => x && typeof x === 'object' && nx.push(x[k])); else nx.push(o[k]); } cur = nx; }
  return cur.length === 1 ? cur[0] : cur;
}
function setPath(d, path, v) { const k = path.split('.'); let o = d; for (let i = 0; i < k.length - 1; i++) { if (!isObj(o[k[i]])) o[k[i]] = {}; o = o[k[i]]; } o[k[k.length - 1]] = v; }
const isOps = (c) => isObj(c) && Object.keys(c).length && Object.keys(c).every((k) => k[0] === '$');
function fieldMatch(val, cond) {
  const eq = (x, y) => norm(x) === norm(y);
  if (cond instanceof RegExp) return typeof val === 'string' && cond.test(val);
  if (isOps(cond)) return Object.entries(cond).every(([op, a]) => {
    if (op === '$gte') return val != null && norm(val) >= norm(a); if (op === '$gt') return val != null && norm(val) > norm(a);
    if (op === '$lte') return val != null && norm(val) <= norm(a); if (op === '$lt') return val != null && norm(val) < norm(a);
    if (op === '$ne') return !eq(val, a); if (op === '$in') return a.some((x) => (Array.isArray(val) ? val.some((y) => eq(y, x)) : eq(val, x)));
    if (op === '$exists') return (val !== undefined) === !!a; throw new Error('fakeMongo: unsupported ' + op);
  });
  return Array.isArray(val) && !Array.isArray(cond) ? val.some((x) => eq(x, cond)) : eq(val, cond);
}
const matches = (d, f) => Object.entries(f || {}).every(([k, c]) => (k === '$or' ? c.some((x) => matches(d, x)) : k === '$and' ? c.every((x) => matches(d, x)) : fieldMatch(getPath(d, k), c)));
function apply(d, u, ins) {
  for (const [op, s] of Object.entries(u)) for (const [k, v] of Object.entries(s)) {
    if (op === '$set') setPath(d, k, clone(v)); else if (op === '$setOnInsert') { if (ins) setPath(d, k, clone(v)); } else if (op === '$inc') setPath(d, k, (getPath(d, k) || 0) + v); else throw new Error('fakeMongo: unsupported ' + op);
  }
}
class Cursor {
  constructor(a) { this.a = a; }
  sort(s) { const e = Object.entries(s); this.a.sort((x, y) => { for (const [k, dir] of e) { const p = norm(getPath(x, k)), q = norm(getPath(y, k)); if (p !== q) return (p < q ? -1 : 1) * dir; } return 0; }); return this; }
  limit(n) { if (n) this.a = this.a.slice(0, n); return this; }
  async toArray() { return this.a.map(clone); }
}
class Coll {
  constructor() { this.d = []; this.u = []; }
  async createIndex(s, o = {}) { if (o.unique) this.u.push(Object.keys(s)); }
  chk(doc, skip) { for (const ks of this.u) { const t = ks.map((k) => norm(getPath(doc, k))); this.d.forEach((x, i) => { if (i !== skip && ks.map((k) => norm(getPath(x, k))).every((v, j) => v === t[j])) { const e = new Error('E11000 duplicate key'); e.code = 11000; throw e; } }); } }
  async insertOne(doc) { const d = clone(doc); if (!d._id) d._id = new ObjectId(); this.chk(d, -1); this.d.push(d); return { insertedId: d._id }; }
  async insertMany(a) { for (const x of a) await this.insertOne(x); return { insertedCount: a.length }; }
  find(f = {}) { return new Cursor(this.d.filter((x) => matches(x, f))); }
  async findOne(f = {}) { return (await this.find(f).limit(1).toArray())[0] || null; }
  async countDocuments(f = {}) { return this.d.filter((x) => matches(x, f)).length; }
  up(f, u) { const d = {}; for (const [k, v] of Object.entries(f)) if (k[0] !== '$' && !isOps(v)) setPath(d, k, clone(v)); apply(d, u, true); d._id = d._id || new ObjectId(); return d; }
  async updateOne(f, u, o = {}) {
    const i = this.d.findIndex((x) => matches(x, f));
    if (i < 0) { if (o.upsert) { const d = this.up(f, u); this.chk(d, -1); this.d.push(d); return { matchedCount: 0 }; } return { matchedCount: 0 }; }
    const c = clone(this.d[i]); apply(c, u, false); this.chk(c, i); this.d[i] = c; return { matchedCount: 1 };
  }
  async updateMany(f, u) { let n = 0; this.d.forEach((x, i) => { if (matches(x, f)) { const c = clone(x); apply(c, u, false); this.d[i] = c; n++; } }); return { matchedCount: n }; }
  async findOneAndUpdate(f, u, o = {}) { const i = this.d.findIndex((x) => matches(x, f)); if (i < 0) return null; const b = clone(this.d[i]), a = clone(b); apply(a, u, false); this.d[i] = a; return o.returnDocument === 'after' ? clone(a) : b; }
  async deleteOne(f) { const i = this.d.findIndex((x) => matches(x, f)); if (i >= 0) this.d.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; }
  async deleteMany(f) { const n = this.d.length; this.d = this.d.filter((x) => !matches(x, f)); return { deletedCount: n - this.d.length }; }
}
class MongoClient { constructor() { this.c = {}; } async connect() {} db() { return { collection: (n) => (this.c[n] = this.c[n] || new Coll()) }; } async close() {} }
module.exports = { MongoClient, ObjectId };
