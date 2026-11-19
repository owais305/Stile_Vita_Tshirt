'use strict';
// MongoDB collections + indexes.

// ============================ database ============================
const C = {};
async function initDb(client, dbName) {
  await client.connect();
  const db = client.db(dbName);
  ['admins', 'customers', 'addresses', 'categories', 'products', 'stores', 'employees', 'inventory', 'orders', 'payments', 'deliveries'].forEach((n) => { C[n] = db.collection(n); });
  await C.admins.createIndex({ username: 1 }, { unique: true });
  await C.customers.createIndex({ email: 1 }, { unique: true });
  await C.categories.createIndex({ name: 1 }, { unique: true });
  await C.stores.createIndex({ name: 1 }, { unique: true });
  await C.employees.createIndex({ email: 1 }, { unique: true });
  await C.inventory.createIndex({ storeId: 1, productId: 1, size: 1 }, { unique: true });
  await C.orders.createIndex({ orderNo: 1 }, { unique: true });
  await C.orders.createIndex({ customerId: 1, createdAt: -1 });
}

module.exports = { C, initDb };
