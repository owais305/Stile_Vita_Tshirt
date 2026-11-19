'use strict';
// node test/serve-fake.js  -> runs the whole site on http://localhost:3100 with an IN-MEMORY database (demo data), for quick tries without MongoDB.
const Module = require('module'), path = require('path'), orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'mongodb' ? path.join(__dirname, 'fakeMongo.js') : orig.call(this, r, ...a); };
if (process.env.RAZORPAY_MOCK) {   // RAZORPAY_MOCK=1 -> fake Razorpay API (keys: rzp_test_KEYID / test_secret), to try the payment flow without internet
  process.env.RAZORPAY_KEY_ID = 'rzp_test_KEYID'; process.env.RAZORPAY_KEY_SECRET = 'test_secret'; let n = 0; const real = global.fetch;
  global.fetch = async (u, o = {}) => (String(u).startsWith('https://api.razorpay.com') ? { ok: true, status: 200, json: async () => ({ id: 'order_MOCK' + ++n, amount: JSON.parse(o.body || '{}').amount, currency: 'INR' }) } : real(u, o));
}
const { MongoClient } = require('mongodb'), app = require('../server');
(async () => { await app.initDb(new MongoClient(), 'demo'); await app.ensureAdmin(); await require('../src/seed/demoData').seedDemo(app, true); app.createServer().listen(process.env.PORT || 3100, () => console.log('Demo (in-memory DB) on http://localhost:' + (process.env.PORT || 3100))); })();
