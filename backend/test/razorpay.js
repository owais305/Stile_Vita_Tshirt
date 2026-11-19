'use strict';
// npm test (part 2) -> tests the Razorpay integration with a FAKE Razorpay server (no internet, no real keys needed).
process.env.RAZORPAY_KEY_ID = 'rzp_test_KEYID'; process.env.RAZORPAY_KEY_SECRET = 'test_secret'; process.env.RAZORPAY_WEBHOOK_SECRET = 'hook_secret';
const Module = require('module'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'mongodb' ? path.join(__dirname, 'fakeMongo.js') : orig.call(this, r, ...a); };
const { MongoClient } = require('mongodb'), app = require('../server'), { C } = app;
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest('hex');

// ---- fake Razorpay API (intercepts fetch calls to api.razorpay.com) ----
const calls = []; let n = 0, failOrders = false, failRefund = false; const realFetch = global.fetch;
global.fetch = async (url, opt = {}) => {
  if (!String(url).startsWith('https://api.razorpay.com/v1')) return realFetch(url, opt);
  const body = opt.body ? JSON.parse(opt.body) : {}, ok = (d) => ({ ok: true, status: 200, json: async () => d }), no = (m) => ({ ok: false, status: 400, json: async () => ({ error: { description: m } }) });
  assert.strictEqual(opt.headers.Authorization, 'Basic ' + Buffer.from('rzp_test_KEYID:test_secret').toString('base64'));   // keys are sent as Basic auth
  calls.push({ url: String(url), body });
  if (url.endsWith('/orders')) return failOrders ? no('Authentication failed') : ok({ id: 'order_T' + (++n), amount: body.amount, currency: body.currency });
  if (/\/payments\/.+\/refund$/.test(url)) return failRefund ? no('Refund failed') : ok({ id: 'rfnd_T' + (++n), amount: body.amount });
  return no('unknown');
};
let pass = 0, fails = 0;
const test = async (t, f) => { try { await f(); pass++; console.log('  \u2713 ' + t); } catch (e) { fails++; console.log('  \u2717 ' + t + '\n      ' + e.message); } };
class Client {
  constructor(b) { this.b = b; this.ck = {}; }
  async call(m, u, body, headers = {}, raw) {
    const h = { 'Content-Type': 'application/json', ...headers }, c = Object.entries(this.ck).map(([k, v]) => k + '=' + v).join('; '); if (c) h.Cookie = c;
    const r = await realFetch(this.b + u, { method: m, headers: h, body: m === 'GET' ? undefined : raw || JSON.stringify(body || {}) });
    r.headers.getSetCookie().forEach((x) => { const [kv] = x.split(';'), i = kv.indexOf('='); this.ck[kv.slice(0, i)] = kv.slice(i + 1); });
    let d = null; try { d = await r.json(); } catch (e) { /* none */ } return { status: r.status, data: d };
  }
  get(u) { return this.call('GET', u); } post(u, b, h, raw) { return this.call('POST', u, b, h, raw); }
}
(async () => {
  await app.initDb(new MongoClient(), 'rz'); await app.ensureAdmin(); await require('../src/seed/demoData').seedDemo(app, true);
  const srv = app.createServer(); await new Promise((r) => srv.listen(0, r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const cust = new Client(base), other = new Client(base), admin = new Client(base);
  await cust.post('/api/auth/login', { email: 'demo@example.com', password: 'demo123' });
  await other.post('/api/auth/register', { name: 'Other', email: 'other@example.com', phone: '9000000009', password: 'secret1' });
  await admin.post('/api/admin/login', { username: 'admin', password: 'admin123' });
  const stores = (await cust.get('/api/stores')).data, prod = (await cust.get('/api/products')).data.find((p) => p.name === 'Polo Sport Tee');
  const qty = async (size) => (await C.inventory.findOne({ storeId: app.toId(String(stores[0]._id)), productId: app.toId(String(prod._id)), size })).qty;
  const place = (size = 'M', q = 1) => cust.post('/api/orders', { fulfilmentMode: 'STORE_PICKUP', storeId: stores[0]._id, paymentMode: 'RAZORPAY', items: [{ productId: prod._id, size, qty: q }] });
  console.log('\nRazorpay integration tests\n');
  await test('config tells the browser that Razorpay is enabled (key id only, never the secret)', async () => { const d = (await cust.get('/api/config')).data; assert.ok(d.razorpay && d.keyId === 'rzp_test_KEYID' && !JSON.stringify(d).includes('test_secret')); });
  let o1;
  await test('placing a RAZORPAY order creates a Razorpay order (amount in paise), reserves stock, payment stays PENDING', async () => {
    const before = await qty('M'), r = await place('M', 2); assert.strictEqual(r.status, 201, JSON.stringify(r.data)); o1 = r.data;
    assert.ok(o1.razorpay.orderId.startsWith('order_T') && o1.razorpay.keyId === 'rzp_test_KEYID' && o1.razorpay.amount === 169800 && o1.razorpay.currency === 'INR');
    assert.strictEqual(o1.paymentStatus, 'PENDING'); assert.strictEqual(await qty('M'), before - 2);
    const c = calls[calls.length - 1]; assert.ok(c.url.endsWith('/orders') && c.body.receipt === o1.orderNo);
  });
  await test('a wrong signature is rejected and the order stays unpaid', async () => {
    const r = await cust.post('/api/payments/razorpay/verify', { orderId: o1._id, razorpay_order_id: o1.razorpay.orderId, razorpay_payment_id: 'pay_1', razorpay_signature: 'bad' }); assert.strictEqual(r.status, 400);
    assert.strictEqual((await C.orders.findOne({ orderNo: o1.orderNo })).paymentStatus, 'PENDING');
  });
  await test("another customer cannot verify someone else's order", async () => {
    const sig = hmac('test_secret', o1.razorpay.orderId + '|pay_1'); assert.strictEqual((await other.post('/api/payments/razorpay/verify', { orderId: o1._id, razorpay_order_id: o1.razorpay.orderId, razorpay_payment_id: 'pay_1', razorpay_signature: sig })).status, 404);
  });
  await test('a correct signature marks the order PAID (payment id saved); verifying twice is harmless', async () => {
    const body = { orderId: o1._id, razorpay_order_id: o1.razorpay.orderId, razorpay_payment_id: 'pay_OK1', razorpay_signature: hmac('test_secret', o1.razorpay.orderId + '|pay_OK1') };
    assert.strictEqual((await cust.post('/api/payments/razorpay/verify', body)).status, 200); assert.strictEqual((await cust.post('/api/payments/razorpay/verify', body)).status, 200);
    const d = (await cust.get('/api/orders/' + o1._id)).data; assert.ok(d.order.paymentStatus === 'SUCCESS' && d.payments[0].status === 'SUCCESS' && d.payments[0].txnRef === 'pay_OK1' && d.payments[0].paidAt);
  });
  await test('cancelling a paid order refunds the money through Razorpay and returns the stock', async () => {
    const before = await qty('M'), r = await admin.call('PUT', '/api/admin/orders/' + o1._id + '/status', { status: 'CANCELLED' }); assert.strictEqual(r.status, 200);
    const c = calls[calls.length - 1]; assert.ok(c.url.endsWith('/payments/pay_OK1/refund') && c.body.amount === 169800);
    assert.ok((await C.orders.findOne({ orderNo: o1.orderNo })).paymentStatus === 'REFUNDED' && (await qty('M')) === before + 2);
  });
  await test('if the refund API fails the order is marked REFUND_PENDING (admin refunds manually)', async () => {
    const r = await place('L'); const pid = 'pay_OK2'; await cust.post('/api/payments/razorpay/verify', { orderId: r.data._id, razorpay_order_id: r.data.razorpay.orderId, razorpay_payment_id: pid, razorpay_signature: hmac('test_secret', r.data.razorpay.orderId + '|' + pid) });
    failRefund = true; await admin.call('PUT', '/api/admin/orders/' + r.data._id + '/status', { status: 'CANCELLED' }); failRefund = false;
    assert.strictEqual((await C.orders.findOne({ orderNo: r.data.orderNo })).paymentStatus, 'REFUND_PENDING');
  });
  await test('"Pay now" retry creates a new Razorpay order; a payment on the FIRST attempt is still accepted', async () => {
    const r = await place('S'); const first = r.data.razorpay.orderId, again = (await cust.post('/api/orders/' + r.data._id + '/pay', {})).data.razorpay;
    assert.ok(again.orderId !== first && again.amount === r.data.razorpay.amount);
    assert.strictEqual((await cust.post('/api/payments/razorpay/verify', { orderId: r.data._id, razorpay_order_id: first, razorpay_payment_id: 'pay_OK3', razorpay_signature: hmac('test_secret', first + '|pay_OK3') })).status, 200);
    assert.strictEqual((await cust.post('/api/orders/' + r.data._id + '/pay', {})).status, 409);   // already paid
  });
  await test('webhook: wrong signature refused; payment.captured marks the order paid', async () => {
    const r = await place('XL'), ev = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_WH1', order_id: r.data.razorpay.orderId, amount: r.data.razorpay.amount } } } });
    const w = new Client(base); assert.strictEqual((await w.post('/api/payments/razorpay/webhook', null, { 'X-Razorpay-Signature': 'bad' }, ev)).status, 400);
    assert.strictEqual((await w.post('/api/payments/razorpay/webhook', null, { 'X-Razorpay-Signature': hmac('hook_secret', ev) }, ev)).status, 200);
    const d = await C.orders.findOne({ orderNo: r.data.orderNo }); assert.strictEqual(d.paymentStatus, 'SUCCESS');
    assert.strictEqual((await w.post('/api/payments/razorpay/webhook', null, { 'X-Razorpay-Signature': hmac('hook_secret', ev) }, ev)).status, 200);   // repeated webhook is harmless
  });
  await test('unpaid Razorpay orders are cancelled after the time limit and the stock is released', async () => {
    const before = await qty('M'), r = await place('M', 3); assert.strictEqual(await qty('M'), before - 3);
    await C.orders.updateOne({ orderNo: r.data.orderNo }, { $set: { createdAt: new Date(Date.now() - 40 * 60000) } }); await app.sweepUnpaid();
    const d = await C.orders.findOne({ orderNo: r.data.orderNo }); assert.ok(d.status === 'CANCELLED' && d.paymentStatus === 'CANCELLED' && (await qty('M')) === before);
  });
  await test('a payment that arrives after the order was cancelled is refunded automatically', async () => {
    const r = await place('M'); await cust.post('/api/orders/' + r.data._id + '/cancel', {}); const pid = 'pay_LATE';
    const w = new Client(base), ev = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: pid, order_id: r.data.razorpay.orderId } } } });
    await w.post('/api/payments/razorpay/webhook', null, { 'X-Razorpay-Signature': hmac('hook_secret', ev) }, ev);
    assert.ok(calls[calls.length - 1].url.endsWith('/payments/pay_LATE/refund')); assert.strictEqual((await C.orders.findOne({ orderNo: r.data.orderNo })).paymentStatus, 'REFUNDED');
  });
  await test('if Razorpay is down the order is NOT kept and the stock is restored', async () => {
    const before = await qty('M'); failOrders = true; const r = await place('M'); failOrders = false;
    assert.strictEqual(r.status, 502); assert.strictEqual(await qty('M'), before);
  });
  await test('simulated payment modes are not accepted while Razorpay is enabled; COD / pay-at-store still are', async () => {
    assert.strictEqual((await cust.post('/api/orders', { fulfilmentMode: 'STORE_PICKUP', storeId: stores[0]._id, paymentMode: 'UPI', items: [{ productId: prod._id, size: 'M', qty: 1 }] })).status, 400);
    assert.strictEqual((await cust.post('/api/orders', { fulfilmentMode: 'STORE_PICKUP', storeId: stores[0]._id, paymentMode: 'PAY_AT_STORE', items: [{ productId: prod._id, size: 'M', qty: 1 }] })).status, 201);
  });
  srv.close(); console.log(`\n${pass} passed, ${fails} failed\n`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
