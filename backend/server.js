'use strict';
// T-SHIRT STORE - backend entry point.   cd backend  ->  npm install  ->  npm start
const { MongoClient } = require('mongodb');
const { C, initDb } = require('./src/db');
const { createServer } = require('./src/app');
const { ensureAdmin } = require('./src/services/bootstrap');
const { sweepUnpaid, buildLines, createOrder, nextStatus } = require('./src/services/orders');
const { RZP, rzpOn } = require('./src/services/razorpay');
const { hashPw } = require('./src/utils/security');
const { toId } = require('./src/utils/helpers');

module.exports = { createServer, initDb, ensureAdmin, sweepUnpaid, C, hashPw, buildLines, createOrder, nextStatus, toId };

if (require.main === module) (async () => {
  const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017', PORT = Number(process.env.PORT) || 3000, DB = process.env.DB_NAME || 'tshirt_store';
  try { await initDb(new MongoClient(URI, { serverSelectionTimeoutMS: 5000 }), DB); }
  catch (e) { console.error('\nCould not connect to MongoDB at ' + URI + '\n-> Start MongoDB first (mongod / Compass / Atlas) or set MONGODB_URI.\n' + e.message); process.exit(1); }
  await ensureAdmin();
  setInterval(() => sweepUnpaid().catch(console.error), 5 * 60000).unref();
  console.log(rzpOn() ? 'Razorpay: ENABLED (key ' + RZP.id + ')' : 'Razorpay: not configured -> online payment is SIMULATED (see env.example)');
  if (!process.env.NO_AUTO_SEED && !(await C.products.countDocuments({})) && !(await C.stores.countDocuments({}))) { await require('./src/seed/demoData').seedDemo(module.exports); console.log('Demo data loaded (demo customer: demo@example.com / demo123).'); }
  createServer().listen(PORT, () => console.log(`T-shirt store running:\n  Shop (client): http://localhost:${PORT}/\n  Admin panel  : http://localhost:${PORT}/admin\n  Database     : ${DB} @ ${URI}`));
})();

