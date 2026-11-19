'use strict';
// Demo data: 3 stores, 9 employees, 5 categories, 13 t-shirts, stock in every store, a demo customer and 3 demo orders.
const ALL = ['S', 'M', 'L', 'XL', 'XXL'];
const STORES = [
  ['ABC Tees - Connaught Place', '12 Janpath Road', 'Delhi', 'Delhi', '110001', '011-40001234', 'cp@abctees.example', '10:00 - 21:00'],
  ['ABC Tees - Bandra', '45 Linking Road', 'Mumbai', 'Maharashtra', '400050', '022-40005678', 'bandra@abctees.example', '10:00 - 22:00'],
  ['ABC Tees - Indiranagar', '100 Feet Road', 'Bengaluru', 'Karnataka', '560038', '080-40009012', 'indiranagar@abctees.example', '10:00 - 21:30']];
const EMPS = [['Anil Verma', 'Manager', 0], ['Neha Kapoor', 'Sales Executive', 0], ['Rohit Das', 'Cashier', 0], ['Sunita Rao', 'Manager', 1], ['Imran Sheikh', 'Sales Executive', 1],
  ['Pooja Nair', 'Cashier', 1], ['Karthik Iyer', 'Manager', 2], ['Divya Menon', 'Sales Executive', 2], ['Arjun Gowda', 'Delivery Executive', 2]];
const PRODUCTS = [   // name, brand, category, price, colour, image, sizes, description
  ['Classic White Tee', 'ABC Basics', 'Men', 499, 'White', 'classic-white', ALL, 'Everyday round-neck tee in soft combed cotton.'],
  ['Midnight Black Tee', 'ABC Basics', 'Men', 549, 'Black', 'midnight-black', ALL, 'A wardrobe must-have with a bold night-owl print.'],
  ['Navy Pocket Tee', 'Urban Thread', 'Men', 649, 'Navy', 'navy-pocket', ALL, 'Regular-fit tee with a chest pocket.'],
  ['Sunset Graphic Tee', 'Urban Thread', 'Men', 699, 'Orange', 'sunset-graphic', ALL, 'Bright sunset print for happy summer days.'],
  ['Retro Wave Tee', 'Pixel Wear', 'Men', 749, 'Purple', 'retro-wave', ALL, '80s retro-wave graphic, screen printed.'],
  ['Forest Trek Tee', 'Trail Co', 'Men', 699, 'Green', 'forest-trek', ALL, 'Made for trekkers - breathable and light.'],
  ['Code Mode ON Tee', 'Pixel Wear', 'Men', 799, 'Charcoal', 'code-mode', ALL, 'For developers who live in the terminal.'],
  ['Coffee First Tee', 'Brew Tees', 'Men', 599, 'Brown', 'coffee-first', ALL, 'But first, coffee.'],
  ['Ocean Breeze Tee', 'Wave Wear', 'Women', 599, 'Teal', 'ocean-breeze', ALL, 'Fresh teal tee with an ocean print.'],
  ['Oversized Cloud Tee', 'Cloud Nine', 'Oversized', 899, 'Grey', 'oversized-cloud', ALL, 'Drop-shoulder oversized fit, heavy cotton.'],
  ['Kids Rainbow Tee', 'Little Tees', 'Kids', 399, 'Yellow', 'kids-rainbow', ['S', 'M', 'L'], 'Soft and colourful tee for kids.'],
  ['Polo Sport Tee', 'Sport Club', 'Polo', 849, 'Red', 'polo-sport', ALL, 'Classic polo collar, pique cotton.'],
  ['Blush Crop Tee', 'Blush & Co', 'Women', 549, 'Pink', 'blush-crop', ALL, 'Cropped fit in a soft blush pink.']];

async function seedDemo(app, reset) {
  const { C, hashPw, buildLines, createOrder, nextStatus } = app, now = new Date();
  if (reset) for (const n of ['stores', 'employees', 'customers', 'addresses', 'categories', 'products', 'inventory', 'orders', 'payments', 'deliveries']) await C[n].deleteMany({});
  const stores = [];
  for (const [name, street, city, state, pincode, phone, email, openingHours] of STORES) stores.push({ _id: (await C.stores.insertOne({ name, street, city, state, pincode, phone, email, openingHours, managerId: null, createdAt: now })).insertedId, name, city });
  let n = 0;
  for (const [name, designation, si] of EMPS) {
    const id = (await C.employees.insertOne({ name, designation, storeId: stores[si]._id, email: name.toLowerCase().replace(' ', '.') + '@abctees.example', phone: '98' + String(10000000 + n * 1111111).slice(0, 8), salary: designation === 'Manager' ? 45000 : 22000, joinDate: new Date(2024, n % 12, 5) })).insertedId; n++;
    if (designation === 'Manager') await C.stores.updateOne({ _id: stores[si]._id }, { $set: { managerId: id } });
  }
  const cats = {}; for (const [nm, d] of [['Men', 'T-shirts for men'], ['Women', 'T-shirts for women'], ['Kids', 'T-shirts for kids'], ['Polo', 'Polo and collar tees'], ['Oversized', 'Relaxed-fit oversized tees']]) cats[nm] = (await C.categories.insertOne({ name: nm, description: d, createdAt: now })).insertedId;
  const prods = [];
  for (let i = 0; i < PRODUCTS.length; i++) {
    const [name, brand, cat, price, colour, img, sizes, description] = PRODUCTS[i];
    const p = { name, brand, description, price, colour, material: '100% Cotton', sizes, categoryId: cats[cat], image: `/img/tshirts/${img}.svg`, isActive: true, manualOutOfStock: name === 'Coffee First Tee', createdAt: new Date(now - (PRODUCTS.length - i) * 3600000) };
    p._id = (await C.products.insertOne(p)).insertedId; prods.push(p);
    const rows = [];
    stores.forEach((s, si) => sizes.forEach((size, zi) => {
      let qty = ((i * 7 + si * 5 + zi * 3) % 14) + 3;
      if (name === 'Code Mode ON Tee') qty = 0;                                    // finished everywhere -> shows "Out of Stock"
      if (name === 'Sunset Graphic Tee' && (size === 'XL' || size === 'XXL')) qty = 0;   // some sizes finished
      if (name === 'Midnight Black Tee' && si === 0 && size === 'M') qty = 2;      // low-stock alert
      rows.push({ storeId: s._id, productId: p._id, size, qty, reorderLevel: 5, updatedAt: now });
    }));
    await C.inventory.insertMany(rows);
  }
  const cust = { name: 'Demo Customer', email: 'demo@example.com', phone: '9876543210', passwordHash: hashPw('demo123'), createdAt: now }; cust._id = (await C.customers.insertOne(cust)).insertedId;
  const addr = { customerId: cust._id, label: 'Home', name: 'Demo Customer', phone: '9876543210', line: 'Flat 4B, Green Park Apartments, Saket', city: 'Delhi', state: 'Delhi', pincode: '110017', createdAt: now }; addr._id = (await C.addresses.insertOne(addr)).insertedId;
  const L = (a) => buildLines(a.map(([nm, size, qty]) => ({ productId: prods.find((p) => p.name === nm)._id, size, qty })));
  const o1 = await createOrder({ channel: 'ONLINE', mode: 'HOME_DELIVERY', customer: cust, store: stores[0], paymentMode: 'UPI', address: addr, lines: await L([['Classic White Tee', 'M', 2], ['Navy Pocket Tee', 'L', 1]]) });
  for (const st of ['CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED']) await nextStatus(await C.orders.findOne({ _id: o1._id }), st);
  await C.deliveries.updateOne({ orderId: o1._id }, { $set: { courier: 'BlueDart', trackingNo: 'BD482910377' } });
  const o2 = await createOrder({ channel: 'ONLINE', mode: 'STORE_PICKUP', customer: cust, store: stores[1], paymentMode: 'PAY_AT_STORE', lines: await L([['Ocean Breeze Tee', 'L', 1]]) });
  await nextStatus(o2, 'CONFIRMED');
  await createOrder({ channel: 'IN_STORE', mode: 'IN_STORE_PURCHASE', customer: null, store: stores[0], emp: await C.employees.findOne({ storeId: stores[0]._id, designation: 'Cashier' }), paymentMode: 'CASH', walkInName: 'Walk-in customer', lines: await L([['Retro Wave Tee', 'M', 1], ['Polo Sport Tee', 'L', 1]]) });
}
module.exports = { seedDemo };
