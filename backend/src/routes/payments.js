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
// ----- Razorpay: config for the browser, Pay now, signature verification, webhook -----
add('GET', '/api/config', async () => ({ razorpay: rzpOn(), keyId: rzpOn() ? RZP.id : '' }));
// "Pay now" / retry for an order whose online payment is still pending
add('POST', '/api/orders/:id/pay', CU, async ({ user, params }) => {
  const o = await own(user, params.id);
  if (o.paymentMode !== 'RAZORPAY' || o.paymentStatus !== 'PENDING' || o.status === 'CANCELLED') throw new HttpError(409, 'No online payment is pending for this order');
  return { razorpay: await startRzp(o) };
});
// step 2: Razorpay Checkout returned payment id + signature -> verify the signature on the server, then mark the order paid
add('POST', '/api/payments/razorpay/verify', CU, async ({ user, body }) => {
  const o = await own(user, body.orderId), rid = str(body.razorpay_order_id, 'Razorpay order id'), pid = str(body.razorpay_payment_id, 'Razorpay payment id'), sig = str(body.razorpay_signature, 'Signature');
  const pay = (await C.payments.find({ orderId: o._id }).toArray()).find((x) => (x.razorpayOrderIds || []).includes(rid));
  if (!pay) throw new HttpError(404, 'Payment not found for this order');
  if (!safeEq(sig, hmac(RZP.secret, rid + '|' + pid))) throw bad('Payment verification failed');
  await markPaid(o, pid); return { ok: true };
});
// optional safety net: Razorpay Dashboard -> Webhooks -> URL  https://YOUR-DOMAIN/api/payments/razorpay/webhook  (events: payment.captured, order.paid)
add('POST', '/api/payments/razorpay/webhook', async ({ req, body }) => {
  if (!RZP.hook) throw new HttpError(503, 'Webhook secret is not configured');
  if (!safeEq(String(req.headers['x-razorpay-signature'] || ''), hmac(RZP.hook, req.rawBody || ''))) throw bad('Invalid signature');
  const pe = body.payload && body.payload.payment && body.payload.payment.entity;
  if (pe && ['payment.captured', 'order.paid'].includes(body.event)) {
    const pay = (await C.payments.find({}).toArray()).find((x) => (x.razorpayOrderIds || []).includes(pe.order_id));
    const o = pay && (await C.orders.findOne({ _id: pay.orderId })); if (o) await markPaid(o, pe.id);
  }
  return { ok: true };
});
