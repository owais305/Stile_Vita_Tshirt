'use strict';
const crypto = require('crypto');
const { C } = require('../db');
const { HttpError, bad, str, intv, money, email, phone, pin, oneOf, r2, esc, toId, mustId, created } = require('../utils/helpers');
const { hashPw, checkPw, sign, blocked, fail } = require('../utils/security');
const { SIZES, FREE, CHARGE, MAXQ, REORDER, FLOW, FINAL, ONLINE_PAY, buildLines, reserve, release, hasStock, chooseStore, createOrder, canCancel, cancelOrder, nextStatus, nextOf } = require('../services/orders');
const { stockIndex, catMap, decorate } = require('../services/catalog');
const { saveImage, cleanImg } = require('../services/images');
const { RZP, rzpOn, rzp, hmac, safeEq, startRzp, markPaid } = require('../services/razorpay');
const { add, AD, CU, pub, dup, own } = require('./shared');
// ----- Pages everybody can read: categories, stores, products -----
// ---------- public ----------
add('GET', '/api/categories', async () => C.categories.find({}).sort({ name: 1 }).toArray());
add('GET', '/api/stores', async () => C.stores.find({}).sort({ city: 1 }).toArray());
add('GET', '/api/products', async ({ query: q }) => {
  const f = { isActive: true }; if (q.category) f.categoryId = mustId(q.category, 'category');
  if (q.search) { const re = new RegExp(esc(String(q.search).slice(0, 60)), 'i'); f.$or = [{ name: re }, { brand: re }, { colour: re }]; }
  const idx = await stockIndex(), cats = await catMap();
  let l = (await C.products.find(f).toArray()).map((p) => decorate(p, idx, cats)); if (q.inStock === '1') l = l.filter((p) => p.inStock);
  if (q.sort === 'price_asc') l.sort((a, b) => a.price - b.price); else if (q.sort === 'price_desc') l.sort((a, b) => b.price - a.price); else l.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return l;
});
add('GET', '/api/products/:id', async ({ params }) => {
  const p = await C.products.findOne({ _id: mustId(params.id, 'product') }); if (!p || !p.isActive) throw new HttpError(404, 'Product not found');
  const idx = await stockIndex(), out = decorate(p, idx, await catMap()), by = (idx.get(String(p._id)) || { stores: {} }).stores;
  out.availability = (await C.stores.find({}).sort({ city: 1 }).toArray()).map((s) => ({ storeId: s._id, name: s.name, city: s.city, sizes: Object.fromEntries(p.sizes.map((z) => [z, p.manualOutOfStock ? 0 : (by[String(s._id)] || {})[z] || 0])) }));
  return out;
});
