'use strict';
// npm test (part 3) -> UPI / Google Pay / PhonePe / Paytm option in Razorpay Checkout (fake Razorpay server, no internet, no real keys).
process.env.RAZORPAY_KEY_ID = 'rzp_test_KEYID'; process.env.RAZORPAY_KEY_SECRET = 'test_secret';
const Module = require('module'), path = require('path'), assert = require('assert'), crypto = require('crypto'), fs = require('fs'), cp = require('child_process');
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'mongodb' ? path.join(__dirname, 'fakeMongo.js') : orig.call(this, r, ...a); };
const { MongoClient } = require('mongodb'), app = require('../server'), { C } = app;
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest('hex');
const FE = path.join(__dirname, '..', '..', 'frontend', 'client');
const RZ = require(path.join(FE, 'js', 'rzp-options.js'));
let n = 0; const realFetch = global.fetch;
global.fetch = async (url, opt = {}) => { if (!String(url).startsWith('https://api.razorpay.com/v1')) return realFetch(url, opt); const b = JSON.parse(opt.body || '{}'); return { ok: true, status: 200, json: async () => ({ id: 'order_U' + (++n), amount: b.amount, currency: b.currency }) }; };
let pass = 0, fails = 0;
const test = async (t, f) => { try { await f(); pass++; console.log('  \u2713 ' + t); } catch (e) { fails++; console.log('  \u2717 ' + t + '\n      ' + e.message); } };
const info = { keyId: 'rzp_test_KEYID', orderId: 'order_X', amount: 49900, currency: 'INR', name: 'ABC Tees', description: 'Order 1' };
(async () => {
  console.log('\nUPI (Google Pay / PhonePe / Paytm) tests\n');
  await test('UPI mode: a UPI block is shown first and the other methods stay available', async () => {
    const o = RZ.build(info, { name: 'A', email: 'a@b.c', phone: '9000000001' }, { method: 'upi' }), d = o.config.display;
    assert.deepStrictEqual(d.sequence, ['block.upi']); assert.deepStrictEqual(d.blocks.upi.instruments, [{ method: 'upi' }]); assert.strictEqual(d.preferences.show_default_blocks, true);
    assert.ok(/Google Pay/.test(d.blocks.upi.name) && /PhonePe/.test(d.blocks.upi.name) && /Paytm/.test(d.blocks.upi.name));
  });
  await test('UPI is the default when no method is given; "all" uses the normal Razorpay screen', async () => {
    assert.ok(RZ.build(info, {}, {}).config); assert.strictEqual(RZ.build(info, {}, { method: 'all' }).config, undefined);
  });
  await test('order id, amount, key and customer prefill are passed to Razorpay unchanged', async () => {
    const o = RZ.build(info, { name: 'A', email: 'a@b.c', phone: '9000000001' }, {}); assert.ok(o.key === 'rzp_test_KEYID' && o.order_id === 'order_X' && o.amount === 49900 && o.currency === 'INR');
    assert.deepStrictEqual(o.prefill, { name: 'A', email: 'a@b.c', contact: '9000000001' }); assert.ok(!JSON.stringify(o).includes('test_secret'));
  });
  await test('closing the payment window calls onDismiss; a missing user does not crash', async () => {
    let dismissed = false; const o = RZ.build(info, null, { onDismiss: () => { dismissed = true; } }); o.modal.ondismiss(); assert.ok(dismissed); assert.strictEqual(o.prefill.name, '');
  });
  await test('frontend files have valid JavaScript syntax and index.html loads rzp-options.js before app.js', async () => {
    for (const f of ['js/app.js', 'js/rzp-options.js']) cp.execFileSync(process.execPath, ['--check', path.join(FE, f)]);
    const h = fs.readFileSync(path.join(FE, 'index.html'), 'utf8'); assert.ok(h.indexOf('/js/rzp-options.js') > -1 && h.indexOf('/js/rzp-options.js') < h.indexOf('/js/app.js'));
  });
  await app.initDb(new MongoClient(), 'upi'); await app.ensureAdmin(); await require('../src/seed/demoData').seedDemo(app, true);
  const srv = app.createServer(); await new Promise((r) => srv.listen(0, r)); const base = 'http://127.0.0.1:' + srv.address().port;
  await test('the server serves rzp-options.js (and the CSP allows the Razorpay checkout script)', async () => {
    const r = await realFetch(base + '/js/rzp-options.js'); assert.strictEqual(r.status, 200); assert.ok(/javascript/.test(r.headers.get('content-type'))); assert.ok((await r.text()).includes('RzpOptions'));
    assert.ok(r.headers.get('content-security-policy').includes('https://checkout.razorpay.com'));
  });
  await test('simulated successful UPI payment: Razorpay handler -> server verifies signature -> order becomes PAID', async () => {
    let ck = ''; const call = async (m, u, b) => { const r = await realFetch(base + u, { method: m, headers: { 'Content-Type': 'application/json', Cookie: ck }, body: m === 'GET' ? undefined : JSON.stringify(b || {}) }); (r.headers.getSetCookie() || []).forEach((x) => { ck = x.split(';')[0]; }); return { status: r.status, data: await r.json().catch(() => null) }; };
    await call('POST', '/api/auth/login', { email: 'demo@example.com', password: 'demo123' });
    const stores = (await call('GET', '/api/stores')).data, prod = (await call('GET', '/api/products')).data[0], size = prod.sizes ? prod.sizes[0] : 'M';
    const st = stores.find((s) => s); const order = (await call('POST', '/api/orders', { fulfilmentMode: 'STORE_PICKUP', storeId: st._id, paymentMode: 'RAZORPAY', items: [{ productId: prod._id, size: 'M', qty: 1 }] }));
    assert.strictEqual(order.status, 201, JSON.stringify(order.data)); const o = order.data;
    let verified; const opts = RZ.build(o.razorpay, { name: 'D' }, { method: 'upi', onSuccess: async (resp) => { verified = await call('POST', '/api/payments/razorpay/verify', { orderId: o._id, ...resp }); } });
    const pid = 'pay_UPI1'; await opts.handler({ razorpay_order_id: o.razorpay.orderId, razorpay_payment_id: pid, razorpay_signature: hmac('test_secret', o.razorpay.orderId + '|' + pid) });   // what Razorpay Checkout calls after a GPay / PhonePe payment
    assert.strictEqual(verified.status, 200); assert.strictEqual((await C.orders.findOne({ orderNo: o.orderNo })).paymentStatus, 'SUCCESS');
  });
  srv.close(); console.log(`\n${pass} passed, ${fails} failed\n`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
