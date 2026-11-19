'use strict';
// Shop logic: stock reservation, orders, order life-cycle, refunds, auto-cancel of unpaid orders.
const crypto = require('crypto');
const { C } = require('../db');
const { HttpError, bad, toId, r2, addDays } = require('../utils/helpers');
const { rzp } = require('./razorpay');

const SIZES = ['S', 'M', 'L', 'XL', 'XXL'], FREE = 999, CHARGE = 60, MAXQ = 10, REORDER = 5;
const FLOW = { HOME_DELIVERY: ['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED'], STORE_PICKUP: ['PLACED', 'CONFIRMED', 'READY_FOR_PICKUP', 'COLLECTED'], IN_STORE_PURCHASE: ['COMPLETED'] };
const FINAL = ['DELIVERED', 'COLLECTED', 'COMPLETED', 'CANCELLED'];
const ONLINE_PAY = ['UPI', 'DEBIT_CARD', 'CREDIT_CARD', 'NET_BANKING'];
const unwrap = (r) => (r && r.ok !== undefined && 'value' in r ? r.value : r);

async function buildLines(raw) {
  if (!Array.isArray(raw) || !raw.length) throw bad('The cart is empty');
  if (raw.length > 30) throw bad('Too many items');
  const m = new Map();
  for (const it of raw) {
    const pid = toId(it && it.productId); if (!pid) throw bad('Invalid product');
    const qty = Number(it.qty); if (!Number.isInteger(qty) || qty < 1) throw bad('Quantity must be at least 1');
    const k = pid + '|' + it.size; if (m.has(k)) m.get(k).qty += qty; else m.set(k, { pid, size: String(it.size || ''), qty });
  }
  const lines = [];
  for (const x of m.values()) {
    const p = await C.products.findOne({ _id: x.pid });
    if (!p || !p.isActive) throw bad('A product in your cart is no longer available');
    if (p.manualOutOfStock) throw new HttpError(409, `"${p.name}" is out of stock`);
    if (!p.sizes.includes(x.size)) throw bad(`Invalid size for "${p.name}"`);
    if (x.qty > MAXQ) throw bad(`You can buy at most ${MAXQ} pieces of one item`);
    lines.push({ productId: p._id, name: p.name, size: x.size, qty: x.qty, unitPrice: p.price, discount: 0, lineTotal: r2(p.price * x.qty), image: p.image || '' });
  }
  return lines;
}
// stock is reduced by ONE atomic conditional update per item -> the last piece can never be sold twice
async function reserve(storeId, lines) {
  const done = [];
  for (const l of lines) {
    const r = unwrap(await C.inventory.findOneAndUpdate({ storeId, productId: l.productId, size: l.size, qty: { $gte: l.qty } },
      { $inc: { qty: -l.qty }, $set: { updatedAt: new Date() } }, { returnDocument: 'after' }));
    if (!r) { await release(storeId, done); throw new HttpError(409, `Sorry, "${l.name}" (size ${l.size}) is out of stock or has fewer than ${l.qty} piece(s) left`); }
    done.push(l);
  }
}
const release = async (storeId, lines) => { for (const l of lines) await C.inventory.updateOne({ storeId, productId: l.productId, size: l.size }, { $inc: { qty: l.qty }, $set: { updatedAt: new Date() } }, { upsert: true }); };
async function hasStock(storeId, lines) { for (const l of lines) if (!(await C.inventory.findOne({ storeId, productId: l.productId, size: l.size, qty: { $gte: l.qty } }))) return false; return true; }
async function chooseStore(lines, address) {   // home delivery: a store that has everything, same city first
  const stores = await C.stores.find({}).toArray(), city = String(address.city).toLowerCase();
  stores.sort((a, b) => (String(b.city).toLowerCase() === city) - (String(a.city).toLowerCase() === city));
  for (const s of stores) if (await hasStock(s._id, lines)) return s; return null;
}
async function createOrder({ channel, mode, customer, store, emp, lines, paymentMode, address, walkInName }) {
  const subtotal = r2(lines.reduce((s, l) => s + l.lineTotal, 0)), deliveryCharge = mode === 'HOME_DELIVERY' && subtotal < FREE ? CHARGE : 0, total = r2(subtotal + deliveryCharge);
  const paid = (channel === 'ONLINE' && ONLINE_PAY.includes(paymentMode)) || channel === 'IN_STORE', now = new Date();
  await reserve(store._id, lines);                                   // <- stock reduced here
  const d = new Date(), order = {
    orderNo: 'TS-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    channel, fulfilmentMode: mode, status: mode === 'IN_STORE_PURCHASE' ? 'COMPLETED' : 'PLACED',
    customerId: customer ? customer._id : null, customerName: customer ? customer.name : walkInName || 'Walk-in customer',
    storeId: store._id, storeName: store.name, empId: emp ? emp._id : null, empName: emp ? emp.name : '',
    items: lines, subtotal, deliveryCharge, total, paymentMode, paymentStatus: paid ? 'SUCCESS' : 'PENDING', createdAt: now, updatedAt: now };
  try {
    order._id = (await C.orders.insertOne(order)).insertedId;
    await C.payments.insertOne({ orderId: order._id, orderNo: order.orderNo, mode: paymentMode, amount: total, status: order.paymentStatus,
      txnRef: paid && paymentMode !== 'CASH' ? 'SIM' + crypto.randomBytes(5).toString('hex').toUpperCase() : '', paidAt: paid ? now : null, createdAt: now });
    if (mode === 'HOME_DELIVERY') await C.deliveries.insertOne({ orderId: order._id, orderNo: order.orderNo, addressId: address._id,
      address: { name: address.name, phone: address.phone, line: address.line, city: address.city, state: address.state, pincode: address.pincode },
      courier: '', trackingNo: '', shippedDate: null, expectedDate: addDays(now, 5), deliveredDate: null, status: 'PENDING', createdAt: now });
  } catch (e) { await release(store._id, lines); throw e; }
  return order;
}
const canCancel = (o, admin) => !FINAL.includes(o.status) && o.status !== 'SHIPPED' && (admin || ['PLACED', 'CONFIRMED'].includes(o.status));
async function cancelOrder(o, admin) {
  if (!canCancel(o, admin)) throw new HttpError(409, `An order that is "${o.status}" can no longer be cancelled`);
  let ps = o.paymentStatus === 'SUCCESS' ? 'REFUNDED' : 'CANCELLED';
  if (o.paymentStatus === 'SUCCESS') {            // money paid through Razorpay is refunded automatically
    const paid = (await C.payments.find({ orderId: o._id }).toArray()).find((x) => x.razorpayPaymentId);
    if (paid) { try { const rf = await rzp('POST', `/payments/${paid.razorpayPaymentId}/refund`, { amount: Math.round(o.total * 100), notes: { orderNo: o.orderNo } }); await C.payments.updateMany({ orderId: o._id }, { $set: { refundId: rf.id } }); } catch (e) { ps = 'REFUND_PENDING'; } }
  }
  await release(o.storeId, o.items);                                  // <- stock put back
  await C.orders.updateOne({ _id: o._id }, { $set: { status: 'CANCELLED', paymentStatus: ps, updatedAt: new Date() } });
  await C.payments.updateMany({ orderId: o._id }, { $set: { status: ps } });
  await C.deliveries.updateMany({ orderId: o._id }, { $set: { status: 'CANCELLED' } });
}
async function nextStatus(o, next) {
  if (next === 'CANCELLED') return cancelOrder(o, true);
  const f = FLOW[o.fulfilmentMode] || [], i = f.indexOf(o.status);
  if (i < 0 || f[i + 1] !== next) throw new HttpError(409, `Cannot change "${o.status}" to "${next}"`);
  const now = new Date(), set = { status: next, updatedAt: now };
  if (['DELIVERED', 'COLLECTED'].includes(next) && o.paymentStatus === 'PENDING') { set.paymentStatus = 'SUCCESS'; await C.payments.updateMany({ orderId: o._id }, { $set: { status: 'SUCCESS', paidAt: now } }); }
  await C.orders.updateOne({ _id: o._id }, { $set: set });
  const ds = { PACKED: { status: 'PACKED' }, SHIPPED: { status: 'DISPATCHED', shippedDate: now }, DELIVERED: { status: 'DELIVERED', deliveredDate: now } }[next];
  if (ds && o.fulfilmentMode === 'HOME_DELIVERY') await C.deliveries.updateMany({ orderId: o._id }, { $set: ds });
}
const nextOf = (o) => { const f = FLOW[o.fulfilmentMode] || [], i = f.indexOf(o.status); return i >= 0 && i < f.length - 1 ? f[i + 1] : null; };

// unpaid Razorpay orders are cancelled after UNPAID_MINUTES (default 30) so that the reserved stock is released
async function sweepUnpaid() {
  const limit = new Date(Date.now() - (Number(process.env.UNPAID_MINUTES) || 30) * 60000);
  for (const o of await C.orders.find({ paymentMode: 'RAZORPAY', paymentStatus: 'PENDING', status: 'PLACED', createdAt: { $lt: limit } }).toArray()) await cancelOrder(o, true).catch(console.error);
}

module.exports = { SIZES, FREE, CHARGE, MAXQ, REORDER, FLOW, FINAL, ONLINE_PAY, unwrap, buildLines, reserve, release, hasStock, chooseStore, createOrder, canCancel, cancelOrder, nextStatus, nextOf, sweepUnpaid };
