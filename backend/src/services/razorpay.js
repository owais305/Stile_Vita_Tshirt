'use strict';
// Razorpay online payments: create order, verify signature, mark paid, refund (keys come from .env).
const crypto = require('crypto');
const { C } = require('../db');
const { HttpError } = require('../utils/helpers');

// ============================ RAZORPAY (online payments) ============================
// Put your keys in the environment (see env.example):  RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET (optional)
// Without keys the shop still works: online payment is then SIMULATED (demo mode).
const RZP = { id: process.env.RAZORPAY_KEY_ID || '', secret: process.env.RAZORPAY_KEY_SECRET || '', hook: process.env.RAZORPAY_WEBHOOK_SECRET || '' };
const rzpOn = () => !!(RZP.id && RZP.secret);
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest('hex');
const safeEq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
async function rzp(method, p, body) {           // call the Razorpay REST API (Basic auth = key id : key secret)
  if (!rzpOn()) throw new HttpError(503, 'Online payment is not configured');
  const r = await fetch('https://api.razorpay.com/v1' + p, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(RZP.id + ':' + RZP.secret).toString('base64') }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, 'Payment gateway error: ' + ((d.error && d.error.description) || r.status));
  return d;
}
// step 1: create a Razorpay order for our (unpaid) order; the browser opens Razorpay Checkout with this data
async function startRzp(order) {
  const ro = await rzp('POST', '/orders', { amount: Math.round(order.total * 100), currency: 'INR', receipt: order.orderNo, notes: { orderId: String(order._id), orderNo: order.orderNo } });
  const pay = (await C.payments.find({ orderId: order._id }).toArray())[0];
  await C.payments.updateMany({ orderId: order._id }, { $set: { razorpayOrderId: ro.id, razorpayOrderIds: [...(pay.razorpayOrderIds || []), ro.id] } });
  return { keyId: RZP.id, orderId: ro.id, amount: ro.amount, currency: ro.currency || 'INR', name: 'ABC Tees', description: 'Order ' + order.orderNo };
}
// step 3: payment verified -> mark paid (idempotent). A payment that arrives after the order was cancelled is refunded.
async function markPaid(o, paymentId) {
  if (o.paymentStatus === 'SUCCESS' || o.paymentStatus === 'REFUNDED') return;
  const now = new Date();
  if (o.status === 'CANCELLED') {
    let st = 'REFUND_PENDING'; try { await rzp('POST', `/payments/${paymentId}/refund`, { amount: Math.round(o.total * 100) }); st = 'REFUNDED'; } catch (e) { /* admin refunds from the Razorpay dashboard */ }
    await C.payments.updateMany({ orderId: o._id }, { $set: { status: st, txnRef: paymentId, razorpayPaymentId: paymentId } });
    await C.orders.updateOne({ _id: o._id }, { $set: { paymentStatus: st, updatedAt: now } }); return;
  }
  await C.payments.updateMany({ orderId: o._id }, { $set: { status: 'SUCCESS', paidAt: now, txnRef: paymentId, razorpayPaymentId: paymentId } });
  await C.orders.updateOne({ _id: o._id }, { $set: { paymentStatus: 'SUCCESS', updatedAt: now } });
}

module.exports = { RZP, rzpOn, hmac, safeEq, rzp, startRzp, markPaid };
