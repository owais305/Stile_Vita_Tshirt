(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s), app = $('#app');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rs = (n) => '\u20B9' + Number(n || 0).toLocaleString('en-IN');
  const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
  const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '-');
  const nice = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
  const badge = (s) => `<span class="badge st-${esc(s)}">${esc(nice(s))}</span>`;
  const FREE = 999, CHARGE = 60, MAXQ = 10;
  async function api(url, method = 'GET', body) {
    const o = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' }; if (method !== 'GET') o.body = JSON.stringify(body || {});
    const r = await fetch(url, o); let d = null; try { d = await r.json(); } catch (e) { /* none */ }
    if (!r.ok) throw new Error((d && d.error) || 'Request failed (' + r.status + ')'); return d;
  }
  const toast = (m, err) => { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = m; $('#toast').appendChild(t); setTimeout(() => t.remove(), 3200); };
  const st = { user: null, cfg: {}, cats: [], cart: [], f: { search: '', category: '', sort: 'new', inStock: false }, after: null };
  try { st.cart = JSON.parse(localStorage.getItem('ts_cart') || '[]'); } catch (e) { st.cart = []; }
  const saveCart = () => { localStorage.setItem('ts_cart', JSON.stringify(st.cart)); nav(); };
  function nav() {
    $('#nav').innerHTML = `<a href="#/">Shop</a><a href="#/stores">Our stores</a>` + (st.user ? `<a href="#/orders">My orders</a><a href="#/account">${esc(st.user.name.split(' ')[0])}</a><button class="linklike" data-a="logout">Logout</button>` : `<a href="#/login">Login</a><a href="#/register">Register</a>`)
      + `<a href="#/cart"><b>Cart</b><span class="cart-count">${st.cart.reduce((s, l) => s + l.qty, 0)}</span></a>`;
  }
  const ROUTES = [[/^#\/?$/, home], [/^#\/product\/([a-f0-9]{24})$/, product], [/^#\/cart$/, cart], [/^#\/checkout$/, checkout], [/^#\/login$/, login], [/^#\/register$/, register], [/^#\/orders$/, orders], [/^#\/order\/([a-f0-9]{24})(\?new=1)?$/, order], [/^#\/account$/, account], [/^#\/stores$/, stores]];
  async function router() {
    const h = location.hash || '#/';
    for (const [re, fn] of ROUTES) { const m = re.exec(h); if (m) { try { await fn(...m.slice(1)); } catch (e) { app.innerHTML = `<div class="container"><div class="alert err">${esc(e.message)}</div></div>`; } window.scrollTo(0, 0); return; } }
    app.innerHTML = '<div class="container"><h2>Page not found</h2><a href="#/">Go to the shop</a></div>';
  }
  const go = (h) => { if (location.hash === h) router(); else location.hash = h; };
  const needLogin = () => { if (st.user) return false; st.after = location.hash; toast('Please log in first', true); go('#/login'); return true; };

  // ---------- home ----------
  const card = (p) => `<div class="card ${p.inStock ? '' : 'oos'}"><a class="pic" href="#/product/${p._id}"><img src="${esc(p.image || '/img/placeholder.svg')}" alt="${esc(p.name)}">${!p.inStock ? '<span class="badge oosb">Out of Stock</span>' : p.totalQty <= 10 ? '<span class="badge low">Only few left</span>' : ''}</a>
    <div class="body"><div class="name">${esc(p.name)}</div><div class="meta">${esc(p.brand)} &middot; ${esc(p.colour)}${p.category ? ' &middot; ' + esc(p.category.name) : ''}</div><div class="price">${rs(p.price)}</div>
    ${p.inStock ? `<a class="btn" href="#/product/${p._id}">View &amp; Add to Cart</a>` : '<button class="btn btn-oos" disabled>Out of Stock</button>'}</div></div>`;
  async function grid() {
    const f = st.f, q = new URLSearchParams(); if (f.search) q.set('search', f.search); if (f.category) q.set('category', f.category); if (f.sort !== 'new') q.set('sort', f.sort); if (f.inStock) q.set('inStock', '1');
    const l = await api('/api/products?' + q); $('#grid').innerHTML = l.length ? l.map(card).join('') : '<p class="muted">No t-shirts found.</p>'; $('#count').textContent = l.length + ' t-shirts';
  }
  async function home() {
    if (!st.cats.length) st.cats = await api('/api/categories'); const f = st.f;
    app.innerHTML = `<div class="container"><div class="hero"><h1>Wear your story.</h1><p>Soft cotton t-shirts - home delivery or pick-up from a store near you.</p></div>
      <div class="filters"><input type="search" id="f-search" placeholder="Search t-shirts, brand or colour..." value="${esc(f.search)}">
      <select id="f-cat"><option value="">All categories</option>${st.cats.map((c) => `<option value="${c._id}" ${f.category === c._id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select id="f-sort"><option value="new">Newest</option><option value="price_asc" ${f.sort === 'price_asc' ? 'selected' : ''}>Price: low to high</option><option value="price_desc" ${f.sort === 'price_desc' ? 'selected' : ''}>Price: high to low</option></select>
      <label class="chk"><input type="checkbox" id="f-in" ${f.inStock ? 'checked' : ''}> In stock only</label><span class="muted small" id="count"></span></div><div class="grid" id="grid"></div></div>`;
    await grid();
  }

  // ---------- product ----------
  let V = null;
  function buybox() {
    const p = V.p, z = p.sizes.find((s) => s.size === V.size), ok = p.inStock && z && z.inStock, max = ok ? Math.min(MAXQ, z.qty) : 1; if (V.qty > max) V.qty = max;
    return `<div class="sizes">${p.sizes.map((s) => `<button class="size-btn ${s.size === V.size ? 'sel' : ''}" data-a="size" data-v="${s.size}" ${s.inStock ? '' : 'disabled title="Out of stock"'}>${s.size}</button>`).join('')}</div>` + (ok
      ? `<div class="muted small">${z.qty <= 5 ? 'Hurry! Only ' + z.qty + ' left in size ' + z.size : 'In stock'}</div><div class="qty"><span>Quantity</span><button class="btn btn-outline btn-sm" data-a="qminus">-</button><input id="qty" type="number" min="1" max="${max}" value="${V.qty}"><button class="btn btn-outline btn-sm" data-a="qplus">+</button></div><button class="btn btn-lg" data-a="add">Add to Cart</button>`
      : `<div class="qty"></div><button class="btn btn-oos btn-lg" disabled>Out of Stock</button><p class="muted small">${p.inStock ? 'This size is finished. Please choose another size.' : 'This t-shirt is currently out of stock.'}</p>`);
  }
  async function product(id) {
    const p = await api('/api/products/' + id), f = p.sizes.find((s) => s.inStock); V = { p, size: f ? f.size : p.sizes[0].size, qty: 1 };
    app.innerHTML = `<div class="container"><p><a href="#/">&larr; Back to shop</a></p><div class="product ${p.inStock ? '' : 'oos'}"><div class="big"><img src="${esc(p.image || '/img/placeholder.svg')}" alt="${esc(p.name)}"></div>
      <div><h1>${esc(p.name)}</h1><div class="muted">${esc(p.brand)} &middot; ${p.category ? esc(p.category.name) : ''}</div><div class="price" style="margin:10px 0">${rs(p.price)} ${p.inStock ? '' : '<span class="badge oosb">Out of Stock</span>'}</div>
      <p>${esc(p.description)}</p><p class="small muted">Colour: <b>${esc(p.colour)}</b> &middot; Fabric: <b>${esc(p.material)}</b></p><label class="f">Select size</label><div id="buybox">${buybox()}</div>
      <p class="small muted">Free delivery above ${rs(FREE)} (else ${rs(CHARGE)}). Pick-up from a store is free.</p></div></div>
      <div class="panel" style="margin-top:18px"><h2>Availability in our stores (for pick-up)</h2><div class="tablebox"><table class="t"><tr><th>Store</th><th>City</th>${p.sizeList.map((s) => `<th>${s}</th>`).join('')}</tr>
      ${p.availability.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.city)}</td>${p.sizeList.map((s) => `<td class="${a.sizes[s] > 0 ? 'okn' : 'zero'}">${a.sizes[s] > 0 ? a.sizes[s] : 'Out'}</td>`).join('')}</tr>`).join('')}</table></div></div></div>`;
  }

  // ---------- cart ----------
  function addToCart() {
    const { p, size } = V, z = p.sizes.find((s) => s.size === size); if (!z || !z.inStock) return toast('Out of stock', true);
    const q = Math.max(1, Math.min(Number($('#qty').value) || 1, MAXQ, z.qty)), l = st.cart.find((x) => x.productId === p._id && x.size === size);
    if (l) l.qty = Math.min(MAXQ, l.qty + q); else st.cart.push({ productId: p._id, name: p.name, price: p.price, image: p.image, size, qty: q }); saveCart(); toast('Added to cart');
  }
  async function cart() {
    if (!st.cart.length) { app.innerHTML = '<div class="container"><div class="panel center"><h2>Your cart is empty</h2><a class="btn" href="#/">Continue shopping</a></div></div>'; return; }
    const m = new Map((await api('/api/products')).map((p) => [p._id, p])); let sub = 0, bad = 0;
    const lines = st.cart.map((l, i) => { const p = m.get(l.productId), z = p && p.sizes.find((s) => s.size === l.size), ok = p && p.inStock && z && z.inStock && z.qty >= l.qty; if (!ok) bad++; sub += l.price * l.qty;
      return `<div class="cartline"><img src="${esc(l.image || '/img/placeholder.svg')}" alt=""><div><b>${esc(l.name)}</b><div class="muted small">Size ${esc(l.size)} &middot; ${rs(l.price)}</div>${ok ? '' : '<div><span class="badge oosb">Out of Stock</span> <span class="small zero">Not enough stock - reduce or remove.</span></div>'}</div>
      <div class="right"><div class="stepper"><button data-a="cdec" data-v="${i}">-</button><b>${l.qty}</b><button data-a="cinc" data-v="${i}">+</button></div><div><b>${rs(l.price * l.qty)}</b></div><button class="btn btn-sm btn-outline" data-a="crem" data-v="${i}">Remove</button></div></div>`; }).join('');
    app.innerHTML = `<div class="container"><h2>Shopping cart</h2><div class="two"><div class="panel">${lines}</div><div class="panel"><h2>Order summary</h2><div class="sum"><span>Subtotal</span><b>${rs(sub)}</b></div>
      <div class="sum"><span>Delivery</span><span>${sub >= FREE ? 'FREE' : rs(CHARGE) + ' (free for pick-up)'}</span></div>${bad ? '<div class="alert err">Some items are out of stock. Fix them to continue.</div>' : ''}
      <button class="btn btn-lg btn-block" data-a="tocheckout" ${bad ? 'disabled' : ''}>Proceed to checkout</button></div></div></div>`;
  }

  // ---------- login / register / address form ----------
  function login() { app.innerHTML = `<div class="container" style="max-width:440px"><div class="panel"><h2>Login</h2><form data-f="login"><label class="f">E-mail</label><input name="email"><label class="f">Password</label><input name="password" type="password"><div class="alert err hidden" data-err></div><button class="btn btn-block" style="margin-top:14px">Login</button></form><p class="small">New here? <a href="#/register">Create an account</a></p><p class="small muted">Demo: demo@example.com / demo123</p></div></div>`; }
  function register() { app.innerHTML = `<div class="container" style="max-width:440px"><div class="panel"><h2>Create account</h2><form data-f="register"><label class="f">Full name</label><input name="name"><label class="f">E-mail</label><input name="email"><label class="f">Mobile number</label><input name="phone"><label class="f">Password (min 6)</label><input name="password" type="password"><div class="alert err hidden" data-err></div><button class="btn btn-block" style="margin-top:14px">Register</button></form></div></div>`; }
  const addrForm = (a, f) => { a = a || {}; return `<form data-f="${f}" ${a._id ? `data-id="${a._id}"` : ''}><div class="row"><div><label class="f">Type</label><select name="label">${['Home', 'Office', 'Other'].map((x) => `<option ${a.label === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div><label class="f">Receiver name</label><input name="name" value="${esc(a.name || (st.user && st.user.name) || '')}"></div><div><label class="f">Phone</label><input name="phone" value="${esc(a.phone || (st.user && st.user.phone) || '')}"></div></div>
    <label class="f">Address</label><input name="line" value="${esc(a.line || '')}"><div class="row"><div><label class="f">City</label><input name="city" value="${esc(a.city || '')}"></div><div><label class="f">State</label><input name="state" value="${esc(a.state || '')}"></div><div><label class="f">Pincode</label><input name="pincode" value="${esc(a.pincode || '')}"></div></div><div class="alert err hidden" data-err></div><button class="btn" style="margin-top:12px">${a._id ? 'Update' : 'Save'} address</button></form>`; };

  // ---------- checkout ----------
  let co = null;
  async function checkout() {
    if (needLogin()) return; if (!st.cart.length) return go('#/cart');
    const [addresses, stores, det] = await Promise.all([api('/api/me/addresses'), api('/api/stores'), Promise.all(st.cart.map((l) => api('/api/products/' + l.productId).catch(() => null)))]);
    const ok = {}; stores.forEach((s) => { ok[s._id] = st.cart.every((l, i) => { const d = det[i]; if (!d || !d.inStock) return false; const a = d.availability.find((x) => x.storeId === s._id); return a && (a.sizes[l.size] || 0) >= l.qty; }); });
    co = { addresses, stores, ok, mode: 'HOME_DELIVERY', addressId: addresses[0] ? addresses[0]._id : '', storeId: (stores.find((s) => ok[s._id]) || {})._id || '', pay: st.cfg.razorpay ? 'RAZORPAY' : 'UPI', rzpm: 'upi', newAddr: !addresses.length }; drawCheckout();
  }
  function drawCheckout() {
    const c = co, sub = st.cart.reduce((s, l) => s + l.price * l.qty, 0), charge = c.mode === 'HOME_DELIVERY' && sub < FREE ? CHARGE : 0, any = c.stores.some((s) => c.ok[s._id]);
    const last = c.mode === 'HOME_DELIVERY' ? ['COD', 'Cash on delivery'] : ['PAY_AT_STORE', 'Pay at the store'];
    const online = st.cfg.razorpay ? [['RAZORPAY', 'Pay online - UPI (Google Pay, PhonePe, Paytm) / Cards / Net banking / Wallets']] : [['UPI', 'UPI'], ['DEBIT_CARD', 'Debit card'], ['CREDIT_CARD', 'Credit card'], ['NET_BANKING', 'Net banking']];
    const pays = [...online, last]; if (!pays.some((p) => p[0] === c.pay)) c.pay = pays[0][0];
    const opt = (sel, dis, inner) => `<label class="opt ${sel ? 'sel' : ''} ${dis ? 'dis' : ''}">${inner}</label>`;
    app.innerHTML = `<div class="container"><h2>Checkout</h2><div class="two"><div><div class="panel"><h2>1. How do you want your t-shirts?</h2>
      ${opt(c.mode === 'HOME_DELIVERY', 0, `<input type="radio" name="mode" value="HOME_DELIVERY" ${c.mode === 'HOME_DELIVERY' ? 'checked' : ''}><span><b>Home delivery</b><br><span class="muted small">Delivered to your address in about 5 days.</span></span>`)}
      ${opt(c.mode === 'STORE_PICKUP', 0, `<input type="radio" name="mode" value="STORE_PICKUP" ${c.mode === 'STORE_PICKUP' ? 'checked' : ''}><span><b>Pick up from a store</b><br><span class="muted small">Free. Collect from the store you select.</span></span>`)}
      ${c.mode === 'HOME_DELIVERY' ? `<h3>Delivery address</h3>${c.addresses.map((a) => opt(c.addressId === a._id && !c.newAddr, 0, `<input type="radio" name="addr" value="${a._id}" ${c.addressId === a._id && !c.newAddr ? 'checked' : ''}><span><b>${esc(a.label)}</b> - ${esc(a.name)}, ${esc(a.phone)}<br><span class="small muted">${esc(a.line)}, ${esc(a.city)}, ${esc(a.state)} - ${esc(a.pincode)}</span></span>`)).join('')}
        <button class="btn btn-outline btn-sm" data-a="newaddr">${c.newAddr ? 'Cancel new address' : '+ Add a new address'}</button>${c.newAddr ? `<div style="margin-top:10px">${addrForm({}, 'coaddr')}</div>` : ''}${any ? '' : '<div class="alert err">Some items are not available for delivery right now. Reduce the quantity or remove them from the cart.</div>'}`
      : `<h3>Select the store</h3>${c.stores.map((s) => opt(c.storeId === s._id, !c.ok[s._id], `<input type="radio" name="store" value="${s._id}" ${c.storeId === s._id ? 'checked' : ''} ${c.ok[s._id] ? '' : 'disabled'}><span><b>${esc(s.name)}</b><br><span class="small muted">${esc(s.street)}, ${esc(s.city)} - ${esc(s.pincode)} &middot; ${esc(s.openingHours)}</span><br>${c.ok[s._id] ? '<span class="small okn">All items available</span>' : '<span class="small zero">Out of Stock - some items are not available here</span>'}</span>`)).join('')}`}</div>
      <div class="panel"><h2>2. Payment</h2>${pays.map((p) => opt(c.pay === p[0], 0, `<input type="radio" name="pay" value="${p[0]}" ${c.pay === p[0] ? 'checked' : ''}><span>${p[1]}</span>`)).join('')}${st.cfg.razorpay && c.pay === 'RAZORPAY' ? `<div class="sub"><label class="opt ${c.rzpm === 'upi' ? 'sel' : ''}"><input type="radio" name="rzpm" value="upi" ${c.rzpm === 'upi' ? 'checked' : ''}><span><b>UPI</b> - Google Pay, PhonePe, Paytm, BHIM or any UPI app<br><span class="muted small">On mobile your UPI app opens; on laptop scan the QR or enter your UPI ID.</span></span></label><label class="opt ${c.rzpm === 'all' ? 'sel' : ''}"><input type="radio" name="rzpm" value="all" ${c.rzpm === 'all' ? 'checked' : ''}><span><b>Card / Net banking / Wallet</b><br><span class="muted small">Debit card, credit card, net banking, wallets.</span></span></label></div>` : ''}${st.cfg.razorpay ? '<div class="alert info small">You will pay securely on the Razorpay payment page after placing the order.</div>' : '<div class="alert info small">Demo mode: online payment is simulated (no real money is charged). Add Razorpay keys to enable real payments.</div>'}</div></div>
      <div class="panel"><h2>Order summary</h2>${st.cart.map((l) => `<div class="sum small"><span>${esc(l.name)} (${esc(l.size)}) &times; ${l.qty}</span><span>${rs(l.price * l.qty)}</span></div>`).join('')}<div class="sum" style="margin-top:8px"><span>Subtotal</span><b>${rs(sub)}</b></div><div class="sum"><span>Delivery</span><span>${charge ? rs(charge) : 'FREE'}</span></div><div class="sum total"><span>Total</span><span>${rs(sub + charge)}</span></div>
      <div class="alert err hidden" id="co-err"></div><button class="btn btn-lg btn-block" style="margin-top:12px" data-a="place">Place order</button></div></div></div>`;
  }
  async function place() {
    const c = co, e = $('#co-err'); e.classList.add('hidden'); const b = { fulfilmentMode: c.mode, paymentMode: c.pay, items: st.cart.map((l) => ({ productId: l.productId, size: l.size, qty: l.qty })) };
    const fail = (m) => { e.textContent = m; e.classList.remove('hidden'); };
    if (c.mode === 'HOME_DELIVERY') { if (c.newAddr || !c.addressId) return fail('Please save your delivery address first.'); b.addressId = c.addressId; } else { if (!c.storeId) return fail('Please select a store.'); b.storeId = c.storeId; }
    try {
      const o = await api('/api/orders', 'POST', b); st.cart = []; saveCart();
      if (o.razorpay) {   // online payment: open Razorpay Checkout
        const ok = await payRzp(o._id, o.razorpay, c.rzpm).catch((x) => { toast(x.message, true); return false; });
        if (!ok) toast('Payment not completed. You can pay from "My orders" within 30 minutes.', true);
        go('#/order/' + o._id + (ok ? '?new=1' : ''));
      } else go('#/order/' + o._id + '?new=1');
    } catch (x) { fail(x.message); }
  }

  // ---------- Razorpay Checkout ----------
  function loadRzp() {
    return new Promise((ok, no) => {
      if (window.Razorpay) return ok();
      const sc = document.createElement('script'); sc.src = 'https://checkout.razorpay.com/v1/checkout.js'; sc.onload = ok; sc.onerror = () => no(new Error('Could not load the Razorpay payment window. Check your internet connection.')); document.head.appendChild(sc);
    });
  }
  // opens the Razorpay payment window; resolves true when the payment is verified by our server, false if the customer closed the window
  async function payRzp(orderId, info, method) {
    await loadRzp();
    return new Promise((resolve, reject) => {
      const rz = new window.Razorpay(window.RzpOptions.build(info, st.user, { method: method || 'upi',
        onSuccess: async (resp) => { try { await api('/api/payments/razorpay/verify', 'POST', { orderId, razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }); resolve(true); } catch (e) { reject(e); } },
        onDismiss: () => resolve(false) }));
      rz.on('payment.failed', (r) => toast('Payment failed: ' + ((r.error && r.error.description) || 'please try again'), true));
      rz.open();
    });
  }

  // ---------- orders / account / stores ----------
  async function orders() {
    if (needLogin()) return; const l = await api('/api/orders');
    app.innerHTML = `<div class="container"><h2>My orders</h2>${l.length ? `<div class="tablebox"><table class="t"><tr><th>Order no.</th><th>Date</th><th>Type</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr>${l.map((o) => `<tr><td><b>${esc(o.orderNo)}</b></td><td>${fmt(o.createdAt)}</td><td>${esc(nice(o.fulfilmentMode))}</td><td>${o.items.reduce((s, i) => s + i.qty, 0)}</td><td>${rs(o.total)}</td><td>${badge(o.status)}</td><td><a href="#/order/${o._id}">View</a></td></tr>`).join('')}</table></div>` : '<div class="panel center"><p>You have not placed any order yet.</p><a class="btn" href="#/">Start shopping</a></div>'}</div>`;
  }
  async function order(id, isNew) {
    if (needLogin()) return; const d = await api('/api/orders/' + id), o = d.order, fl = d.flow || [], ix = fl.indexOf(o.status), dl = d.delivery;
    app.innerHTML = `<div class="container"><p><a href="#/orders">&larr; My orders</a></p>${isNew ? `<div class="alert ok"><b>Thank you! Your order has been placed.</b> Stock has been reserved for you${o.fulfilmentMode === 'STORE_PICKUP' ? ' at ' + esc(o.storeName) : ''}.</div>` : ''}
      <div class="panel"><h2>Order ${esc(o.orderNo)} ${badge(o.status)}</h2><div class="muted small">Placed on ${fmt(o.createdAt)}</div>${o.status === 'CANCELLED' ? '<div class="alert err">This order was cancelled. Any paid amount is refunded.</div>' : `<div class="timeline">${fl.map((s, i) => `<div class="step ${i <= ix ? 'done' : ''}">${esc(nice(s))}</div>`).join('')}</div>`}
      ${o.paymentMode === 'RAZORPAY' && o.paymentStatus === 'PENDING' && o.status !== 'CANCELLED' ? `<div class="alert info">Payment is pending. Complete it within 30 minutes, otherwise the order is cancelled automatically.</div><button class="btn" data-a="paynow" data-v="${o._id}">Pay now</button> ` : ''}${d.canCancel ? `<button class="btn btn-danger btn-sm" data-a="cancel" data-v="${o._id}">Cancel order</button>` : ''}</div>
      <div class="two"><div class="panel"><h2>Items</h2><table class="t"><tr><th>T-shirt</th><th>Size</th><th>Qty</th><th class="right">Amount</th></tr>${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.size)}</td><td>${i.qty}</td><td class="right">${rs(i.lineTotal)}</td></tr>`).join('')}</table>
      <div class="sum" style="margin-top:8px"><span>Subtotal</span><span>${rs(o.subtotal)}</span></div><div class="sum"><span>Delivery</span><span>${o.deliveryCharge ? rs(o.deliveryCharge) : 'FREE'}</span></div><div class="sum total"><span>Total</span><span>${rs(o.total)}</span></div></div>
      <div><div class="panel"><h2>${dl ? 'Delivery' : 'Pick-up'}</h2>${dl ? `<div class="addr"><b>${esc(dl.address.name)}</b> (${esc(dl.address.phone)})<br>${esc(dl.address.line)}, ${esc(dl.address.city)}, ${esc(dl.address.state)} - ${esc(dl.address.pincode)}</div><p class="small">Courier: <b>${esc(dl.courier || 'to be assigned')}</b><br>Tracking no.: <b>${esc(dl.trackingNo || '-')}</b><br>Expected: <b>${day(dl.expectedDate)}</b>${dl.deliveredDate ? '<br>Delivered: <b>' + day(dl.deliveredDate) + '</b>' : ''}<br>Status: ${badge(dl.status)}</p>`
      : `<div class="addr"><b>${esc(o.storeName)}</b>${d.store ? '<br>' + esc(d.store.street) + ', ' + esc(d.store.city) + ' - ' + esc(d.store.pincode) + '<br>' + esc(d.store.phone) : ''}</div>`}</div>
      <div class="panel"><h2>Payment</h2>${d.payments.map((p) => `<div class="small">${esc(nice(p.mode))} &middot; ${rs(p.amount)} &middot; ${badge(p.status)}${p.txnRef ? '<br>Ref: ' + esc(p.txnRef) : ''}</div>`).join('')}</div></div></div></div>`;
  }
  async function account() {
    if (needLogin()) return; const ad = await api('/api/me/addresses'); window._ad = ad;
    app.innerHTML = `<div class="container"><h2>My account</h2><div class="two"><div><div class="panel"><h2>Profile</h2><form data-f="profile"><label class="f">Name</label><input name="name" value="${esc(st.user.name)}"><label class="f">E-mail</label><input value="${esc(st.user.email)}" disabled><label class="f">Phone</label><input name="phone" value="${esc(st.user.phone)}"><div class="alert err hidden" data-err></div><button class="btn" style="margin-top:12px">Save profile</button></form></div>
      <div class="panel"><h2>Saved addresses</h2>${ad.map((a) => `<div class="addr"><b>${esc(a.label)}</b> - ${esc(a.name)}, ${esc(a.phone)}<br><span class="small muted">${esc(a.line)}, ${esc(a.city)}, ${esc(a.state)} - ${esc(a.pincode)}</span><br><button class="btn btn-outline btn-sm" data-a="eaddr" data-v="${a._id}">Edit</button> <button class="btn btn-outline btn-sm" data-a="daddr" data-v="${a._id}">Delete</button></div>`).join('') || '<p class="muted">No saved address yet.</p>'}<h3 id="at">Add a new address</h3><div id="af">${addrForm({}, 'addr')}</div></div></div>
      <div class="panel"><h2>Quick links</h2><p><a href="#/orders">My orders</a></p><p><a href="#/cart">My cart</a></p></div></div></div>`;
  }
  async function stores() { const l = await api('/api/stores'); app.innerHTML = `<div class="container"><h2>Our stores</h2><div class="grid">${l.map((s) => `<div class="panel"><h3 style="margin-top:0">${esc(s.name)}</h3><p>${esc(s.street)}<br>${esc(s.city)}, ${esc(s.state)} - ${esc(s.pincode)}</p><p class="small muted">Phone: ${esc(s.phone)}<br>E-mail: ${esc(s.email)}<br>Open: ${esc(s.openingHours || '-')}</p></div>`).join('')}</div><p class="muted">Visit any store and buy in person, or choose a store for pick-up while ordering online.</p></div>`; }

  // ---------- events ----------
  const A = {
    paynow: async (el) => { const r = await api('/api/orders/' + el.dataset.v + '/pay', 'POST'); const ok = await payRzp(el.dataset.v, r.razorpay); if (ok) toast('Payment successful'); order(el.dataset.v); },
    logout: async () => { await api('/api/auth/logout', 'POST'); st.user = null; nav(); toast('Logged out'); go('#/'); },
    size: (el) => { V.size = el.dataset.v; V.qty = 1; $('#buybox').innerHTML = buybox(); },
    qminus: () => { const i = $('#qty'); i.value = Math.max(1, +i.value - 1); V.qty = +i.value; }, qplus: () => { const i = $('#qty'); i.value = Math.min(+i.max || 1, +i.value + 1); V.qty = +i.value; },
    add: addToCart, cinc: (el) => { const l = st.cart[el.dataset.v]; if (l.qty < MAXQ) l.qty++; saveCart(); cart(); }, cdec: (el) => { const l = st.cart[el.dataset.v]; if (l.qty > 1) l.qty--; saveCart(); cart(); },
    crem: (el) => { st.cart.splice(+el.dataset.v, 1); saveCart(); cart(); }, tocheckout: () => { if (!needLogin()) go('#/checkout'); }, newaddr: () => { co.newAddr = !co.newAddr; drawCheckout(); }, place,
    cancel: async (el) => { if (!confirm('Cancel this order?')) return; await api('/api/orders/' + el.dataset.v + '/cancel', 'POST'); toast('Order cancelled'); order(el.dataset.v); },
    eaddr: (el) => { const a = window._ad.find((x) => x._id === el.dataset.v); $('#at').textContent = 'Edit address'; $('#af').innerHTML = addrForm(a, 'addr'); },
    daddr: async (el) => { if (!confirm('Delete this address?')) return; await api('/api/me/addresses/' + el.dataset.v, 'DELETE'); toast('Address deleted'); account(); },
  };
  document.addEventListener('click', async (e) => { const el = e.target.closest('[data-a]'); if (!el) return; try { await A[el.dataset.a](el); } catch (x) { toast(x.message, true); } });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-f]'); if (!f) return; e.preventDefault(); const d = Object.fromEntries(new FormData(f)), box = $('[data-err]', f); if (box) box.classList.add('hidden');
    try {
      switch (f.dataset.f) {
        case 'login': st.user = await api('/api/auth/login', 'POST', d); nav(); toast('Welcome back'); go(st.after || '#/'); st.after = null; break;
        case 'register': st.user = await api('/api/auth/register', 'POST', d); nav(); toast('Account created'); go(st.after || '#/'); st.after = null; break;
        case 'profile': st.user = { ...st.user, ...(await api('/api/me', 'PUT', d)) }; nav(); toast('Profile saved'); break;
        case 'addr': if (f.dataset.id) await api('/api/me/addresses/' + f.dataset.id, 'PUT', d); else await api('/api/me/addresses', 'POST', d); toast('Address saved'); account(); break;
        case 'coaddr': { const a = await api('/api/me/addresses', 'POST', d); co.addresses.unshift(a); co.addressId = a._id; co.newAddr = false; drawCheckout(); toast('Address saved'); break; }
      }
    } catch (x) { if (box) { box.textContent = x.message; box.classList.remove('hidden'); } else toast(x.message, true); }
  });
  let tm; document.addEventListener('input', (e) => { const t = e.target; if (t.id === 'f-search') { clearTimeout(tm); tm = setTimeout(() => { st.f.search = t.value.trim(); grid(); }, 300); } if (t.id === 'qty' && V) V.qty = +t.value || 1; });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'f-cat') { st.f.category = t.value; grid(); } else if (t.id === 'f-sort') { st.f.sort = t.value; grid(); } else if (t.id === 'f-in') { st.f.inStock = t.checked; grid(); }
    else if (co && t.name === 'mode') { co.mode = t.value; if (co.mode === 'STORE_PICKUP' && !co.ok[co.storeId]) co.storeId = (co.stores.find((s) => co.ok[s._id]) || {})._id || ''; drawCheckout(); }
    else if (co && t.name === 'addr') { co.addressId = t.value; drawCheckout(); } else if (co && t.name === 'store') { co.storeId = t.value; drawCheckout(); } else if (co && t.name === 'pay') { co.pay = t.value; drawCheckout(); } else if (co && t.name === 'rzpm') { co.rzpm = t.value; drawCheckout(); }
  });
  window.addEventListener('hashchange', router);
  (async () => { try { st.cfg = await api('/api/config'); } catch (e) { st.cfg = {}; } try { st.user = (await api('/api/me')).user; } catch (e) { st.user = null; } nav(); router(); })();
})();
