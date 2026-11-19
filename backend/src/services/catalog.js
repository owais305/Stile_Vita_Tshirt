'use strict';
// Turns product documents into what the pages need (stock per size, in-stock flag, category).
const { C } = require('../db');

async function stockIndex() {
  const idx = new Map();
  for (const r of await C.inventory.find({}).toArray()) {
    const k = String(r.productId); if (!idx.has(k)) idx.set(k, { sizes: {}, stores: {} });
    const e = idx.get(k), q = Math.max(0, r.qty || 0);
    e.sizes[r.size] = (e.sizes[r.size] || 0) + q; (e.stores[String(r.storeId)] = e.stores[String(r.storeId)] || {})[r.size] = q;
  }
  return idx;
}
const catMap = async () => new Map((await C.categories.find({}).toArray()).map((c) => [String(c._id), { _id: c._id, name: c.name }]));
function decorate(p, idx, cats) {   // inStock = stock in some store AND admin has not pressed "Out of stock"
  const s = idx.get(String(p._id)) || { sizes: {} };
  const sizes = p.sizes.map((z) => ({ size: z, qty: s.sizes[z] || 0, inStock: !p.manualOutOfStock && (s.sizes[z] || 0) > 0 }));
  return { _id: p._id, name: p.name, brand: p.brand, description: p.description, price: p.price, colour: p.colour, material: p.material, image: p.image,
    category: cats.get(String(p.categoryId)) || null, categoryId: p.categoryId, isActive: p.isActive, manualOutOfStock: !!p.manualOutOfStock,
    sizes, sizeList: p.sizes, totalQty: sizes.reduce((a, x) => a + x.qty, 0), inStock: !p.manualOutOfStock && sizes.some((x) => x.qty > 0), createdAt: p.createdAt };
}

module.exports = { stockIndex, catMap, decorate };
