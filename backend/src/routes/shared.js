'use strict';
// Route registry + helpers shared by all route files.
const { C } = require('../db');
const { HttpError, mustId } = require('../utils/helpers');

const routes = [];
const add = (m, p, a, b) => { const keys = []; const re = new RegExp('^' + p.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$'); routes.push({ m, re, keys, opts: b ? a : {}, fn: b || a }); };
const AD = { auth: 'admin' }, CU = { auth: 'customer' };
const pub = (u) => ({ _id: u._id, name: u.name, email: u.email, phone: u.phone });
const dup = (e, msg) => { if (e.code === 11000) throw new HttpError(409, msg); throw e; };
const own = async (u, id) => { const o = await C.orders.findOne({ _id: mustId(id, 'order'), customerId: u._id }); if (!o) throw new HttpError(404, 'Order not found'); return o; };

module.exports = { routes, add, AD, CU, pub, dup, own };
