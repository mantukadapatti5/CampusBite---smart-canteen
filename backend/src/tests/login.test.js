'use strict';
// Offline tests for everything that decides whether a login works. They replace
// the database and the npm packages (sequelize, bcryptjs, jsonwebtoken, dotenv)
// with tiny in-memory fakes, so they run with plain `node` - no Postgres needed.
//   npm run test:login
const Module = require('module');
const assert = require('assert');
const path = require('path');

const OP_AND = Symbol('and');
let ROWS = [];
const matchRow = (row, where) => {
  if (where && where.__lower) return String(row[where.col]).toLowerCase() === where.value;
  if (where && where[OP_AND]) return where[OP_AND].every((w) => matchRow(row, w));
  return Object.entries(where || {}).every(([k, v]) => row[k] === v);
};
const makeTable = (name) => {
  const rows = [];
  const withUpdate = (r) => Object.assign(r, { update: async (patch) => Object.assign(r, patch) });
  return {
    rows,
    findOne: async ({ where }) => rows.find((r) => matchRow(r, where)) || null,
    findByPk: async (id) => rows.find((r) => r.id === id) || null,
    count: async () => rows.length,
    create: async (d) => { const r = withUpdate({ id: rows.length + 1, ...d }); rows.push(r); return r; },
    bulkCreate: async (arr) => arr.map((d) => { const r = withUpdate({ id: rows.length + 1, ...d }); rows.push(r); return r; }),
  };
};
const models = { User: makeTable('User'), Category: makeTable('Category'), MenuItem: makeTable('MenuItem'), Coupon: makeTable('Coupon'), CanteenSettings: makeTable('CanteenSettings'), Announcement: makeTable('Announcement') };
const fakes = {
  sequelize: { Sequelize: { where: (f, value) => ({ __lower: true, col: f.col, value }), fn: (name, c) => ({ fn: name, col: c.col }), col: (c) => ({ col: c }) }, Op: { and: OP_AND } },
  bcryptjs: { hash: async (p) => 'h:' + p, compare: async (p, h) => h === 'h:' + p },
  jsonwebtoken: { sign: (payload, secret) => { if (!secret) throw new Error('secretOrPrivateKey must have a value'); return 'jwt.' + payload.role + '.' + payload.id; } },
  dotenv: { config: () => ({}) },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (fakes[request]) return fakes[request];
  if (/(^|\/)models$/.test(request)) return models;
  return origLoad.apply(this, arguments);
};

const results = [];
const test = async (title, fn) => { try { await fn(); results.push([true, title]); } catch (e) { results.push([false, title + ' -> ' + e.message]); } };
const call = async (handler, body) => { let out = { status: 200 }; await handler({ body }, { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } }); return out; };
const reset = () => Object.values(models).forEach((t) => { t.rows.length = 0; });

(async () => {
  delete process.env.JWT_SECRET;
  require('../config/env');
  const { ensureDemoData, DEMO_ACCOUNTS } = require('../seed/demoData');
  const auth = require('../controllers/authController');
  const run = (opts = {}) => ensureDemoData({ models, hash: fakes.bcryptjs.hash, compare: fakes.bcryptjs.compare, log: () => {}, ...opts });

  await test('env.js supplies a JWT_SECRET and DB defaults when .env is missing', () => {
    assert.ok(process.env.JWT_SECRET && process.env.DB_HOST && process.env.DB_NAME && process.env.PORT === '5000');
  });
  await test('empty database -> 7 demo accounts, 6 categories, 37 items, 2 coupons, settings, announcement', async () => {
    reset(); const r = await run();
    assert.strictEqual(models.User.rows.length, 7); assert.strictEqual(r.accounts_created, 7);
    assert.strictEqual(models.Category.rows.length, 6); assert.strictEqual(models.MenuItem.rows.length, 37);
    assert.strictEqual(models.Coupon.rows.length, 2); assert.strictEqual(models.CanteenSettings.rows.length, 1); assert.strictEqual(models.Announcement.rows.length, 1);
  });
  await test('running it again changes nothing (idempotent, never duplicates)', async () => {
    const r = await run(); assert.strictEqual(r.accounts_created, 0); assert.strictEqual(models.User.rows.length, 7); assert.strictEqual(models.MenuItem.rows.length, 37);
  });
  await test('all four portal roles are present among the demo accounts', () => {
    const roles = new Set(DEMO_ACCOUNTS.slice(0, 4).map((a) => a.role)); assert.deepStrictEqual([...roles].sort(), ['admin', 'canteen_staff', 'manager', 'student']);
  });
  for (const [usn, pw, role] of [['student1', 'STUDENT12', 'student'], ['kitchen1', 'KITCHEEN12', 'canteen_staff'], ['manager', 'MANAGER12', 'manager'], ['admin1', 'ADMIN12', 'admin']]) {
    await test(`login ${usn} (${role} portal) succeeds`, async () => {
      const r = await call(auth.login, { usn_or_id: usn, password: pw }); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.user.role, role); assert.ok(r.body.token);
    });
  }
  await test('login is case-insensitive (STUDENT1 / " Admin1 ")', async () => {
    assert.strictEqual((await call(auth.login, { usn_or_id: 'STUDENT1', password: 'STUDENT12' })).status, 200);
    assert.strictEqual((await call(auth.login, { usn_or_id: ' Admin1 ', password: 'ADMIN12' })).status, 200);
  });
  await test('an account stored in UPPER case still logs in', async () => {
    await models.User.create({ usn_or_id: 'KITCHEN9', password_hash: 'h:pw123456', role: 'canteen_staff', phone: '9000000009' });
    assert.strictEqual((await call(auth.login, { usn_or_id: 'kitchen9', password: 'pw123456' })).status, 200);
  });
  await test('wrong password / unknown user -> 401, missing fields -> 400', async () => {
    assert.strictEqual((await call(auth.login, { usn_or_id: 'student1', password: 'wrong' })).status, 401);
    assert.strictEqual((await call(auth.login, { usn_or_id: 'nobody', password: 'x' })).status, 401);
    assert.strictEqual((await call(auth.login, { usn_or_id: '', password: '' })).status, 400);
  });
  await test('broken demo password is NOT touched by default, but repaired with resetPasswords', async () => {
    const k = models.User.rows.find((u) => u.usn_or_id === 'kitchen1'); k.password_hash = 'h:something-else'; k.role = 'student';
    await run(); assert.strictEqual((await call(auth.login, { usn_or_id: 'kitchen1', password: 'KITCHEEN12' })).status, 401);
    const r = await run({ resetPasswords: true }); assert.strictEqual(r.accounts_repaired, 1);
    const ok = await call(auth.login, { usn_or_id: 'kitchen1', password: 'KITCHEEN12' }); assert.strictEqual(ok.status, 200); assert.strictEqual(ok.body.user.role, 'canteen_staff');
  });
  await test('a demo phone number already used by someone else is skipped, not a crash', async () => {
    reset(); await models.User.create({ usn_or_id: 'other', phone: '9900000001', password_hash: 'x', role: 'student' });
    const r = await run(); assert.strictEqual(r.accounts_skipped, 1); assert.strictEqual(r.accounts_created, 6);
  });

  let pass = 0; for (const [ok, t] of results) { if (ok) pass++; console.log((ok ? 'PASS  ' : 'FAIL  ') + t); }
  console.log(`\n${pass}/${results.length} login tests passed`); process.exit(pass === results.length ? 0 : 1);
})();
