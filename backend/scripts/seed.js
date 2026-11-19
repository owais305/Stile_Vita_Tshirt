'use strict';
// npm run seed  -> wipes the shop data and loads fresh demo data
const { MongoClient } = require('mongodb');
const app = require('../server');
(async () => {
  const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017');
  await app.initDb(client, process.env.DB_NAME || 'tshirt_store'); await app.ensureAdmin();
  await require('../src/seed/demoData').seedDemo(app, true);
  console.log('Demo data loaded.  Customer: demo@example.com / demo123   Admin: admin / admin123'); await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
