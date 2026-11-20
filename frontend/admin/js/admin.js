(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s), root = $('#root');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rs = (n) => '\u20B9' + Number(n || 0).toLocaleString('en-IN');
  const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
  const nice = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
  const badge = (s) => `<span class="badge st-${esc(s)}">${esc(nice(s))}</span>`;
  const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
  async function api(url, method = 'GET', body) {
    const o = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' }; if (method !== 'GET') o.body = JSON.stringify(body || {});
    const r = await fetch(url, o); let d = null; try { d = await r.json(); } catch (e) { /* none */ }
    if (!r.ok) { if (r.status === 401 && !/login/.test(url)) { showLogin(); } throw new Error((d && d.error) || 'Request failed (' + r.status + ')'); } return d;
  }
  const toast = (m, err) => { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = m; $('#toast').appendChild(t); setTimeout(() => t.remove(), 3200); };
  const fld = (l, n, v = '', t = 'text', extra = '') => `<div><label class="f">${l}</label><input name="${n}" type="${t}" value="${esc(v)}" ${extra}></div>`;
  const sel = (l, n, opts, cur) => `<div><label class="f">${l}</label><select name="${n}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
  const table = (heads, rows) => `<div class="tablebox"><table class="t"><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.join('') || `<tr><td colspan="${heads.length}" class="muted">Nothing here yet.</td></tr>`}</table></div>`;
  let M = null;  // modal element
  function modal(html) { closeModal(); M = document.createElement('div'); M.className = 'modal-bg'; M.innerHTML = `<div class="modal">${html}</div>`; document.body.appendChild(M); }
  function closeModal() { if (M) M.remove(); M = null; }
  const err = (el, m) => { const b = $('[data-err]', el); if (b) { b.textContent = m; b.classList.remove('hidden'); } else toast(m, true); };
  const errBox = '<div class="alert err hidden" data-err></div>';

  // ============ login + shell ============
  function showLogin() {
    root.innerHTML = `<div class="login-box"><div class="panel"><h2>Admin login</h2><form data-f="login"><label class="f">Username</label><input name="username" autocomplete="username"><label class="f">Password</label><input name="password" type="password" autocomplete="current-password">${errBox}<button class="btn btn-block" style="margin-top:14px">Login</button></form><p class="small muted">Default: admin / admin123</p><a href="/">&larr; Back to shop</a></div></div>`;
  }
  const PAGES = [['dash', 'Dashboard'], ['products', 'T-shirts'], ['inventory', 'Stock (inventory)'], ['orders', 'Orders'], ['pos', 'In-store billing'], ['categories', 'Categories'], ['stores', 'Stores'], ['employees', 'Employees'], ['customers', 'Customers'], ['payments', 'Payments'], ['settings', 'Settings']];
  function shell(me) {
    root.innerHTML = `<div class="adm"><aside class="side"><a class="brand" href="#dash"><b>Stile Vita</b> admin</a>${PAGES.map(([k, t]) => `<a href="#${k}" data-nav="${k}">${t}</a>`).join('')}<a href="/" target="_blank">View shop</a><a href="#" data-a="logout">Logout (${esc(me.username)})</a></aside><main class="main" id="main"></main></div>`;
    route();
  }
  async function route() {
    const k = (location.hash || '#dash').slice(1) || 'dash'; document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === k));
    const fn = V[k] || V.dash; try { await fn(); } catch (e) { $('#main').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  }
  const main = (html) => { $('#main').innerHTML = html; };

  const V = {};
  // ============ dashboard ============
  V.dash = async () => {
    const d = await api('/api/admin/dashboard'), c = d.counts, r = d.revenue;
    const stat = (n, l) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`;
    main(`<h1>Dashboard</h1><div class="cards">${stat(rs(r.total), 'Total sales')}${stat(rs(r.today), 'Sales today')}${stat(rs(r.online), 'Online sales')}${stat(rs(r.inStore), 'In-store sales')}${stat(c.orders, 'Orders')}${stat(c.openOrders, 'Open orders')}${stat(c.products, 'T-shirts')}${stat(c.outOfStock, 'Out of stock')}${stat(c.customers, 'Customers')}${stat(c.stores, 'Stores')}${stat(c.employees, 'Employees')}</div>
      <div class="panel"><h2>Low stock (at or below the reorder level)</h2>${table(['T-shirt', 'Store', 'Size', 'Qty', ''], d.lowStock.map((x) => `<tr><td>${esc(x.product)}</td><td>${esc(x.store)}</td><td>${esc(x.size)}</td><td class="${x.qty === 0 ? 'zero' : ''}">${x.qty}</td><td><button class="btn btn-sm" data-a="restock" data-s="${x.storeId}" data-p="${x.productId}" data-z="${esc(x.size)}">+10</button></td></tr>`))}</div>
      <div class="panel"><h2>Orders by status</h2><div class="chips">${Object.entries(d.statusCounts).map(([k, v]) => `${badge(k)} <b>${v}</b>`).join(' &nbsp; ') || 'No orders'}</div></div>
      <div class="panel"><h2>Recent orders</h2>${ordersTable(d.recentOrders)}</div>`);
  };

  // ============ products ============
  V.products = async () => {
    const l = await api('/api/admin/products');
    main(`<div class="topbar"><h1 style="margin:0">T-shirts</h1><button class="btn sp" data-a="newprod">+ Add T-shirt</button></div>` + table(['', 'Name', 'Category', 'Price', 'Stock by size', 'Status', 'Actions'], l.map((p) => `<tr><td><img class="thumb" src="${esc(p.image || '/img/placeholder.svg')}" alt=""></td><td><b>${esc(p.name)}</b><div class="small muted">${esc(p.brand)}</div></td><td>${esc(p.category ? p.category.name : '-')}</td><td>${rs(p.price)}</td>
      <td class="small">${p.sizes.map((s) => `${s.size}: <span class="${s.qty ? 'okn' : 'zero'}">${s.qty}</span>`).join(' &middot; ')}</td><td>${p.inStock ? badge('IN STOCK').replace('st-IN STOCK', 'st-SUCCESS') : '<span class="badge oosb">Out of Stock</span>'} ${p.manualOutOfStock ? '<div class="small muted">(set by admin)</div>' : ''} ${p.isActive ? '' : '<div class="small muted">Hidden</div>'}</td>
      <td><div class="actions"><button class="btn btn-sm btn-outline" data-a="editprod" data-v="${p._id}">Edit</button>${p.manualOutOfStock ? `<button class="btn btn-sm btn-ok" data-a="oos" data-v="${p._id}" data-on="0">Mark in stock</button>` : `<button class="btn btn-sm btn-danger" data-a="oos" data-v="${p._id}" data-on="1">Out of Stock</button>`}<button class="btn btn-sm btn-outline" data-a="delprod" data-v="${p._id}">Delete</button></div></td></tr>`)));
    window._prods = l;
  };
  async function prodModal(p) {
    const [cats, stores] = await Promise.all([api('/api/admin/categories'), api('/api/admin/stores')]);
    modal(`<h2>${p ? 'Edit' : 'Add'} T-shirt</h2><form data-f="prod" ${p ? `data-id="${p._id}"` : ''}>
      <div class="row">${fld('Name', 'name', p && p.name)}${fld('Brand', 'brand', p && p.brand)}${sel('Category', 'categoryId', cats.map((c) => [c._id, c.name]), p && p.categoryId)}</div>
      <div class="row">${fld('Price (Rs.)', 'price', p && p.price, 'number', 'min="1" step="1"')}${fld('Colour', 'colour', p && p.colour)}${fld('Material', 'material', p && p.material)}</div>
      <label class="f">Description</label><textarea name="description" rows="2">${esc(p && p.description)}</textarea>
      <label class="f">Sizes available</label><div class="chips">${SIZES.map((z) => `<label><input type="checkbox" name="size" value="${z}" ${(p ? p.sizeList : ['S', 'M', 'L', 'XL']).includes(z) ? 'checked' : ''}> ${z}</label>`).join('')}</div>
      <label class="f">Picture (PNG / JPG / WEBP, max 2 MB)</label><input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif">${p && p.image ? `<div class="small muted">Current: <img class="thumb" src="${esc(p.image)}" alt=""> (leave empty to keep it)</div>` : ''}
      ${p ? '' : `<label class="f">Opening stock (optional)</label><div class="row">${sel('Store', 'stockStore', [['', '- no stock now -'], ...stores.map((s) => [s._id, s.name])], '')}</div><div class="chips">${SIZES.map((z) => `<label>${z} <input class="qtyin" type="number" min="0" name="q_${z}" value="0"></label>`).join('')}</div>`}
      <label class="chk" style="margin-top:10px"><input type="checkbox" name="isActive" ${!p || p.isActive ? 'checked' : ''}> Visible in shop</label>${errBox}
      <div class="actions" style="margin-top:14px"><button class="btn">${p ? 'Save changes' : 'Add T-shirt'}</button><button type="button" class="btn btn-outline" data-a="close">Cancel</button></div></form>`);
  }
  const readFile = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error('Could not read the file')); r.readAsDataURL(f); });
  async function saveProd(form) {
    const fd = new FormData(form), id = form.dataset.id, b = { name: fd.get('name'), brand: fd.get('brand'), categoryId: fd.get('categoryId'), price: fd.get('price'), colour: fd.get('colour'), material: fd.get('material'), description: fd.get('description'), sizes: fd.getAll('size'), isActive: !!fd.get('isActive') };
    const f = form.elements.image.files[0]; if (f) { if (f.size > 2 * 1024 * 1024) throw new Error('Image must be smaller than 2 MB'); b.imageData = await readFile(f); }
    if (id) { const old = window._prods.find((x) => x._id === id); b.image = old ? old.image : ''; }
    else if (fd.get('stockStore')) { b.initialStock = { storeId: fd.get('stockStore'), qty: Object.fromEntries(SIZES.map((z) => [z, fd.get('q_' + z) || 0])) }; }
    await api(id ? '/api/admin/products/' + id : '/api/admin/products', id ? 'PUT' : 'POST', b); closeModal(); toast(id ? 'T-shirt updated' : 'T-shirt added'); V.products();
  }

  // ============ inventory ============
  V.inventory = async () => {
    const stores = await api('/api/admin/stores'); const cur = window._invStore || (stores[0] && stores[0]._id);
    main(`<h1>Stock (inventory)</h1><div class="topbar"><label>Store</label><select id="inv-store">${stores.map((s) => `<option value="${s._id}" ${s._id === cur ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><span class="muted small">Change the numbers and press Save. 0 = out of stock in this store.</span></div><div id="inv"></div>`);
    if (cur) invLoad(cur);
  };
  async function invLoad(sid) {
    window._invStore = sid; const d = await api('/api/admin/inventory?storeId=' + sid);
    $('#inv').innerHTML = table(['', 'T-shirt', ...SIZES, ''], d.rows.map((r) => `<tr data-row="${r.productId}"><td><img class="thumb" src="${esc(r.image || '/img/placeholder.svg')}" alt=""></td><td><b>${esc(r.name)}</b>${r.manualOutOfStock ? ' <span class="badge oosb">Out of Stock (admin)</span>' : ''}</td>${SIZES.map((z) => r.sizes.includes(z) ? `<td><input class="qtyin" type="number" min="0" data-z="${z}" value="${r.qty[z]}"></td>` : '<td class="muted">-</td>').join('')}<td><button class="btn btn-sm" data-a="invsave" data-p="${r.productId}">Save</button></td></tr>`));
  }

  // ============ orders ============
  const ordersTable = (l) => table(['Order no.', 'Date', 'Customer', 'Type', 'Store', 'Total', 'Payment', 'Status', ''], l.map((o) => `<tr><td><b>${esc(o.orderNo)}</b></td><td>${fmt(o.createdAt)}</td><td>${esc(o.customerName)}</td><td class="small">${esc(nice(o.channel))}<br>${esc(nice(o.fulfilmentMode))}</td><td class="small">${esc(o.storeName)}</td><td>${rs(o.total)}</td><td>${badge(o.paymentStatus)}</td><td>${badge(o.status)}</td><td><button class="btn btn-sm btn-outline" data-a="vieworder" data-v="${o._id}">View</button></td></tr>`));
  V.orders = async () => {
    const q = window._oq || { status: '', channel: '', search: '' }; const qs = new URLSearchParams(); Object.entries(q).forEach(([k, v]) => v && qs.set(k, v));
    const l = await api('/api/admin/orders?' + qs);
    main(`<h1>Orders</h1><div class="topbar"><select id="o-status"><option value="">All statuses</option>${['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'COLLECTED', 'COMPLETED', 'CANCELLED'].map((s) => `<option value="${s}" ${q.status === s ? 'selected' : ''}>${nice(s)}</option>`).join('')}</select>
      <select id="o-channel"><option value="">Online + in-store</option><option value="ONLINE" ${q.channel === 'ONLINE' ? 'selected' : ''}>Online</option><option value="IN_STORE" ${q.channel === 'IN_STORE' ? 'selected' : ''}>In-store</option></select><input id="o-search" placeholder="Order no. or customer" value="${esc(q.search)}"></div>${ordersTable(l)}`);
  };
  async function orderModal(id) {
    const d = await api('/api/admin/orders/' + id), o = d.order, dl = d.delivery;
    modal(`<h2>Order ${esc(o.orderNo)} ${badge(o.status)}</h2><div class="muted small">${fmt(o.createdAt)} &middot; ${esc(nice(o.channel))} &middot; ${esc(nice(o.fulfilmentMode))} &middot; Store: ${esc(o.storeName)}${o.empName ? ' &middot; Billed by ' + esc(o.empName) : ''}</div>
      <p><b>Customer:</b> ${esc(o.customerName)}${d.customer ? ' (' + esc(d.customer.email) + ', ' + esc(d.customer.phone) + ')' : ''}</p>
      ${table(['T-shirt', 'Size', 'Qty', 'Amount'], o.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.size)}</td><td>${i.qty}</td><td>${rs(i.lineTotal)}</td></tr>`))}
      <p>Subtotal ${rs(o.subtotal)} &middot; Delivery ${rs(o.deliveryCharge)} &middot; <b>Total ${rs(o.total)}</b></p>
      <p><b>Payment:</b> ${esc(nice(o.paymentMode))} ${badge(o.paymentStatus)} ${d.payments.map((p) => (p.txnRef ? 'Ref ' + esc(p.txnRef) : '')).join('')} ${o.paymentStatus === 'PENDING' && o.status !== 'CANCELLED' ? `<button class="btn btn-sm btn-ok" data-a="markpaid" data-v="${o._id}">Mark payment received</button>` : ''}</p>
      ${dl ? `<h3>Delivery ${badge(dl.status)}</h3><p class="small">To: ${esc(dl.address.name)}, ${esc(dl.address.phone)}, ${esc(dl.address.line)}, ${esc(dl.address.city)} - ${esc(dl.address.pincode)}</p><form data-f="delivery" data-id="${o._id}"><div class="row">${fld('Courier', 'courier', dl.courier)}${fld('Tracking no.', 'trackingNo', dl.trackingNo)}${fld('Expected date', 'expectedDate', dl.expectedDate ? String(dl.expectedDate).slice(0, 10) : '', 'date')}</div>
        ${o.status === 'SHIPPED' ? '<label class="chk"><input type="checkbox" name="outForDelivery"> Out for delivery</label>' : ''}${errBox}<button class="btn btn-sm" style="margin-top:8px">Save delivery details</button></form>` : ''}
      <div class="actions" style="margin-top:14px">${d.nextStatus ? `<button class="btn" data-a="nextstatus" data-v="${o._id}" data-s="${d.nextStatus}">Move to: ${esc(nice(d.nextStatus))}</button>` : ''}${d.canCancel ? `<button class="btn btn-danger" data-a="cancelorder" data-v="${o._id}">Cancel order</button>` : ''}<button class="btn btn-outline" data-a="close">Close</button></div>`);
  }

  // ============ in-store billing (POS) ============
  let pos = null;
  V.pos = async () => {
    const stores = await api('/api/admin/stores'); pos = { stores, bill: [], store: stores[0] ? stores[0]._id : '', inv: null, emps: [] }; await posLoad();
  };
  async function posLoad() {
    if (!pos.store) return main('<h1>In-store billing</h1><p>Add a store first.</p>');
    [pos.inv, pos.emps] = await Promise.all([api('/api/admin/inventory?storeId=' + pos.store), api('/api/admin/employees?storeId=' + pos.store)]); posDraw();
  }
  function posDraw() {
    const rows = pos.inv.rows.filter((r) => !r.manualOutOfStock && r.sizes.some((z) => r.qty[z] > 0));
    const total = pos.bill.reduce((s, l) => s + l.price * l.qty, 0);
    main(`<h1>In-store billing (customer buys at the store)</h1><div class="two"><div class="panel"><h2>1. Store and employee</h2><div class="row">${sel('Store', 'pstore', pos.stores.map((s) => [s._id, s.name]), pos.store)}${sel('Billed by (employee)', 'pemp', pos.emps.map((e) => [e._id, e.name + ' - ' + e.designation]), '')}</div>
      <h2 style="margin-top:16px">2. Add t-shirts</h2><div class="row">${sel('T-shirt', 'pprod', rows.map((r) => [r.productId, r.name]), '')}<div><label class="f">Size</label><select name="psize" id="psize"></select></div><div><label class="f">Qty</label><input id="pqty" type="number" min="1" value="1"></div></div><button class="btn" style="margin-top:10px" data-a="posadd">Add to bill</button></div>
      <div class="panel"><h2>Bill</h2>${pos.bill.map((l, i) => `<div class="sum small"><span>${esc(l.name)} (${esc(l.size)}) &times; ${l.qty}</span><span>${rs(l.price * l.qty)} <button class="btn btn-sm btn-outline" data-a="posrem" data-v="${i}">x</button></span></div>`).join('') || '<p class="muted small">No items yet.</p>'}<div class="sum total"><span>Total</span><span>${rs(total)}</span></div>
      <form data-f="pos"><label class="f">Payment</label><select name="paymentMode"><option>CASH</option><option>CARD</option><option>UPI</option></select><label class="f">Registered customer e-mail (optional)</label><input name="customerEmail"><label class="f">Walk-in customer name (optional)</label><input name="customerName">${errBox}<button class="btn btn-lg btn-block" style="margin-top:12px" ${pos.bill.length ? '' : 'disabled'}>Complete sale</button></form></div></div>`);
    posSizes();
  }
  function posSizes() { const pid = $('[name=pprod]'); if (!pid) return; const r = pos.inv.rows.find((x) => x.productId === pid.value); $('#psize').innerHTML = r ? r.sizes.filter((z) => r.qty[z] > 0).map((z) => `<option value="${z}">${z} (${r.qty[z]} in stock)</option>`).join('') : ''; }

  // ============ categories / stores / employees ============
  V.categories = async () => {
    const l = await api('/api/admin/categories'); window._cats = l;
    main(`<div class="topbar"><h1 style="margin:0">Categories</h1><button class="btn sp" data-a="newcat">+ Add category</button></div>` + table(['Name', 'Description', 'T-shirts', ''], l.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.description)}</td><td>${c.productCount}</td><td><div class="actions"><button class="btn btn-sm btn-outline" data-a="editcat" data-v="${c._id}">Edit</button><button class="btn btn-sm btn-outline" data-a="delcat" data-v="${c._id}">Delete</button></div></td></tr>`)));
  };
  const catModal = (c) => modal(`<h2>${c ? 'Edit' : 'Add'} category</h2><form data-f="cat" ${c ? `data-id="${c._id}"` : ''}>${fld('Name', 'name', c && c.name)}${fld('Description', 'description', c && c.description)}${errBox}<div class="actions" style="margin-top:14px"><button class="btn">Save</button><button type="button" class="btn btn-outline" data-a="close">Cancel</button></div></form>`);
  V.stores = async () => {
    const l = await api('/api/admin/stores'); window._stores = l;
    main(`<div class="topbar"><h1 style="margin:0">Stores</h1><button class="btn sp" data-a="newstore">+ Add store</button></div>` + table(['Store', 'Address', 'Contact', 'Manager', 'Employees', ''], l.map((s) => `<tr><td><b>${esc(s.name)}</b><div class="small muted">${esc(s.openingHours)}</div></td><td class="small">${esc(s.street)}, ${esc(s.city)}, ${esc(s.state)} - ${esc(s.pincode)}</td><td class="small">${esc(s.phone)}<br>${esc(s.email)}</td><td>${esc(s.managerName || '-')}</td><td>${s.employeeCount}</td><td><div class="actions"><button class="btn btn-sm btn-outline" data-a="editstore" data-v="${s._id}">Edit</button><button class="btn btn-sm btn-outline" data-a="delstore" data-v="${s._id}">Delete</button></div></td></tr>`)));
  };
  async function storeModal(s) {
    const emps = s ? await api('/api/admin/employees?storeId=' + s._id) : [];
    modal(`<h2>${s ? 'Edit' : 'Add'} store</h2><form data-f="store" ${s ? `data-id="${s._id}"` : ''}><div class="row">${fld('Store name', 'name', s && s.name)}${fld('Opening hours', 'openingHours', s && s.openingHours)}</div>${fld('Street', 'street', s && s.street)}<div class="row">${fld('City', 'city', s && s.city)}${fld('State', 'state', s && s.state)}${fld('Pincode', 'pincode', s && s.pincode)}</div><div class="row">${fld('Phone', 'phone', s && s.phone)}${fld('E-mail', 'email', s && s.email)}</div>
      ${s ? sel('Store manager', 'managerId', [['', '- none -'], ...emps.map((e) => [e._id, e.name])], s.managerId) : '<p class="small muted">Add employees after creating the store, then choose the manager here.</p>'}${errBox}<div class="actions" style="margin-top:14px"><button class="btn">Save</button><button type="button" class="btn btn-outline" data-a="close">Cancel</button></div></form>`);
  }
  V.employees = async () => {
    const l = await api('/api/admin/employees'); window._emps = l;
    main(`<div class="topbar"><h1 style="margin:0">Employees</h1><button class="btn sp" data-a="newemp">+ Add employee</button></div>` + table(['Name', 'Designation', 'Store', 'Contact', 'Salary', ''], l.map((e) => `<tr><td><b>${esc(e.name)}</b></td><td>${esc(e.designation)}</td><td>${esc(e.storeName)}</td><td class="small">${esc(e.phone)}<br>${esc(e.email)}</td><td>${rs(e.salary)}</td><td><div class="actions"><button class="btn btn-sm btn-outline" data-a="editemp" data-v="${e._id}">Edit</button><button class="btn btn-sm btn-outline" data-a="delemp" data-v="${e._id}">Delete</button></div></td></tr>`)));
  };
  async function empModal(e) {
    const stores = await api('/api/admin/stores');
    modal(`<h2>${e ? 'Edit' : 'Add'} employee</h2><form data-f="emp" ${e ? `data-id="${e._id}"` : ''}><div class="row">${fld('Name', 'name', e && e.name)}${fld('E-mail', 'email', e && e.email)}${fld('Phone', 'phone', e && e.phone)}</div><div class="row">${sel('Designation', 'designation', ['Manager', 'Sales Executive', 'Cashier', 'Delivery Executive'].map((x) => [x, x]), e && e.designation)}${sel('Store', 'storeId', stores.map((s) => [s._id, s.name]), e && e.storeId)}${fld('Salary (Rs./month)', 'salary', e ? e.salary : 20000, 'number')}</div>${errBox}<div class="actions" style="margin-top:14px"><button class="btn">Save</button><button type="button" class="btn btn-outline" data-a="close">Cancel</button></div></form>`);
  }
  V.customers = async () => { const l = await api('/api/admin/customers'); main('<h1>Customers</h1>' + table(['Name', 'E-mail', 'Phone', 'Registered', 'Orders', 'Spent'], l.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${fmt(c.createdAt)}</td><td>${c.orders}</td><td>${rs(c.spent)}</td></tr>`))); };
  V.payments = async () => { const l = await api('/api/admin/payments'); main('<h1>Payments</h1>' + table(['Order', 'Mode', 'Amount', 'Status', 'Reference', 'Paid on'], l.map((p) => `<tr><td>${esc(p.orderNo)}</td><td>${esc(nice(p.mode))}</td><td>${rs(p.amount)}</td><td>${badge(p.status)}</td><td>${esc(p.txnRef || '-')}</td><td>${fmt(p.paidAt)}</td></tr>`))); };
  V.settings = async () => { main(`<h1>Settings</h1><div class="panel" style="max-width:420px"><h2>Change admin password</h2><form data-f="pw"><label class="f">Current password</label><input name="current" type="password"><label class="f">New password (min 6)</label><input name="next" type="password">${errBox}<button class="btn" style="margin-top:12px">Change password</button></form></div>`); };

  // ============ events ============
  const A = {
    logout: async () => { await api('/api/admin/logout', 'POST'); showLogin(); }, close: closeModal,
    restock: async (el) => { await api('/api/admin/inventory/restock', 'POST', { storeId: el.dataset.s, productId: el.dataset.p, size: el.dataset.z, add: 10 }); toast('Added 10 pieces'); V.dash(); },
    newprod: () => prodModal(null), editprod: (el) => prodModal(window._prods.find((p) => p._id === el.dataset.v)),
    oos: async (el) => { const on = el.dataset.on === '1'; await api('/api/admin/products/' + el.dataset.v + '/out-of-stock', 'POST', { value: on }); toast(on ? 'Marked OUT OF STOCK - shop shows the Out of Stock button' : 'Marked in stock'); V.products(); },
    delprod: async (el) => { if (!confirm('Delete this t-shirt?')) return; await api('/api/admin/products/' + el.dataset.v, 'DELETE'); toast('Deleted'); V.products(); },
    invsave: async (el) => { const row = el.closest('tr'), qty = {}; row.querySelectorAll('input[data-z]').forEach((i) => { qty[i.dataset.z] = i.value; }); await api('/api/admin/inventory', 'PUT', { storeId: window._invStore, productId: el.dataset.p, qty }); toast('Stock saved'); },
    vieworder: (el) => orderModal(el.dataset.v), markpaid: async (el) => { await api('/api/admin/orders/' + el.dataset.v + '/payment', 'PUT'); toast('Payment marked as received'); orderModal(el.dataset.v); },
    nextstatus: async (el) => { await api('/api/admin/orders/' + el.dataset.v + '/status', 'PUT', { status: el.dataset.s }); toast('Status updated'); orderModal(el.dataset.v); route(); },
    cancelorder: async (el) => { if (!confirm('Cancel this order? Stock will be returned.')) return; await api('/api/admin/orders/' + el.dataset.v + '/status', 'PUT', { status: 'CANCELLED' }); toast('Order cancelled'); orderModal(el.dataset.v); route(); },
    posadd: () => { const r = pos.inv.rows.find((x) => x.productId === $('[name=pprod]').value), z = $('#psize').value, q = Math.max(1, +$('#pqty').value || 1); if (!r || !z) return toast('Select a t-shirt and size', true); const l = pos.bill.find((x) => x.productId === r.productId && x.size === z); if (l) l.qty += q; else pos.bill.push({ productId: r.productId, name: r.name, size: z, qty: q, price: window._price[r.productId] || 0 }); posDraw(); },
    posrem: (el) => { pos.bill.splice(+el.dataset.v, 1); posDraw(); },
    newcat: () => catModal(null), editcat: (el) => catModal(window._cats.find((c) => c._id === el.dataset.v)), delcat: async (el) => { if (!confirm('Delete this category?')) return; await api('/api/admin/categories/' + el.dataset.v, 'DELETE'); toast('Deleted'); V.categories(); },
    newstore: () => storeModal(null), editstore: (el) => storeModal(window._stores.find((s) => s._id === el.dataset.v)), delstore: async (el) => { if (!confirm('Delete this store?')) return; await api('/api/admin/stores/' + el.dataset.v, 'DELETE'); toast('Deleted'); V.stores(); },
    newemp: () => empModal(null), editemp: (el) => empModal(window._emps.find((e) => e._id === el.dataset.v)), delemp: async (el) => { if (!confirm('Delete this employee?')) return; await api('/api/admin/employees/' + el.dataset.v, 'DELETE'); toast('Deleted'); V.employees(); },
  };
  document.addEventListener('click', async (e) => { const el = e.target.closest('[data-a]'); if (!el) return; if (el.tagName === 'A') e.preventDefault(); try { await A[el.dataset.a](el); } catch (x) { toast(x.message, true); } });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-f]'); if (!f) return; e.preventDefault(); const d = Object.fromEntries(new FormData(f)), id = f.dataset.id, bx = $('[data-err]', f); if (bx) bx.classList.add('hidden');
    try {
      switch (f.dataset.f) {
        case 'login': { const me = await api('/api/admin/login', 'POST', d); shell(me); break; }
        case 'prod': await saveProd(f); break;
        case 'cat': await api(id ? '/api/admin/categories/' + id : '/api/admin/categories', id ? 'PUT' : 'POST', d); closeModal(); toast('Saved'); V.categories(); break;
        case 'store': await api(id ? '/api/admin/stores/' + id : '/api/admin/stores', id ? 'PUT' : 'POST', d); closeModal(); toast('Saved'); V.stores(); break;
        case 'emp': await api(id ? '/api/admin/employees/' + id : '/api/admin/employees', id ? 'PUT' : 'POST', d); closeModal(); toast('Saved'); V.employees(); break;
        case 'delivery': d.outForDelivery = !!d.outForDelivery; await api('/api/admin/orders/' + id + '/delivery', 'PUT', d); toast('Delivery details saved'); orderModal(id); break;
        case 'pw': await api('/api/admin/password', 'PUT', d); toast('Password changed'); f.reset(); break;
        case 'pos': { const o = await api('/api/admin/pos', 'POST', { storeId: pos.store, empId: $('[name=pemp]').value, paymentMode: d.paymentMode, customerEmail: d.customerEmail, customerName: d.customerName, items: pos.bill.map((l) => ({ productId: l.productId, size: l.size, qty: l.qty })) }); toast('Sale completed - bill ' + o.orderNo + ' (' + rs(o.total) + ')'); pos.bill = []; await posLoad(); break; }
      }
    } catch (x) { err(f, x.message); }
  });
  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'inv-store') invLoad(t.value);
    else if (t.id === 'o-status' || t.id === 'o-channel') { window._oq = { ...(window._oq || {}), status: $('#o-status').value, channel: $('#o-channel').value, search: $('#o-search').value }; V.orders(); }
    else if (t.name === 'pstore') { pos.store = t.value; pos.bill = []; await posLoad(); } else if (t.name === 'pprod') posSizes();
  });
  let tm; document.addEventListener('input', (e) => { if (e.target.id === 'o-search') { clearTimeout(tm); tm = setTimeout(() => { window._oq = { ...(window._oq || {}), status: $('#o-status').value, channel: $('#o-channel').value, search: e.target.value }; V.orders().then(() => { const i = $('#o-search'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 350); } });
  window.addEventListener('hashchange', () => { if ($('#main')) route(); });
  (async () => { window._price = {}; try { const m = await api('/api/admin/me'); if (m.admin) { shell(m.admin); } else showLogin(); } catch (e) { showLogin(); } })();
  // price lookup for the billing page
  const origPos = V.pos; V.pos = async () => { (await api('/api/admin/products')).forEach((p) => { window._price[p._id] = p.price; }); await origPos(); };
})();
