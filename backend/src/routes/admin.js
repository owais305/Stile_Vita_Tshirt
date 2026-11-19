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
// ----- Admin panel API: dashboard, t-shirts, stock, orders, billing, stores, employees ... -----
// ---------- admin ----------
add('POST', '/api/admin/login', async (ctx) => {
  const k = 'a:' + ctx.ip; if (blocked(k)) throw new HttpError(429, 'Too many failed attempts. Try again later.');
  const a = await C.admins.findOne({ username: String(ctx.body.username || '').trim().toLowerCase() });
  if (!a || !checkPw(String(ctx.body.password || ''), a.passwordHash)) { fail(k); throw new HttpError(401, 'Wrong username or password'); }
  ctx.setCookie('ts_admin', sign({ id: String(a._id), role: 'admin' }, 12 * 3600000), 12 * 3600); return { username: a.username, name: a.name };
});
add('POST', '/api/admin/logout', async (ctx) => { ctx.setCookie('ts_admin', '', 0); return { ok: true }; });
add('GET', '/api/admin/me', { auth: 'admin?' }, async ({ admin }) => ({ admin: admin ? { username: admin.username, name: admin.name } : null }));
add('PUT', '/api/admin/password', AD, async ({ admin, body }) => {
  if (!checkPw(String(body.current || ''), admin.passwordHash)) throw bad('Current password is wrong');
  const n = str(body.next, 'New password', 100); if (n.length < 6) throw bad('Password must have at least 6 characters');
  await C.admins.updateOne({ _id: admin._id }, { $set: { passwordHash: hashPw(n) } }); return { ok: true };
});
add('GET', '/api/admin/dashboard', AD, async () => {
  const [orders, products, stores, inv] = await Promise.all([C.orders.find({}).sort({ createdAt: -1 }).toArray(), C.products.find({}).toArray(), C.stores.find({}).toArray(), C.inventory.find({}).toArray()]);
  const idx = await stockIndex(), cats = await catMap(), dec = products.map((p) => decorate(p, idx, cats));
  const live = orders.filter((o) => o.status !== 'CANCELLED'), sum = (a) => r2(a.reduce((s, o) => s + o.total, 0)), day = new Date(); day.setHours(0, 0, 0, 0);
  const sc = {}; orders.forEach((o) => { sc[o.status] = (sc[o.status] || 0) + 1; });
  const pm = new Map(products.map((p) => [String(p._id), p])), sm = new Map(stores.map((s) => [String(s._id), s]));
  return {
    counts: { products: products.length, outOfStock: dec.filter((p) => p.isActive && !p.inStock).length, customers: await C.customers.countDocuments({}), stores: stores.length, employees: await C.employees.countDocuments({}), orders: orders.length, openOrders: orders.filter((o) => !FINAL.includes(o.status)).length },
    revenue: { total: sum(live), today: sum(live.filter((o) => o.createdAt >= day)), online: sum(live.filter((o) => o.channel === 'ONLINE')), inStore: sum(live.filter((o) => o.channel === 'IN_STORE')) },
    statusCounts: sc, recentOrders: orders.slice(0, 8),
    lowStock: inv.filter((x) => x.qty <= (x.reorderLevel == null ? REORDER : x.reorderLevel) && pm.has(String(x.productId)) && pm.get(String(x.productId)).isActive).sort((a, b) => a.qty - b.qty).slice(0, 15)
      .map((x) => ({ productId: x.productId, storeId: x.storeId, product: pm.get(String(x.productId)).name, store: (sm.get(String(x.storeId)) || {}).name || '?', size: x.size, qty: x.qty })),
  };
});
// simple CRUD for categories / stores / employees
const DESIG = ['Manager', 'Sales Executive', 'Cashier', 'Delivery Executive'];
async function parseStore(b, id) {
  const s = { name: str(b.name, 'Store name', 80), street: str(b.street, 'Street', 120), city: str(b.city, 'City', 60), state: str(b.state, 'State', 60), pincode: pin(b.pincode), phone: phone(b.phone), email: email(b.email), openingHours: str(b.openingHours, 'Opening hours', 60, false), managerId: null };
  if (b.managerId) { const m = mustId(b.managerId, 'manager'); if (!id || !(await C.employees.findOne({ _id: m, storeId: id }))) throw bad('The manager must be an employee of this store'); s.managerId = m; }
  return s;
}
async function parseEmp(b) {
  const sid = mustId(b.storeId, 'store'); if (!(await C.stores.findOne({ _id: sid }))) throw bad('Store not found');
  return { name: str(b.name, 'Name', 80), email: email(b.email), phone: phone(b.phone), designation: oneOf(b.designation, 'Designation', DESIG), storeId: sid, salary: money(b.salary, 'Salary', 0, 1e6), joinDate: b.joinDate ? new Date(b.joinDate) : new Date() };
}
add('GET', '/api/admin/categories', AD, async () => { const p = await C.products.find({}).toArray(); return (await C.categories.find({}).sort({ name: 1 }).toArray()).map((c) => ({ ...c, productCount: p.filter((x) => String(x.categoryId) === String(c._id)).length })); });
add('POST', '/api/admin/categories', AD, async ({ body }) => { const c = { name: str(body.name, 'Category name', 60), description: str(body.description, 'Description', 200, false), createdAt: new Date() }; try { c._id = (await C.categories.insertOne(c)).insertedId; } catch (e) { dup(e, 'This category already exists'); } return created(c); });
add('PUT', '/api/admin/categories/:id', AD, async ({ params, body }) => { try { const r = await C.categories.updateOne({ _id: mustId(params.id) }, { $set: { name: str(body.name, 'Category name', 60), description: str(body.description, 'Description', 200, false) } }); if (!r.matchedCount) throw new HttpError(404, 'Not found'); } catch (e) { dup(e, 'This category already exists'); } return { ok: true }; });
add('DELETE', '/api/admin/categories/:id', AD, async ({ params }) => { const id = mustId(params.id); if (await C.products.countDocuments({ categoryId: id })) throw new HttpError(409, 'This category has t-shirts. Move or delete them first.'); await C.categories.deleteOne({ _id: id }); return { ok: true }; });
add('GET', '/api/admin/stores', AD, async () => { const e = await C.employees.find({}).toArray(); return (await C.stores.find({}).sort({ city: 1 }).toArray()).map((s) => ({ ...s, managerName: (e.find((x) => String(x._id) === String(s.managerId)) || {}).name || '', employeeCount: e.filter((x) => String(x.storeId) === String(s._id)).length })); });
add('POST', '/api/admin/stores', AD, async ({ body }) => { const s = await parseStore(body, null); s.createdAt = new Date(); try { s._id = (await C.stores.insertOne(s)).insertedId; } catch (e) { dup(e, 'A store with this name already exists'); } return created(s); });
add('PUT', '/api/admin/stores/:id', AD, async ({ params, body }) => { const id = mustId(params.id); try { const r = await C.stores.updateOne({ _id: id }, { $set: await parseStore(body, id) }); if (!r.matchedCount) throw new HttpError(404, 'Not found'); } catch (e) { dup(e, 'A store with this name already exists'); } return { ok: true }; });
add('DELETE', '/api/admin/stores/:id', AD, async ({ params }) => {
  const id = mustId(params.id); if (await C.orders.countDocuments({ storeId: id })) throw new HttpError(409, 'This store has orders and cannot be deleted');
  if (await C.employees.countDocuments({ storeId: id })) throw new HttpError(409, "Remove the store's employees first");
  await C.inventory.deleteMany({ storeId: id }); await C.stores.deleteOne({ _id: id }); return { ok: true };
});
add('GET', '/api/admin/employees', AD, async ({ query }) => { const st = await C.stores.find({}).toArray(); return (await C.employees.find(query.storeId ? { storeId: mustId(query.storeId) } : {}).sort({ name: 1 }).toArray()).map((e) => ({ ...e, storeName: (st.find((s) => String(s._id) === String(e.storeId)) || {}).name || '?' })); });
add('POST', '/api/admin/employees', AD, async ({ body }) => { const e = await parseEmp(body); try { e._id = (await C.employees.insertOne(e)).insertedId; } catch (x) { dup(x, 'An employee with this e-mail already exists'); } return created(e); });
add('PUT', '/api/admin/employees/:id', AD, async ({ params, body }) => { try { const r = await C.employees.updateOne({ _id: mustId(params.id) }, { $set: await parseEmp(body) }); if (!r.matchedCount) throw new HttpError(404, 'Not found'); } catch (x) { dup(x, 'An employee with this e-mail already exists'); } return { ok: true }; });
add('DELETE', '/api/admin/employees/:id', AD, async ({ params }) => { const id = mustId(params.id); if (await C.orders.countDocuments({ empId: id })) throw new HttpError(409, 'This employee has billed orders and cannot be deleted'); await C.stores.updateMany({ managerId: id }, { $set: { managerId: null } }); await C.employees.deleteOne({ _id: id }); return { ok: true }; });

// products (t-shirts)
add('GET', '/api/admin/products', AD, async () => { const idx = await stockIndex(), cats = await catMap(); return (await C.products.find({}).sort({ createdAt: -1 }).toArray()).map((p) => decorate(p, idx, cats)); });
async function parseProduct(b, old) {
  const sizes = Array.isArray(b.sizes) ? [...new Set(b.sizes)] : []; if (!sizes.length || !sizes.every((z) => SIZES.includes(z))) throw bad('Select at least one size');
  const cid = mustId(b.categoryId, 'category'); if (!(await C.categories.findOne({ _id: cid }))) throw bad('Category not found');
  let image = old ? old.image || '' : ''; if (b.imageData) image = saveImage(b.imageData); else if (typeof b.image === 'string') image = cleanImg(b.image) || (b.image === '' ? '' : image);
  return { name: str(b.name, 'T-shirt name', 100), brand: str(b.brand, 'Brand', 60, false), description: str(b.description, 'Description', 1000, false), price: money(b.price, 'Price', 1, 100000), colour: str(b.colour, 'Colour', 40, false), material: str(b.material, 'Material', 60, false), sizes, categoryId: cid, image, isActive: b.isActive !== false };
}
add('POST', '/api/admin/products', AD, async ({ body }) => {
  const p = await parseProduct(body, null); p.manualOutOfStock = false; p.createdAt = new Date(); p._id = (await C.products.insertOne(p)).insertedId;
  const st = body.initialStock;   // optional opening stock for one store: { storeId, qty: {S: 10, M: 5} }
  if (st && st.storeId) {
    const sid = mustId(st.storeId, 'store'); if (!(await C.stores.findOne({ _id: sid }))) throw bad('Store not found');
    for (const z of p.sizes) { const q = intv((st.qty || {})[z] || 0, `Stock for size ${z}`); if (q > 0) await C.inventory.insertOne({ storeId: sid, productId: p._id, size: z, qty: q, reorderLevel: REORDER, updatedAt: new Date() }); }
  }
  return created(p);
});
add('PUT', '/api/admin/products/:id', AD, async ({ params, body }) => { const id = mustId(params.id), old = await C.products.findOne({ _id: id }); if (!old) throw new HttpError(404, 'Not found'); await C.products.updateOne({ _id: id }, { $set: await parseProduct(body, old) }); return { ok: true }; });
// the admin's OUT OF STOCK button
add('POST', '/api/admin/products/:id/out-of-stock', AD, async ({ params, body }) => { const v = body.value !== false; const r = await C.products.updateOne({ _id: mustId(params.id) }, { $set: { manualOutOfStock: v } }); if (!r.matchedCount) throw new HttpError(404, 'Not found'); return { ok: true, manualOutOfStock: v }; });
add('DELETE', '/api/admin/products/:id', AD, async ({ params }) => {
  const id = mustId(params.id); if (await C.orders.countDocuments({ 'items.productId': id })) throw new HttpError(409, 'This t-shirt is part of existing orders. Hide it (untick "Visible in shop") instead.');
  await C.inventory.deleteMany({ productId: id }); await C.products.deleteOne({ _id: id }); return { ok: true };
});
// inventory (stock of one store)
add('GET', '/api/admin/inventory', AD, async ({ query }) => {
  const st = await C.stores.findOne({ _id: mustId(query.storeId, 'store') }); if (!st) throw new HttpError(404, 'Store not found');
  const inv = await C.inventory.find({ storeId: st._id }).toArray();
  return { store: { _id: st._id, name: st.name, city: st.city }, rows: (await C.products.find({}).sort({ name: 1 }).toArray()).map((p) => {
    const qty = {}, reorder = {}; p.sizes.forEach((z) => { const r = inv.find((x) => String(x.productId) === String(p._id) && x.size === z); qty[z] = r ? r.qty : 0; reorder[z] = r && r.reorderLevel != null ? r.reorderLevel : REORDER; });
    return { productId: p._id, name: p.name, image: p.image, sizes: p.sizes, qty, reorder, manualOutOfStock: !!p.manualOutOfStock };
  }) };
});
add('PUT', '/api/admin/inventory', AD, async ({ body }) => {
  const sid = mustId(body.storeId, 'store'), pid = mustId(body.productId, 'product'), p = await C.products.findOne({ _id: pid });
  if (!p || !(await C.stores.findOne({ _id: sid }))) throw new HttpError(404, 'Store or product not found');
  for (const z of p.sizes) if (body.qty && body.qty[z] !== undefined) await C.inventory.updateOne({ storeId: sid, productId: pid, size: z }, { $set: { qty: intv(body.qty[z], `Stock for ${z}`), reorderLevel: body.reorder && body.reorder[z] !== undefined ? intv(body.reorder[z], 'Reorder level') : REORDER, updatedAt: new Date() } }, { upsert: true });
  return { ok: true };
});
add('POST', '/api/admin/inventory/restock', AD, async ({ body }) => { await C.inventory.updateOne({ storeId: mustId(body.storeId), productId: mustId(body.productId), size: oneOf(body.size, 'Size', SIZES) }, { $inc: { qty: intv(body.add, 'Quantity', 1) }, $set: { updatedAt: new Date() } }, { upsert: true }); return { ok: true }; });

// orders, delivery, payment, in-store billing
add('GET', '/api/admin/orders', AD, async ({ query: q }) => {
  const f = {}; if (q.status) f.status = String(q.status); if (q.channel) f.channel = String(q.channel);
  let l = await C.orders.find(f).sort({ createdAt: -1 }).limit(300).toArray();
  if (q.search) { const s = String(q.search).toLowerCase(); l = l.filter((o) => o.orderNo.toLowerCase().includes(s) || String(o.customerName).toLowerCase().includes(s)); } return l;
});
add('GET', '/api/admin/orders/:id', AD, async ({ params }) => {
  const o = await C.orders.findOne({ _id: mustId(params.id, 'order') }); if (!o) throw new HttpError(404, 'Order not found');
  const c = o.customerId ? await C.customers.findOne({ _id: o.customerId }) : null;
  return { order: o, payments: await C.payments.find({ orderId: o._id }).toArray(), delivery: await C.deliveries.findOne({ orderId: o._id }), customer: c ? pub(c) : null, store: await C.stores.findOne({ _id: o.storeId }), flow: FLOW[o.fulfilmentMode], nextStatus: nextOf(o), canCancel: canCancel(o, true) };
});
add('PUT', '/api/admin/orders/:id/status', AD, async ({ params, body }) => { const o = await C.orders.findOne({ _id: mustId(params.id) }); if (!o) throw new HttpError(404, 'Order not found'); await nextStatus(o, String(body.status || '')); return { ok: true }; });
add('PUT', '/api/admin/orders/:id/delivery', AD, async ({ params, body }) => {
  const o = await C.orders.findOne({ _id: mustId(params.id) }); if (!o || o.fulfilmentMode !== 'HOME_DELIVERY') throw new HttpError(404, 'This order has no home delivery');
  const set = { courier: str(body.courier, 'Courier', 60, false), trackingNo: str(body.trackingNo, 'Tracking number', 40, false), expectedDate: body.expectedDate ? new Date(body.expectedDate) : null };
  if (set.expectedDate && isNaN(set.expectedDate)) throw bad('Expected date is not valid'); if (body.outForDelivery && o.status === 'SHIPPED') set.status = 'OUT_FOR_DELIVERY';
  await C.deliveries.updateOne({ orderId: o._id }, { $set: set }); return { ok: true };
});
add('PUT', '/api/admin/orders/:id/payment', AD, async ({ params }) => {
  const o = await C.orders.findOne({ _id: mustId(params.id) }); if (!o) throw new HttpError(404, 'Order not found');
  if (o.paymentStatus !== 'PENDING' || o.status === 'CANCELLED') throw new HttpError(409, 'Only a pending payment of a live order can be marked as paid');
  const now = new Date(); await C.payments.updateMany({ orderId: o._id }, { $set: { status: 'SUCCESS', paidAt: now } }); await C.orders.updateOne({ _id: o._id }, { $set: { paymentStatus: 'SUCCESS', updatedAt: now } }); return { ok: true };
});
add('POST', '/api/admin/pos', AD, async ({ body }) => {   // customer buys in person at a store
  const store = await C.stores.findOne({ _id: mustId(body.storeId, 'store') }); if (!store) throw bad('Choose the store');
  const emp = await C.employees.findOne({ _id: mustId(body.empId, 'employee'), storeId: store._id }); if (!emp) throw bad('Choose an employee of this store who is billing the sale');
  const pay = oneOf(body.paymentMode, 'Payment mode', ['CASH', 'CARD', 'UPI']), lines = await buildLines(body.items); let cust = null;
  if (body.customerEmail) { cust = await C.customers.findOne({ email: email(body.customerEmail) }); if (!cust) throw new HttpError(404, 'No registered customer with this e-mail. Leave it empty for a walk-in customer.'); }
  return created(await createOrder({ channel: 'IN_STORE', mode: 'IN_STORE_PURCHASE', customer: cust, store, emp, lines, paymentMode: pay, walkInName: str(body.customerName, 'Customer name', 80, false) }));
});
add('GET', '/api/admin/customers', AD, async () => { const os = await C.orders.find({}).toArray(); return (await C.customers.find({}).sort({ createdAt: -1 }).toArray()).map((c) => { const m = os.filter((o) => String(o.customerId) === String(c._id) && o.status !== 'CANCELLED'); return { ...pub(c), createdAt: c.createdAt, orders: m.length, spent: r2(m.reduce((s, o) => s + o.total, 0)) }; }); });
add('GET', '/api/admin/payments', AD, async () => C.payments.find({}).sort({ createdAt: -1 }).limit(300).toArray());
