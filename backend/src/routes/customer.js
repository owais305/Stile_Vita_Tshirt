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
// ----- Customer: register / login, profile, addresses, orders -----
// ---------- customer ----------
const setSess = (ctx, u) => ctx.setCookie('ts_token', sign({ id: String(u._id), role: 'customer' }, 7 * 86400000), 7 * 86400);
add('POST', '/api/auth/register', async (ctx) => {
  const b = ctx.body, u = { name: str(b.name, 'Name', 80), email: email(b.email), phone: phone(b.phone), passwordHash: hashPw(str(b.password, 'Password', 100)), createdAt: new Date() };
  if (b.password.length < 6) throw bad('Password must have at least 6 characters');
  try { u._id = (await C.customers.insertOne(u)).insertedId; } catch (e) { dup(e, 'An account with this e-mail already exists'); }
  setSess(ctx, u); return created(pub(u));
});
add('POST', '/api/auth/login', async (ctx) => {
  const k = 'c:' + ctx.ip; if (blocked(k)) throw new HttpError(429, 'Too many failed attempts. Try again later.');
  const u = await C.customers.findOne({ email: String(ctx.body.email || '').trim().toLowerCase() });
  if (!u || !checkPw(String(ctx.body.password || ''), u.passwordHash)) { fail(k); throw new HttpError(401, 'Wrong e-mail or password'); }
  setSess(ctx, u); return pub(u);
});
add('POST', '/api/auth/logout', async (ctx) => { ctx.setCookie('ts_token', '', 0); return { ok: true }; });
add('GET', '/api/me', { auth: 'customer?' }, async ({ user }) => ({ user: user ? pub(user) : null }));
add('PUT', '/api/me', CU, async ({ user, body }) => { const s = { name: str(body.name, 'Name', 80), phone: phone(body.phone) }; await C.customers.updateOne({ _id: user._id }, { $set: s }); return pub({ ...user, ...s }); });
const parseAddr = (b) => ({ label: oneOf(b.label || 'Home', 'Address type', ['Home', 'Office', 'Other']), name: str(b.name, 'Receiver name', 80), phone: phone(b.phone), line: str(b.line, 'Address'), city: str(b.city, 'City', 60), state: str(b.state, 'State', 60), pincode: pin(b.pincode) });
add('GET', '/api/me/addresses', CU, async ({ user }) => C.addresses.find({ customerId: user._id }).sort({ createdAt: -1 }).toArray());
add('POST', '/api/me/addresses', CU, async ({ user, body }) => {
  if ((await C.addresses.countDocuments({ customerId: user._id })) >= 10) throw bad('You can save at most 10 addresses');
  const a = { ...parseAddr(body), customerId: user._id, createdAt: new Date() }; a._id = (await C.addresses.insertOne(a)).insertedId; return created(a);
});
add('PUT', '/api/me/addresses/:id', CU, async ({ user, params, body }) => { const r = await C.addresses.updateOne({ _id: mustId(params.id), customerId: user._id }, { $set: parseAddr(body) }); if (!r.matchedCount) throw new HttpError(404, 'Address not found'); return { ok: true }; });
add('DELETE', '/api/me/addresses/:id', CU, async ({ user, params }) => { const r = await C.addresses.deleteOne({ _id: mustId(params.id), customerId: user._id }); if (!r.deletedCount) throw new HttpError(404, 'Address not found'); return { ok: true }; });
add('POST', '/api/orders', CU, async ({ user, body }) => {
  const mode = oneOf(body.fulfilmentMode, 'Delivery option', ['HOME_DELIVERY', 'STORE_PICKUP']);
  const pay = oneOf(body.paymentMode, 'Payment mode', [...(rzpOn() ? ['RAZORPAY'] : ONLINE_PAY), mode === 'HOME_DELIVERY' ? 'COD' : 'PAY_AT_STORE']);
  const lines = await buildLines(body.items); let store, address = null;
  if (mode === 'HOME_DELIVERY') {
    address = await C.addresses.findOne({ _id: mustId(body.addressId, 'address'), customerId: user._id }); if (!address) throw bad('Please choose a delivery address');
    store = await chooseStore(lines, address); if (!store) throw new HttpError(409, 'Some of the selected items are not available for delivery right now. Reduce the quantity or remove the item.');
  } else {
    store = await C.stores.findOne({ _id: mustId(body.storeId, 'store') }); if (!store) throw bad('Please choose a store for pick-up');
    if (!(await hasStock(store._id, lines))) throw new HttpError(409, `"${store.name}" does not have all the selected items in stock. Choose another store.`);
  }
  const order = await createOrder({ channel: 'ONLINE', mode, customer: user, store, lines, paymentMode: pay, address });
  if (pay !== 'RAZORPAY') return created(order);
  try { return created({ ...order, razorpay: await startRzp(order) }); }           // stock is reserved; the customer now pays on Razorpay
  catch (e) { await cancelOrder(order, true).catch(() => {}); throw e; }             // gateway down -> release the stock again
});
add('GET', '/api/orders', CU, async ({ user }) => C.orders.find({ customerId: user._id }).sort({ createdAt: -1 }).toArray());
add('GET', '/api/orders/:id', CU, async ({ user, params }) => { const o = await own(user, params.id); return { order: o, payments: await C.payments.find({ orderId: o._id }).toArray(), delivery: await C.deliveries.findOne({ orderId: o._id }), store: await C.stores.findOne({ _id: o.storeId }), flow: FLOW[o.fulfilmentMode], canCancel: canCancel(o, false) }; });
add('POST', '/api/orders/:id/cancel', CU, async ({ user, params }) => { await cancelOrder(await own(user, params.id), false); return { ok: true }; });
