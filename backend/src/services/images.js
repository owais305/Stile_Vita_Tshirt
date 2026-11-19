'use strict';
// Saves the picture uploaded by the admin into backend/uploads (checks type, size and file signature).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { bad } = require('../utils/helpers');

function saveImage(url) {
  const T = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(url || ''); if (!m || !T[m[1]]) throw bad('Image must be a PNG, JPG, WEBP or GIF file');
  const b = Buffer.from(m[2], 'base64'); if (b.length > 2 * 1024 * 1024) throw bad('Image must be smaller than 2 MB');
  const ok = { 'image/png': () => b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'image/jpeg': () => b[0] === 0xff && b[1] === 0xd8, 'image/gif': () => b.slice(0, 4).toString() === 'GIF8', 'image/webp': () => b.slice(8, 12).toString() === 'WEBP' }[m[1]];
  if (!ok()) throw bad('The file is not a valid image');
  const dir = path.join(__dirname, '..', '..', 'uploads'); fs.mkdirSync(dir, { recursive: true });
  const name = crypto.randomBytes(8).toString('hex') + '.' + T[m[1]]; fs.writeFileSync(path.join(dir, name), b); return '/uploads/' + name;
}
const cleanImg = (p) => (typeof p === 'string' && /^\/(img|uploads)\/[\w.\-/]+$/.test(p) && !p.includes('..') ? p : '');

module.exports = { saveImage, cleanImg };
