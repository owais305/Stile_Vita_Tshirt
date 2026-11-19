'use strict';
// npm test -> runs the whole shop (API) against an IN-MEMORY stand-in for MongoDB (no MongoDB needed for the tests).
const Module = require('module'), path = require('path'), assert = require('assert');
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'mongodb' ? path.join(__dirname, 'fakeMongo.js') : orig.call(this, r, ...a); };
const { MongoClient } = require('mongodb');
const app = require('../server'), { C } = app;
let pass = 0, fails = 0;
const test = async (n, f) => { try { await f(); pass++; console.log('  \u2713 ' + n); } catch (e) { fails++; console.log('  \u2717 ' + n + '\n      ' + e.message); } };
class Client {
  constructor(b) { this.b = b; this.ck = {}; }
  async call(m, u, body) {
    const h = { 'Content-Type': 'application/json' }, c = Object.entries(this.ck).map(([k, v]) => k + '=' + v).join('; '); if (c) h.Cookie = c;
    const r = await fetch(this.b + u, { method: m, headers: h, body: m === 'GET' ? undefined : JSON.stringify(body || {}) });
    r.headers.getSetCookie().forEach((x) => { const [kv] = x.split(';'), i = kv.indexOf('='); if (/Max-Age=0/i.test(x)) delete this.ck[kv.slice(0, i)]; else this.ck[kv.slice(0, i)] = kv.slice(i + 1); });
    let d = null; try { d = await r.json(); } catch (e) { /* none */ } return { status: r.status, data: d };
  }
  get(u) { return this.call('GET', u); } post(u, b) { return this.call('POST', u, b); } put(u, b) { return this.call('PUT', u, b); } del(u) { return this.call('DELETE', u, {}); }
}
(async () => {
  await app.initDb(new MongoClient(), 'test'); await app.ensureAdmin(); await require('../src/seed/demoData').seedDemo(app, true);
  const srv = app.createServer(); await new Promise((r) => srv.listen(0, r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const guest = new Client(base), cust = new Client(base), admin = new Client(base);
  const qty = async (store, prod, size) => { const s = await C.stores.findOne({ name: store }), p = await C.products.findOne({ name: prod }); return (await C.inventory.findOne({ storeId: s._id, productId: p._id, size })).qty; };
  let prods; console.log('\nT-shirt store tests\n\nShop (public)');
  await test('13 t-shirts are listed', async () => { prods = (await guest.get('/api/products')).data; assert.strictEqual(prods.length, 13); });
  await test('stock 0 everywhere -> OUT of stock ("Code Mode ON Tee")', async () => { const p = prods.find((x) => x.name === 'Code Mode ON Tee'); assert.ok(!p.inStock && p.totalQty === 0); });
  await test('admin pressed Out-of-stock button -> OUT of stock ("Coffee First Tee")', async () => { const p = prods.find((x) => x.name === 'Coffee First Tee'); assert.ok(!p.inStock && p.totalQty > 0); });
  await test('one size finished, other sizes available ("Sunset Graphic Tee")', async () => { const p = prods.find((x) => x.name === 'Sunset Graphic Tee'); assert.ok(!p.sizes.find((s) => s.size === 'XL').inStock && p.sizes.find((s) => s.size === 'M').inStock); });
  await test('search + category filter', async () => { assert.strictEqual((await guest.get('/api/products?search=polo')).data.length, 1); const w = (await guest.get('/api/categories')).data.find((c) => c.name === 'Women'); assert.strictEqual((await guest.get('/api/products?category=' + w._id)).data.length, 2); });
  console.log('\nCustomer');
  await test('login needed for orders; register + duplicate e-mail', async () => {
    assert.strictEqual((await guest.post('/api/orders', {})).status, 401);
    assert.strictEqual((await cust.post('/api/auth/register', { name: 'Test User', email: 'test@example.com', phone: '9000000001', password: 'secret1' })).status, 201);
    assert.strictEqual((await new Client(base).post('/api/auth/register', { name: 'X', email: 'test@example.com', phone: '9000000002', password: 'secret1' })).status, 409);
  });
  let addr; const polo = () => prods.find((x) => x.name === 'Polo Sport Tee');
  await test('save an address', async () => { const r = await cust.post('/api/me/addresses', { label: 'Home', name: 'Test User', phone: '9000000001', line: '1 Main Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' }); assert.strictEqual(r.status, 201); addr = r.data; });
  let order;
  await test('HOME DELIVERY order (COD): stock reduced in the Mumbai store', async () => {
    const before = await qty('ABC Tees - Bandra', 'Polo Sport Tee', 'M');
    const r = await cust.post('/api/orders', { fulfilmentMode: 'HOME_DELIVERY', addressId: addr._id, paymentMode: 'COD', items: [{ productId: polo()._id, size: 'M', qty: 2 }] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.data)); order = r.data;
    assert.ok(order.storeName === 'ABC Tees - Bandra' && order.subtotal === 1698 && order.deliveryCharge === 0 && order.paymentStatus === 'PENDING');
    assert.strictEqual(await qty('ABC Tees - Bandra', 'Polo Sport Tee', 'M'), before - 2);
  });
  await test('Rs.60 delivery charge below Rs.999; UPI is paid at once', async () => { const r = await cust.post('/api/orders', { fulfilmentMode: 'HOME_DELIVERY', addressId: addr._id, paymentMode: 'UPI', items: [{ productId: prods.find((x) => x.name === 'Kids Rainbow Tee')._id, size: 'S', qty: 1 }] }); assert.ok(r.data.deliveryCharge === 60 && r.data.total === 459 && r.data.paymentStatus === 'SUCCESS'); });
  await test('STORE PICK-UP from a chosen store reduces that store\'s stock', async () => {
    const st = (await guest.get('/api/stores')).data.find((s) => s.city === 'Bengaluru'), b = await qty('ABC Tees - Indiranagar', 'Polo Sport Tee', 'L');
    const r = await cust.post('/api/orders', { fulfilmentMode: 'STORE_PICKUP', storeId: st._id, paymentMode: 'PAY_AT_STORE', items: [{ productId: polo()._id, size: 'L', qty: 1 }] });
    assert.ok(r.status === 201 && r.data.storeName === 'ABC Tees - Indiranagar'); assert.strictEqual(await qty('ABC Tees - Indiranagar', 'Polo Sport Tee', 'L'), b - 1);
  });
  await test('out-of-stock t-shirts (automatic and by admin button) cannot be ordered', async () => {
    const s = (await guest.get('/api/stores')).data[0];
    for (const n of ['Code Mode ON Tee', 'Coffee First Tee']) assert.strictEqual((await cust.post('/api/orders', { fulfilmentMode: 'STORE_PICKUP', storeId: s._id, paymentMode: 'UPI', items: [{ productId: prods.find((x) => x.name === n)._id, size: 'M', qty: 1 }] })).status, 409);
  });
  await test('a failed order changes no stock; the last piece sells only once', async () => {
    const s = (await guest.get('/api/stores')).data.find((x) => x.city === 'Delhi'), b = await qty('ABC Tees - Connaught Place', 'Polo Sport Tee', 'L');
    const r = await cust.post('/api/orders', { fulfilmentMode: 'STORE_PICKUP', storeId: s._id, paymentMode: 'UPI', items: [{ productId: polo()._id, size: 'L', qty: 1 }, { productId: prods.find((x) => x.name === 'Midnight Black Tee')._id, size: 'M', qty: 3 }] });
    assert.strictEqual(r.status, 409); assert.strictEqual(await qty('ABC Tees - Connaught Place', 'Polo Sport Tee', 'L'), b);
    const p = await C.products.findOne({ name: 'Navy Pocket Tee' }); await C.inventory.updateOne({ storeId: app.toId(String(s._id)), productId: p._id, size: 'XL' }, { $set: { qty: 1 } });
    const c2 = new Client(base); await c2.post('/api/auth/register', { name: 'Two', email: 'two@example.com', phone: '9000000003', password: 'secret1' });
    const body = { fulfilmentMode: 'STORE_PICKUP', storeId: String(s._id), paymentMode: 'UPI', items: [{ productId: String(p._id), size: 'XL', qty: 1 }] };
    assert.deepStrictEqual((await Promise.all([cust.post('/api/orders', body), c2.post('/api/orders', body)])).map((x) => x.status).sort(), [201, 409]);
  });
  await test('customer cancels -> stock comes back, payment cancelled; cannot cancel twice', async () => {
    const b = await qty('ABC Tees - Bandra', 'Polo Sport Tee', 'M'); assert.strictEqual((await cust.post('/api/orders/' + order._id + '/cancel', {})).status, 200);
    assert.strictEqual(await qty('ABC Tees - Bandra', 'Polo Sport Tee', 'M'), b + 2); assert.strictEqual((await cust.get('/api/orders/' + order._id)).data.payments[0].status, 'CANCELLED');
    assert.strictEqual((await cust.post('/api/orders/' + order._id + '/cancel', {})).status, 409);
  });
  console.log('\nAdmin');
  await test('admin API needs admin login', async () => { assert.strictEqual((await guest.get('/api/admin/products')).status, 401); assert.strictEqual((await cust.get('/api/admin/dashboard')).status, 401); assert.strictEqual((await admin.post('/api/admin/login', { username: 'admin', password: 'bad' })).status, 401); assert.strictEqual((await admin.post('/api/admin/login', { username: 'admin', password: 'admin123' })).status, 200); });
  await test('dashboard figures', async () => { const d = (await admin.get('/api/admin/dashboard')).data; assert.ok(d.counts.stores === 3 && d.counts.outOfStock >= 2 && d.revenue.total > 0 && d.lowStock.length > 0); });
  let tee, cat, store0;
  await test('admin ADDS a t-shirt with image upload and opening stock; shop shows it', async () => {
    cat = (await admin.get('/api/admin/categories')).data.find((c) => c.name === 'Men'); store0 = (await admin.get('/api/admin/stores')).data[0];
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const r = await admin.post('/api/admin/products', { name: 'Test Tee', brand: 'QA', price: 450, categoryId: cat._id, colour: 'Blue', material: 'Cotton', sizes: ['M', 'L'], imageData: png, initialStock: { storeId: store0._id, qty: { M: 4, L: 0 } } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.data)); tee = r.data; assert.ok(/^\/uploads\/[0-9a-f]+\.png$/.test(tee.image));
    const s = (await guest.get('/api/products')).data.find((p) => p.name === 'Test Tee'); assert.ok(s.inStock && s.totalQty === 4);
  });
  await test('validation: bad price, no sizes, fake image', async () => {
    assert.strictEqual((await admin.post('/api/admin/products', { name: 'X', price: -5, categoryId: cat._id, sizes: ['M'] })).status, 400);
    assert.strictEqual((await admin.post('/api/admin/products', { name: 'X', price: 5, categoryId: cat._id, sizes: [] })).status, 400);
    assert.strictEqual((await admin.post('/api/admin/products', { name: 'X', price: 5, categoryId: cat._id, sizes: ['M'], imageData: 'data:image/png;base64,AAAA' })).status, 400);
  });
  await test('OUT OF STOCK button: shop shows out of stock, orders refused; "in stock" restores', async () => {
    await admin.post('/api/admin/products/' + tee._id + '/out-of-stock', { value: true }); assert.ok(!(await guest.get('/api/products')).data.find((p) => p.name === 'Test Tee').inStock);
    assert.strictEqual((await cust.post('/api/orders', { fulfilmentMode: 'STORE_PICKUP', storeId: store0._id, paymentMode: 'UPI', items: [{ productId: tee._id, size: 'M', qty: 1 }] })).status, 409);
    await admin.post('/api/admin/products/' + tee._id + '/out-of-stock', { value: false }); assert.ok((await guest.get('/api/products')).data.find((p) => p.name === 'Test Tee').inStock);
  });
  await test('stock reaching 0 makes it OUT OF STOCK automatically; restock brings it back', async () => {
    assert.strictEqual((await cust.post('/api/orders', { fulfilmentMode: 'STORE_PICKUP', storeId: store0._id, paymentMode: 'UPI', items: [{ productId: tee._id, size: 'M', qty: 4 }] })).status, 201);
    assert.ok(!(await guest.get('/api/products')).data.find((p) => p.name === 'Test Tee').inStock);
    await admin.post('/api/admin/inventory/restock', { storeId: store0._id, productId: tee._id, size: 'M', add: 6 }); const t = (await guest.get('/api/products')).data.find((p) => p.name === 'Test Tee'); assert.ok(t.inStock && t.totalQty === 6);
  });
  await test('inventory matrix per store can be read and updated', async () => {
    const st = (await admin.get('/api/admin/stores')).data[1], row = (await admin.get('/api/admin/inventory?storeId=' + st._id)).data.rows.find((x) => x.name === 'Code Mode ON Tee'); assert.strictEqual(row.qty.M, 0);
    await admin.put('/api/admin/inventory', { storeId: st._id, productId: row.productId, qty: { M: 7 } }); assert.ok((await guest.get('/api/products')).data.find((p) => p.name === 'Code Mode ON Tee').inStock);
  });
  await test('edit + hide a t-shirt; delete blocked when it has orders', async () => {
    assert.strictEqual((await admin.put('/api/admin/products/' + tee._id, { name: 'Test Tee v2', price: 475, categoryId: cat._id, sizes: ['M', 'L'], isActive: false, image: tee.image })).status, 200);
    assert.ok(!(await guest.get('/api/products')).data.find((p) => p.name === 'Test Tee v2')); assert.strictEqual((await admin.del('/api/admin/products/' + tee._id)).status, 409);
  });
  await test('categories, stores, employees (with safety checks)', async () => {
    const c = await admin.post('/api/admin/categories', { name: 'Sale' }); assert.strictEqual(c.status, 201); assert.strictEqual((await admin.post('/api/admin/categories', { name: 'Sale' })).status, 409);
    assert.strictEqual((await admin.del('/api/admin/categories/' + cat._id)).status, 409); assert.strictEqual((await admin.del('/api/admin/categories/' + c.data._id)).status, 200);
    const st = await admin.post('/api/admin/stores', { name: 'ABC Tees - Pune', street: '1 FC Road', city: 'Pune', state: 'Maharashtra', pincode: '411004', phone: '020-4000000', email: 'pune@abctees.example' }); assert.strictEqual(st.status, 201);
    const em = await admin.post('/api/admin/employees', { name: 'New Hire', email: 'new.hire@abctees.example', phone: '9811111111', designation: 'Cashier', storeId: st.data._id, salary: 20000 }); assert.strictEqual(em.status, 201);
    assert.strictEqual((await admin.put('/api/admin/stores/' + st.data._id, { ...st.data, managerId: em.data._id })).status, 200); assert.strictEqual((await admin.del('/api/admin/stores/' + st.data._id)).status, 409);
    assert.strictEqual((await admin.del('/api/admin/employees/' + em.data._id)).status, 200); assert.strictEqual((await admin.del('/api/admin/stores/' + st.data._id)).status, 200);
  });
  console.log('\nOrders, delivery, payment, in-store billing');
  await test('pick-up order: PLACED -> CONFIRMED -> READY -> COLLECTED (steps cannot be skipped; cash collected)', async () => {
    const po = (await admin.get('/api/admin/orders?channel=ONLINE')).data.find((o) => o.fulfilmentMode === 'STORE_PICKUP' && o.status === 'PLACED' && o.paymentStatus === 'PENDING'); assert.ok(po);
    assert.strictEqual((await admin.put('/api/admin/orders/' + po._id + '/status', { status: 'COLLECTED' })).status, 409);
    for (const s of ['CONFIRMED', 'READY_FOR_PICKUP', 'COLLECTED']) assert.strictEqual((await admin.put('/api/admin/orders/' + po._id + '/status', { status: s })).status, 200);
    const d = (await admin.get('/api/admin/orders/' + po._id)).data; assert.ok(d.order.status === 'COLLECTED' && d.order.paymentStatus === 'SUCCESS' && !d.canCancel);
  });
  await test('home delivery: courier + tracking, SHIPPED -> DELIVERED; shipped orders cannot be cancelled', async () => {
    const r = await cust.post('/api/orders', { fulfilmentMode: 'HOME_DELIVERY', addressId: addr._id, paymentMode: 'COD', items: [{ productId: polo()._id, size: 'XL', qty: 1 }] }); const id = r.data._id;
    for (const s of ['CONFIRMED', 'PACKED', 'SHIPPED']) await admin.put('/api/admin/orders/' + id + '/status', { status: s });
    assert.strictEqual((await admin.put('/api/admin/orders/' + id + '/delivery', { courier: 'Delhivery', trackingNo: 'DL123456', expectedDate: '2027-01-10', outForDelivery: true })).status, 200);
    assert.strictEqual((await admin.put('/api/admin/orders/' + id + '/status', { status: 'CANCELLED' })).status, 409); await admin.put('/api/admin/orders/' + id + '/status', { status: 'DELIVERED' });
    const d = (await admin.get('/api/admin/orders/' + id)).data; assert.ok(d.delivery.status === 'DELIVERED' && d.delivery.courier === 'Delhivery' && d.order.paymentStatus === 'SUCCESS');
  });
  await test('admin cancels an online-paid order -> refund + stock back', async () => {
    const r = await cust.post('/api/orders', { fulfilmentMode: 'HOME_DELIVERY', addressId: addr._id, paymentMode: 'UPI', items: [{ productId: polo()._id, size: 'S', qty: 1 }] }), b = await qty(r.data.storeName, 'Polo Sport Tee', 'S');
    assert.strictEqual((await admin.put('/api/admin/orders/' + r.data._id + '/status', { status: 'CANCELLED' })).status, 200);
    assert.ok((await admin.get('/api/admin/orders/' + r.data._id)).data.order.paymentStatus === 'REFUNDED' && (await qty(r.data.storeName, 'Polo Sport Tee', 'S')) === b + 1);
  });
  await test('IN-STORE purchase (billing) by an employee reduces the store stock', async () => {
    const stores = (await admin.get('/api/admin/stores')).data, st = stores.find((x) => x.name === 'ABC Tees - Indiranagar'), emps = (await admin.get('/api/admin/employees?storeId=' + st._id)).data, tee2 = prods.find((x) => x.name === 'Forest Trek Tee'), b = await qty(st.name, 'Forest Trek Tee', 'L');
    const r = await admin.post('/api/admin/pos', { storeId: st._id, empId: emps[0]._id, paymentMode: 'CASH', customerName: 'Mr. Walk In', items: [{ productId: tee2._id, size: 'L', qty: 2 }] });
    assert.ok(r.status === 201 && r.data.status === 'COMPLETED' && r.data.channel === 'IN_STORE'); assert.strictEqual(await qty(st.name, 'Forest Trek Tee', 'L'), b - 2);
    assert.strictEqual((await admin.post('/api/admin/pos', { storeId: st._id, empId: emps[0]._id, paymentMode: 'UPI', customerEmail: 'demo@example.com', items: [{ productId: tee2._id, size: 'L', qty: 1 }] })).data.customerName, 'Demo Customer');
    const other = (await admin.get('/api/admin/employees?storeId=' + stores.find((x) => x.city === 'Delhi')._id)).data[0];
    assert.strictEqual((await admin.post('/api/admin/pos', { storeId: st._id, empId: other._id, paymentMode: 'CASH', items: [{ productId: tee2._id, size: 'L', qty: 1 }] })).status, 400);
  });
  await test('customers + payments lists; pending payment can be marked paid', async () => {
    const o = (await admin.get('/api/admin/orders?status=PLACED')).data.find((x) => x.paymentStatus === 'PENDING'); if (o) { assert.strictEqual((await admin.put('/api/admin/orders/' + o._id + '/payment', {})).status, 200); assert.strictEqual((await admin.put('/api/admin/orders/' + o._id + '/payment', {})).status, 409); }
    assert.ok((await admin.get('/api/admin/customers')).data.length >= 3 && (await admin.get('/api/admin/payments')).data.length >= 5);
  });
  console.log('\nSecurity');
  await test('non-JSON POST refused (CSRF); unknown route 404; path traversal blocked; forged cookie refused; passwords hashed', async () => {
    assert.strictEqual((await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status, 415); assert.strictEqual((await fetch(base + '/api/nothing')).status, 404);
    assert.notStrictEqual((await fetch(base + '/..%2f..%2fpackage.json')).status, 200); const bad = new Client(base); bad.ck.ts_admin = 'abc.def'; assert.strictEqual((await bad.get('/api/admin/products')).status, 401);
    assert.ok(!(await C.customers.findOne({ email: 'test@example.com' })).passwordHash.includes('secret1'));
  });
  srv.close(); console.log(`\n${pass} passed, ${fails} failed\n`); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
