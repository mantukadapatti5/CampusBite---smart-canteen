'use strict';
// Offline tests for the payment system: wallet + UPI QR checkout, "no payment -> no order",
// failed / expired / cancelled payments, refunds, wallet top-up and the manager analytics.
// The database is replaced by a small in-memory fake that supports transactions with real
// rollback, so atomicity is tested too.     npm run test:payments
const Module = require('module');
const assert = require('assert');

const OP = { in: Symbol('in'), lt: Symbol('lt'), gte: Symbol('gte'), lte: Symbol('lte'), ne: Symbol('ne'), between: Symbol('between'), iLike: Symbol('iLike'), or: Symbol('or'), and: Symbol('and'), notIn: Symbol('notIn') };
const store = {}; const EMITS = [];
let seq = 0;
function matches(row, where = {}) {
  return Reflect.ownKeys(where).every((k) => {
    const v = where[k];
    if (k === OP.or) return v.some((w) => matches(row, w));
    if (k === OP.and) return v.every((w) => matches(row, w));
    if (typeof k === 'string' && k.startsWith('$')) return true; // joined-column search not modelled
    const x = row[k];
    if (Array.isArray(v)) return v.includes(x);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      return Reflect.ownKeys(v).every((op) => {
        const a = v[op];
        if (op === OP.in) return a.includes(x); if (op === OP.notIn) return !a.includes(x);
        if (op === OP.lt) return x != null && x < a; if (op === OP.gte) return x >= a; if (op === OP.lte) return x <= a;
        if (op === OP.ne) return x !== a; if (op === OP.between) return x >= a[0] && x <= a[1];
        return true;
      });
    }
    return x === v;
  });
}
function makeModel(name, defaults = () => ({})) {
  const rows = (store[name] = []);
  class Row {
    constructor(d) { Object.assign(this, defaults(), d); }
    async update(p) { Object.assign(this, p); return this; }
    async increment(f, { by = 1 } = {}) { this[f] = Number(this[f] || 0) + by; return this; }
    async decrement(f, { by = 1 } = {}) { this[f] = Number(this[f] || 0) - by; return this; }
    async reload() { return this; }
    toJSON() { return { ...this }; }
  }
  const M = {
    name, rows,
    async create(d) { const r = new Row({ id: ++seq, created_at: new Date(), updated_at: new Date(), ...d }); if (name === 'Transaction') { Object.defineProperty(r, 'user', { get: () => store.User.find((u) => u.id === r.user_id), enumerable: false }); Object.defineProperty(r, 'order', { get: () => store.Order.find((o) => o.id === r.order_id), enumerable: false }); } rows.push(r); return r; },
    async bulkCreate(a) { return Promise.all(a.map((d) => M.create(d))); },
    async findByPk(id) { return rows.find((r) => r.id === Number(id)) || null; },
    async findOne({ where } = {}) { return rows.find((r) => matches(r, where)) || null; },
    async findAll({ where } = {}) { return rows.filter((r) => matches(r, where)); },
    async findAndCountAll({ where, limit = 1e9, offset = 0 } = {}) { const all = rows.filter((r) => matches(r, where)).sort((a, b) => b.created_at - a.created_at || b.id - a.id); return { rows: all.slice(offset, offset + limit), count: all.length }; },
    async count() { return rows.length; },
    async sum(f) { return rows.reduce((s, r) => s + Number(r[f] || 0), 0); },
    async update(values, { where } = {}) { rows.filter((r) => matches(r, where)).forEach((r) => Object.assign(r, values)); },
    async destroy() {},
  };
  return M;
}
const models = {
  User: makeModel('User', () => ({ wallet_balance: 0, reward_points: 0 })), MenuItem: makeModel('MenuItem'), Coupon: makeModel('Coupon'),
  CanteenSettings: makeModel('CanteenSettings'), Order: makeModel('Order'), OrderItem: makeModel('OrderItem'), PickupSlot: makeModel('PickupSlot'),
  Feedback: makeModel('Feedback'), Transaction: makeModel('Transaction'),
};
models.sequelize = {
  async transaction() {
    const snap = Object.entries(store).map(([n, rows]) => [n, rows.map((r) => [r, { ...r }])]);
    return {
      LOCK: { UPDATE: 'UPDATE' },
      async commit() {},
      async rollback() { for (const [n, saved] of snap) { store[n].length = 0; for (const [r, data] of saved) { for (const k of Object.keys(r)) delete r[k]; Object.assign(r, data); store[n].push(r); } } },
    };
  },
};
const fakes = {
  qrcode: { toDataURL: async (text) => `data:image/png;base64,QR(${text})` },
  pdfkit: function PDF() {},
  sequelize: { Op: OP, Sequelize: { where: () => ({}), fn: () => ({}), col: () => ({}) }, QueryTypes: {} },
};
const io = { emitNewOrder: (o) => EMITS.push(['new', o.id]), emitOrderStatusChanged: () => {}, emitQueueChanged: () => EMITS.push(['queue']), emitPaymentUpdate: (u, p) => EMITS.push(['pay', u, p.status || p.kind]) };
const orig = Module._load;
Module._load = function (req) {
  if (fakes[req]) return fakes[req];
  if (/(^|\/)models$/.test(req)) return models;
  if (/websocket\/io$/.test(req)) return io;
  if (/pickupSlotService$/.test(req)) return { assignNextAvailableSlot: async () => ({ id: 1 }), getQueueStatus: async () => ({}) };
  if (/waitTimeEstimator$/.test(req)) return { estimateWaitMinutes: async () => 5 };
  return orig.apply(this, arguments);
};
process.env.APP_TZ = 'Asia/Kolkata';
const svc = require('../services/paymentService');
const { parseRange } = require('../utils/dateRange');
const pay = require('../controllers/paymentController');
const orderCtl = require('../controllers/orderController');
const tx = require('../controllers/transactionController');

const results = [];
const test = async (t, fn) => { try { await fn(); results.push([true, t]); } catch (e) { results.push([false, `${t} -> ${e.message}`]); } };
const res = () => { const r = { status: 200, body: null, headers: {} }; return Object.assign(r, { status_(c) { r.status = c; return r; } }); };
const mk = () => { const r = { code: 200, body: null, headers: {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, send(b) { r.body = b; return r; }, setHeader(k, v) { r.headers[k] = v; } }; return r; };
const call = async (fn, req) => { const r = mk(); await fn({ params: {}, query: {}, body: {}, ...req }, r); return r; };
const student = () => ({ id: 1, role: 'student' });
const reset = () => {
  Object.values(store).forEach((rows) => { rows.length = 0; }); EMITS.length = 0;
  return Promise.all([
    models.User.create({ id: 1, name: 'Asha', usn_or_id: 'student1', role: 'student', wallet_balance: 200, reward_points: 0 }),
    models.User.create({ id: 2, name: 'Kitchen', usn_or_id: 'kitchen1', role: 'canteen_staff' }),
    models.MenuItem.create({ id: 101, name: 'Masala Dosa', price: 40, stock_quantity: 10, is_available: true }),
    models.MenuItem.create({ id: 102, name: 'Filter Coffee', price: 15, stock_quantity: 5, is_available: true }),
    models.CanteenSettings.create({ id: 1, tax_percent: 5 }),
  ]).then(() => { models.User.rows.forEach((u, i) => { u.id = i + 1; }); models.MenuItem.rows[0].id = 101; models.MenuItem.rows[1].id = 102; models.CanteenSettings.rows[0].id = 1; });
};
const dosa = (q = 1) => [{ menu_item_id: 101, quantity: q }];
const user = () => models.User.rows.find((u) => u.id === 1);
const dosaStock = () => models.MenuItem.rows.find((m) => m.id === 101).stock_quantity;
const txns = (f = () => true) => models.Transaction.rows.filter(f);

(async () => {
  // ------------------------------------------------ pure helpers
  await test('transaction ids look like TXN261030K7QX2M and are unique', () => {
    const a = svc.makeTxnRef(new Date('2026-10-30T10:00:00Z')); assert.match(a, /^TXN261030[A-Z2-9]{6}$/); assert.notStrictEqual(a, svc.makeTxnRef());
  });
  await test('UPI reference is 12 digits; pay token is 36 hex chars', () => { assert.match(svc.makeUtr(), /^\d{12}$/); assert.match(svc.makePayToken(), /^[a-f0-9]{36}$/); });
  await test('QR link only accepts http(s) origins', () => {
    assert.strictEqual(svc.buildPayUrl('http://192.168.1.5:4173', 'abc'), 'http://192.168.1.5:4173/pay/abc');
    assert.strictEqual(svc.buildPayUrl('javascript:alert(1)', 'abc'), 'http://localhost:4173/pay/abc');
  });
  await test('top-up amount must be a whole number between 10 and 5000', () => {
    for (const bad of [5, 5001, 10.5, 'abc', -20, null]) assert.strictEqual(svc.validateTopupAmount(bad).ok, false, String(bad));
    assert.strictEqual(svc.validateTopupAmount('250').amount, 250);
  });
  await test('date range uses the canteen time zone (IST day starts 18:30 UTC the day before)', () => {
    const r = parseRange({ from: '2026-10-01', to: '2026-10-03' }); assert.strictEqual(r.start.toISOString(), '2026-09-30T18:30:00.000Z'); assert.strictEqual(r.end.toISOString(), '2026-10-03T18:29:59.999Z');
  });
  await test('manager summary maths (money in/out, revenue, refunds, failures, success rate)', () => {
    const d = new Date('2026-10-30T08:00:00Z'); const R = (o) => ({ created_at: d, paid_at: d, ...o });
    const s = svc.buildSummary([
      R({ type: 'order_payment', method: 'upi', amount: 100, status: 'success' }), R({ type: 'order_payment', method: 'wallet', amount: 50, status: 'success' }),
      R({ type: 'order_payment', method: 'cash', amount: 40, status: 'success' }), R({ type: 'wallet_topup', method: 'upi', amount: 200, status: 'success' }),
      R({ type: 'refund', method: 'wallet', amount: 50, status: 'success' }), R({ type: 'order_payment', method: 'upi', amount: 70, status: 'failed', failure_reason: 'Declined' }),
      R({ type: 'wallet_topup', method: 'upi', amount: 100, status: 'expired' }), R({ type: 'order_payment', method: 'upi', amount: 30, status: 'pending' }),
    ], { from: '2026-10-30', to: '2026-10-30', walletLiability: 123.5 });
    const t = s.totals;
    assert.strictEqual(t.money_in, 340); assert.strictEqual(t.order_revenue, 190); assert.strictEqual(t.refunds, 50); assert.strictEqual(t.net_revenue, 140);
    assert.strictEqual(t.failed_count, 2); assert.strictEqual(t.pending_count, 1); assert.strictEqual(t.success_rate, 66.7); assert.strictEqual(t.wallet_liability, 123.5);
    assert.strictEqual(t.avg_order_value, 63.33); assert.strictEqual(s.daily.length, 1); assert.strictEqual(s.daily[0].orders_count, 3);
  });
  await test('CSV export escapes commas and quotes', () => {
    const csv = svc.toCsv([{ txn_ref: 'T1', created_at: new Date(0), customer_name: 'A, "B"', customer_id: 'x', type: 'order_payment', method: 'upi', direction: 'in', amount: 5, status: 'success' }]);
    assert.ok(csv.includes('"A, ""B"""') && csv.startsWith('Transaction ID,'));
  });

  // ------------------------------------------------ wallet checkout
  await reset();
  await test('quote shows tax: 2 dosas = 80 + 5% = 84', async () => {
    const r = await call(pay.quote, { body: { items: dosa(2) }, user: student() }); assert.strictEqual(r.code, 200); assert.strictEqual(r.body.subtotal, 80); assert.strictEqual(r.body.tax, 4); assert.strictEqual(r.body.total, 84);
  });
  await test('wallet payment: order created, wallet debited, ledger row written, stock reduced', async () => {
    const r = await call(pay.checkout, { body: { items: dosa(2), method: 'wallet' }, user: student() });
    assert.strictEqual(r.code, 201, JSON.stringify(r.body)); assert.strictEqual(r.body.payment_status, 'paid'); assert.strictEqual(Number(user().wallet_balance), 116);
    const t = txns()[0]; assert.strictEqual(t.method, 'wallet'); assert.strictEqual(t.status, 'success'); assert.strictEqual(Number(t.amount), 84); assert.strictEqual(Number(t.wallet_balance_after), 116); assert.ok(t.order_id);
    assert.strictEqual(dosaStock(), 8); assert.strictEqual(models.Order.rows.length, 1);
  });
  await test('insufficient wallet: HTTP 402, NO order, wallet and stock untouched, failed payment logged', async () => {
    user().wallet_balance = 10; const stock = dosaStock(); const orders = models.Order.rows.length;
    const r = await call(pay.checkout, { body: { items: dosa(1), method: 'wallet' }, user: student() });
    assert.strictEqual(r.code, 402); assert.strictEqual(r.body.code, 'INSUFFICIENT_WALLET'); assert.strictEqual(models.Order.rows.length, orders); assert.strictEqual(Number(user().wallet_balance), 10); assert.strictEqual(dosaStock(), stock);
    const f = txns((t) => t.status === 'failed').pop(); assert.ok(f && /Insufficient/.test(f.failure_reason) && !f.order_id);
  });
  await test('cash / missing payment method from a student is rejected (no unpaid orders)', async () => {
    for (const m of [undefined, 'cash', 'later']) { const r = await call(pay.checkout, { body: { items: dosa(1), method: m }, user: student() }); assert.strictEqual(r.code, 400, String(m)); }
    assert.strictEqual(models.Order.rows.length, 1);
  });
  await test('bad quantities (0, -3, 1.5) are rejected before any payment', async () => {
    user().wallet_balance = 500;
    for (const q of [0, -3, 1.5]) { const r = await call(pay.checkout, { body: { items: dosa(q), method: 'wallet' }, user: student() }); assert.strictEqual(r.code, 400, String(q)); }
    assert.strictEqual(Number(user().wallet_balance), 500);
  });

  await test('defence in depth: an order cannot be built as "UPI" or "cash" without a confirmed payment', async () => {
    const t = await models.sequelize.transaction();
    for (const m of ['upi_demo', 'cash', undefined]) {
      await assert.rejects(() => orderCtl.buildOrder({ userId: 1, items: dosa(1), payment_method: m }, t), (e) => e.code === 'PAYMENT_REQUIRED', String(m));
    }
    assert.strictEqual(models.Order.rows.length, 1);
  });

  // ------------------------------------------------ UPI QR flow
  await reset();
  const start = async (items = dosa(1)) => (await call(pay.checkout, { body: { items, method: 'upi', return_origin: 'http://192.168.1.9:4173' }, user: student() })).body.payment;
  await test('UPI checkout returns a pending QR session and creates NO order yet', async () => {
    const r = await call(pay.checkout, { body: { items: dosa(1), method: 'upi', return_origin: 'http://192.168.1.9:4173' }, user: student() });
    assert.strictEqual(r.code, 202); const p = r.body.payment; assert.strictEqual(p.status, 'pending'); assert.strictEqual(p.amount, 42); assert.ok(p.qr_data_url.startsWith('data:image/png'));
    assert.ok(p.pay_url.startsWith('http://192.168.1.9:4173/pay/')); assert.strictEqual(models.Order.rows.length, 0); assert.strictEqual(dosaStock(), 10);
  });
  await test('paying the QR creates the order, stores the UPI reference and links the ledger row', async () => {
    const p = txns()[0]; const r = await call(pay.gatewayConfirm, { params: { token: p.pay_token } });
    assert.strictEqual(r.body.status, 'success'); assert.match(r.body.upi_ref, /^\d{12}$/); assert.ok(r.body.order_id && r.body.order_token);
    assert.strictEqual(models.Order.rows.length, 1); assert.strictEqual(models.Order.rows[0].payment_status, 'paid'); assert.strictEqual(models.Order.rows[0].payment_method, 'upi_demo'); assert.strictEqual(dosaStock(), 9);
    assert.strictEqual(Number(user().wallet_balance), 200); assert.ok(EMITS.some((e) => e[0] === 'pay' && e[2] === 'success'));
  });
  await test('confirming the same QR twice does NOT create a second order', async () => {
    const p = txns()[0]; await call(pay.gatewayConfirm, { params: { token: p.pay_token } }); assert.strictEqual(models.Order.rows.length, 1); assert.strictEqual(dosaStock(), 9);
  });
  await test('payment failed / declined -> status failed, NO order, nothing charged', async () => {
    const p = await start(); const t = txns().find((x) => x.id === p.id);
    const r = await call(pay.gatewayFail, { params: { token: t.pay_token }, body: { reason: 'Bank server down' } });
    assert.strictEqual(r.body.status, 'failed'); assert.ok(/Bank server down/.test(r.body.failure_reason)); assert.strictEqual(models.Order.rows.length, 1);
    const late = await call(pay.gatewayConfirm, { params: { token: t.pay_token } }); assert.strictEqual(late.body.status, 'failed'); assert.strictEqual(models.Order.rows.length, 1);
  });
  await test('student cancels the QR payment -> cancelled, no order', async () => {
    const p = await start(); const r = await call(pay.cancelPayment, { params: { id: p.id }, user: student() });
    assert.strictEqual(r.body.status, 'cancelled'); assert.strictEqual(models.Order.rows.length, 1);
  });
  await test('expired QR cannot be paid -> expired, NO order', async () => {
    const p = await start(); const t = txns().find((x) => x.id === p.id); t.expires_at = new Date(Date.now() - 1000);
    const r = await call(pay.gatewayConfirm, { params: { token: t.pay_token } }); assert.strictEqual(r.body.status, 'expired'); assert.strictEqual(models.Order.rows.length, 1);
  });
  await test('item sells out while the student is paying -> payment fails with a reason, no order, no charge', async () => {
    const p = await start(dosa(2)); models.MenuItem.rows.find((m) => m.id === 101).stock_quantity = 1;
    const t = txns().find((x) => x.id === p.id); const r = await call(pay.gatewayConfirm, { params: { token: t.pay_token } });
    assert.strictEqual(r.body.status, 'failed'); assert.ok(/Only 1 of Masala Dosa left/.test(r.body.failure_reason)); assert.strictEqual(models.Order.rows.length, 1);
  });
  await test('price changes while paying -> payment not taken (no surprise charge)', async () => {
    models.MenuItem.rows.find((m) => m.id === 101).stock_quantity = 10; const p = await start(); models.MenuItem.rows.find((m) => m.id === 101).price = 50;
    const t = txns().find((x) => x.id === p.id); const r = await call(pay.gatewayConfirm, { params: { token: t.pay_token } });
    assert.strictEqual(r.body.status, 'failed'); assert.ok(/Prices or discounts changed/.test(r.body.failure_reason)); assert.strictEqual(models.Order.rows.length, 1);
  });
  await test('only the owner can read or cancel a payment session', async () => {
    const p = await start(); const other = { id: 99, role: 'student' };
    assert.strictEqual((await call(pay.getPayment, { params: { id: p.id }, user: other })).code, 404); assert.strictEqual((await call(pay.cancelPayment, { params: { id: p.id }, user: other })).code, 404);
  });
  await test('an unknown pay token is rejected (404)', async () => { assert.strictEqual((await call(pay.gatewayConfirm, { params: { token: 'nope' } })).code, 404); });
  await test('public gateway never exposes cart items or other users’ data', async () => {
    const p = await start(); const t = txns().find((x) => x.id === p.id); const r = await call(pay.gatewayInfo, { params: { token: t.pay_token } });
    const s = JSON.stringify(r.body); assert.ok(!/items|user_id|payload|pay_token/.test(s), s);
  });

  // ------------------------------------------------ wallet top-up by QR
  await reset();
  await test('top-up needs a valid amount, credits the wallet only after the QR is paid', async () => {
    assert.strictEqual((await call(pay.topup, { body: { amount: 5 }, user: student() })).code, 400);
    const r = await call(pay.topup, { body: { amount: 300, return_origin: 'http://localhost:4173' }, user: student() }); assert.strictEqual(r.code, 202); assert.strictEqual(Number(user().wallet_balance), 200);
    const t = txns()[0]; const c = await call(pay.gatewayConfirm, { params: { token: t.pay_token } });
    assert.strictEqual(c.body.status, 'success'); assert.strictEqual(Number(user().wallet_balance), 500); assert.strictEqual(Number(c.body.wallet_balance_after), 500); assert.strictEqual(t.type, 'wallet_topup');
  });
  await test('a failed top-up leaves the wallet unchanged', async () => {
    const r = await call(pay.topup, { body: { amount: 100 }, user: student() }); const t = txns().find((x) => x.id === r.body.payment.id);
    await call(pay.gatewayFail, { params: { token: t.pay_token } }); assert.strictEqual(Number(user().wallet_balance), 500); assert.strictEqual(t.status, 'failed');
  });

  // ------------------------------------------------ refunds
  await reset();
  const place = async (m) => { user().wallet_balance = 500; if (m === 'wallet') return (await call(pay.checkout, { body: { items: dosa(2), method: 'wallet' }, user: student() })).body; const p = await start(dosa(2)); const t = txns().find((x) => x.id === p.id); await call(pay.gatewayConfirm, { params: { token: t.pay_token } }); return { id: t.order_id }; };
  await test('cancelling a wallet-paid order refunds the wallet, restocks, and writes a refund row', async () => {
    const o = await place('wallet'); const bal = Number(user().wallet_balance);
    const r = await call(orderCtl.updateStatus, { params: { id: o.id }, body: { status: 'cancelled' }, user: { id: 2, role: 'canteen_staff' } });
    assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(Number(user().wallet_balance), bal + 84); assert.strictEqual(models.Order.rows.find((x) => x.id === o.id).payment_status, 'refunded');
    const rf = txns((t) => t.type === 'refund').pop(); assert.strictEqual(rf.method, 'wallet'); assert.strictEqual(Number(rf.amount), 84); assert.strictEqual(rf.direction, 'out'); assert.strictEqual(dosaStock(), 10);
  });
  await test('cancelling a UPI-paid order refunds to the wallet too', async () => {
    const o = await place('upi'); const bal = Number(user().wallet_balance);
    await call(orderCtl.updateStatus, { params: { id: o.id }, body: { status: 'rejected' }, user: { id: 2, role: 'canteen_staff' } });
    assert.strictEqual(Number(user().wallet_balance), bal + 84); assert.strictEqual(txns((t) => t.type === 'refund').length, 2);
  });
  await test('a cancelled order is refunded only once', async () => {
    const o = models.Order.rows[0]; const before = txns((t) => t.type === 'refund').length;
    const r = await call(orderCtl.updateStatus, { params: { id: o.id }, body: { status: 'cancelled' }, user: { id: 2, role: 'canteen_staff' } });
    assert.strictEqual(r.code, 400); assert.strictEqual(txns((t) => t.type === 'refund').length, before);
  });
  await test('walk-in cash order: recorded as a paid cash transaction; cancelling refunds cash, not a wallet', async () => {
    const r = await call(orderCtl.manualOrder, { body: { items: dosa(1), walk_in_name: 'Ravi' }, user: { id: 2, role: 'canteen_staff' } });
    assert.strictEqual(r.code, 201, JSON.stringify(r.body)); const t = txns((x) => x.method === 'cash' && x.type === 'order_payment')[0]; assert.strictEqual(t.status, 'success'); assert.strictEqual(Number(t.amount), 42);
    const staffBal = Number(models.User.rows.find((u) => u.id === 2).wallet_balance || 0);
    await call(orderCtl.updateStatus, { params: { id: t.order_id }, body: { status: 'cancelled' }, user: { id: 2, role: 'canteen_staff' } });
    const rf = txns((x) => x.type === 'refund' && x.method === 'cash')[0]; assert.ok(rf); assert.strictEqual(Number(models.User.rows.find((u) => u.id === 2).wallet_balance || 0), staffBal);
  });
  await test('a wallet payment that fails midway is rolled back completely (atomic)', async () => {
    user().wallet_balance = 500; const stock = dosaStock(); const orig = models.OrderItem.create; models.OrderItem.create = async () => { throw new Error('disk full'); };
    const r = await call(pay.checkout, { body: { items: dosa(1), method: 'wallet' }, user: student() }); models.OrderItem.create = orig;
    assert.strictEqual(r.code, 400); assert.strictEqual(Number(user().wallet_balance), 500); assert.strictEqual(dosaStock(), stock);
  });

  // ------------------------------------------------ ledger views
  await reset();
  await call(pay.checkout, { body: { items: dosa(1), method: 'wallet' }, user: student() });
  const p2 = await start(); await call(pay.gatewayFail, { params: { token: txns().find((x) => x.id === p2.id).pay_token } });
  await test('student sees only their own transactions, without secrets', async () => {
    const mine = await call(tx.mine, { user: student(), query: {} }); assert.strictEqual(mine.body.total, 2); assert.ok(!JSON.stringify(mine.body).match(/pay_token|payload|qr_data_url/));
    const none = await call(tx.mine, { user: { id: 77, role: 'student' }, query: {} }); assert.strictEqual(none.body.total, 0);
  });
  await test('filters: type, status and pagination', async () => {
    assert.strictEqual((await call(tx.mine, { user: student(), query: { status: 'failed' } })).body.total, 1);
    assert.strictEqual((await call(tx.mine, { user: student(), query: { limit: '1', page: '2' } })).body.rows.length, 1);
  });
  await test('manager summary reflects wallet payment, failed attempt and wallet liability', async () => {
    const r = await call(tx.summary, { user: { id: 9, role: 'manager' }, query: {} }); const t = r.body.totals;
    assert.strictEqual(t.order_revenue, 42); assert.strictEqual(t.failed_count, 1); assert.strictEqual(t.wallet_orders, 42); assert.strictEqual(t.money_in, 0); assert.strictEqual(t.wallet_liability, 158);
  });
  await test('manager CSV export has a header, a UTF-8 BOM and one line per transaction', async () => {
    const r = await call(tx.exportCsv, { user: { id: 9, role: 'manager' }, query: {} }); assert.ok(r.body.startsWith('\uFEFFTransaction ID')); assert.strictEqual(r.body.trim().split('\r\n').length, 3); assert.match(r.headers['Content-Disposition'], /attachment; filename="transactions-/);
  });
  await test('a student cannot open someone else’s transaction; the owner and the manager can', async () => {
    const id = txns()[0].id;
    assert.strictEqual((await call(tx.getOne, { params: { id }, user: { id: 55, role: 'student' } })).code, 403);
    assert.strictEqual((await call(tx.getOne, { params: { id }, user: student() })).code, 200); assert.strictEqual((await call(tx.getOne, { params: { id }, user: { id: 9, role: 'manager' } })).code, 200);
  });

  let pass = 0; for (const [ok, t] of results) { if (ok) pass++; console.log((ok ? 'PASS  ' : 'FAIL  ') + t); }
  console.log(`\n${pass}/${results.length} payment tests passed`); process.exit(pass === results.length ? 0 : 1);
})();
