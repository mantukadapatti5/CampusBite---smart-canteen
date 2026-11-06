'use strict';
// Offline tests for the manager "Sales & Orders" feature (who ordered which food, token, amount,
// and the day / week / month / year analysis).  No database needed.     npm run test:sales
const Module = require('module');
const assert = require('assert');
process.env.APP_TZ = 'Asia/Kolkata';

// ---- fake DB for the controller tests ----
const ORDERS = [];
let lastFind = null;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'sequelize') return { Op: { between: Symbol('between') } };
  if (request === '../models') {
    const M = (name) => ({ name });
    return { Order: { async findAll(opts) { lastFind = opts; return ORDERS; } }, OrderItem: M('OrderItem'), MenuItem: M('MenuItem'), Category: M('Category'), User: M('User'), PickupSlot: M('PickupSlot') };
  }
  return origLoad.apply(this, arguments);
};
const svc = require('../services/salesService');
const ctrl = require('../controllers/salesController');

let n = 0;
function order(id, iso, o = {}) {
  return {
    id, token_number: o.token || `T-${100 + id}`, created_at: new Date(iso), status: o.status || 'collected',
    payment_status: o.pay || 'paid', payment_method: o.method || 'wallet', user_id: o.uid ?? 1,
    user: o.user === undefined ? { id: o.uid ?? 1, name: 'Asha', usn_or_id: '1ab21cs001' } : o.user,
    subtotal_amount: o.sub ?? 60, discount_amount: o.disc ?? 0, tax_amount: o.tax ?? 0, total_amount: o.total ?? 60,
    is_manual_entry: !!o.walk, walk_in_name: o.walkName, coupon_code: o.coupon,
    items: o.items || [{ menu_item_id: 1, quantity: 2, price_at_order: 30, menuItem: { id: 1, name: 'Bread Omelette', category: { name: 'Breakfast' } } }],
  };
}
function res() { return { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; } }; }
async function test(name, fn) { try { await fn(); n++; console.log('  ok  -', name); } catch (e) { console.error('FAIL  -', name, '\n', e); process.exitCode = 1; } }

(async () => {
  const omelette = [{ menu_item_id: 1, quantity: 2, price_at_order: 30, menuItem: { id: 1, name: 'Bread Omelette', category: { name: 'Breakfast' } } }];
  const tea = [{ menu_item_id: 2, quantity: 1, price_at_order: 10, menuItem: { id: 2, name: 'Tea', category: { name: 'Drinks' } } }];

  await test('normalizeOrder shows student, food, quantity, amount and token', () => {
    const r = svc.normalizeOrder(order(1, '2026-11-05T05:00:00Z', { items: omelette }));
    assert.strictEqual(r.token_number, 'T-101');
    assert.strictEqual(r.customer_name, 'Asha');
    assert.strictEqual(r.customer_id, '1ab21cs001');
    assert.deepStrictEqual([r.items[0].name, r.items[0].quantity, r.items[0].line_total], ['Bread Omelette', 2, 60]);
    assert.strictEqual(r.items_text, 'Bread Omelette x2');
    assert.strictEqual(r.is_sale, true);
  });

  await test('day is computed in the canteen time zone (late evening UTC = next day IST)', () => {
    const r = svc.normalizeOrder(order(1, '2026-11-05T19:00:00Z'));
    assert.strictEqual(r.day, '2026-11-06');
    assert.strictEqual(r.hour, 0);
  });

  await test('walk-in, deleted item and unpaid / cancelled orders are handled', () => {
    const w = svc.normalizeOrder(order(2, '2026-11-05T05:00:00Z', { walk: true, walkName: 'Ravi', uid: null, user: null }));
    assert.strictEqual(w.customer_name, 'Walk-in: Ravi');
    assert.strictEqual(w.customer_id, 'walk-in');
    const d = svc.normalizeOrder(order(3, '2026-11-05T05:00:00Z', { items: [{ menu_item_id: 9, quantity: 1, price_at_order: 5, menuItem: null }] }));
    assert.strictEqual(d.items[0].name, 'Deleted item #9');
    assert.strictEqual(svc.isSale({ payment_status: 'paid', status: 'cancelled' }), false);
    assert.strictEqual(svc.isSale({ payment_status: 'pending', status: 'pending' }), false);
    assert.strictEqual(svc.isSale({ payment_status: 'paid', status: 'preparing' }), true);
  });

  const rows = [
    order(1, '2026-11-02T05:00:00Z', { items: omelette, total: 60 }),                       // Mon 2 Nov, 10:30
    order(2, '2026-11-02T06:00:00Z', { items: tea, sub: 10, total: 10, uid: 2, user: { id: 2, name: 'Bala', usn_or_id: '1ab21cs002' }, method: 'cash' }),
    order(3, '2026-11-05T05:00:00Z', { items: omelette, total: 60 }),                       // Thu 5 Nov
    order(4, '2026-10-20T05:00:00Z', { items: tea, sub: 10, total: 10 }),                   // October
    order(5, '2026-11-05T06:00:00Z', { items: omelette, status: 'cancelled', total: 60 }),  // refunded
    order(6, '2026-11-05T07:00:00Z', { items: omelette, pay: 'pending', status: 'pending', total: 60 }),
  ].map((o) => svc.normalizeOrder(o));

  await test('summary totals count only paid, non-cancelled orders', () => {
    const s = svc.buildSummary(rows, { from: '2026-10-01', to: '2026-11-06', group: 'month' });
    assert.strictEqual(s.totals.orders, 4);
    assert.strictEqual(s.totals.revenue, 140);
    assert.strictEqual(s.totals.items_sold, 6);
    assert.strictEqual(s.totals.cancelled_orders, 1);
    assert.strictEqual(s.totals.cancelled_amount, 60);
    assert.strictEqual(s.totals.avg_order_value, 35);
    assert.strictEqual(s.totals.unique_customers, 2);
  });

  await test('month grouping zero-fills and sums per month', () => {
    const s = svc.buildSummary(rows, { from: '2026-09-15', to: '2026-11-06', group: 'month' });
    assert.deepStrictEqual(s.periods.map((p) => p.key), ['2026-09', '2026-10', '2026-11']);
    assert.deepStrictEqual(s.periods.map((p) => p.revenue), [0, 10, 130]);
  });

  await test('day, week and year grouping', () => {
    const d = svc.buildSummary(rows.filter((r) => r.day >= '2026-11-01'), { from: '2026-11-01', to: '2026-11-06', group: 'day' });
    assert.strictEqual(d.periods.length, 6);
    assert.strictEqual(d.periods.find((p) => p.key === '2026-11-02').revenue, 70);
    const w = svc.buildSummary(rows, { from: '2026-10-19', to: '2026-11-06', group: 'week' });
    assert.deepStrictEqual(w.periods.map((p) => p.key), ['2026-10-19', '2026-10-26', '2026-11-02']);
    assert.deepStrictEqual(w.periods.map((p) => p.revenue), [10, 0, 130]);
    const y = svc.buildSummary(rows, { from: '2026-01-01', to: '2026-11-06', group: 'year' });
    assert.deepStrictEqual(y.periods.map((p) => [p.key, p.revenue]), [['2026', 140]]);
  });

  await test('top items are ranked by quantity with revenue and share', () => {
    const s = svc.buildSummary(rows, { from: '2026-10-01', to: '2026-11-06', group: 'day' });
    assert.strictEqual(s.items[0].name, 'Bread Omelette');
    assert.strictEqual(s.items[0].quantity, 4);
    assert.strictEqual(s.items[0].revenue, 120);
    assert.strictEqual(s.items[1].name, 'Tea');
    assert.strictEqual(s.items[1].quantity, 2);
    assert.strictEqual(Math.round(s.items[0].share_pct + s.items[1].share_pct), 100);
    assert.strictEqual(s.customers[0].name, 'Asha');
  });

  await test('filters: status, method, item, search by token / student / food', () => {
    assert.strictEqual(svc.filterRows(rows, { status: 'sales' }).length, 4);
    assert.strictEqual(svc.filterRows(rows, { status: 'cancelled' }).length, 1);
    assert.strictEqual(svc.filterRows(rows, { method: 'cash' }).length, 1);
    assert.strictEqual(svc.filterRows(rows, { item_id: '2' }).length, 2);
    assert.strictEqual(svc.filterRows(rows, { q: 'bread omelette' }).length, 4);
    assert.strictEqual(svc.filterRows(rows, { q: 't-102' }).length, 1);
    assert.strictEqual(svc.filterRows(rows, { q: 'bala' }).length, 1);
    assert.strictEqual(svc.filterRows(rows, { status: 'all' }).length, 6);
  });

  await test('sorting and list totals', () => {
    assert.strictEqual(svc.sortRows(rows, 'newest')[0].id, 6);
    assert.strictEqual(svc.sortRows(rows, 'oldest')[0].id, 4);
    const t = svc.listTotals(rows);
    assert.deepStrictEqual([t.orders, t.sales_orders, t.sales_revenue, t.items_sold], [6, 4, 140, 6]);
  });

  await test('empty data does not break the summary', () => {
    const s = svc.buildSummary([], { from: '2026-11-01', to: '2026-11-03', group: 'day' });
    assert.strictEqual(s.totals.revenue, 0);
    assert.strictEqual(s.totals.avg_order_value, 0);
    assert.strictEqual(s.periods.length, 3);
    assert.deepStrictEqual(s.items, []);
  });

  await test('CSV has one line per food item, BOM-free body, and escapes commas / quotes', () => {
    const r = svc.normalizeOrder(order(7, '2026-11-05T05:00:00Z', { items: [
      { menu_item_id: 1, quantity: 1, price_at_order: 30, special_instructions: 'less "spicy", ok', menuItem: { id: 1, name: 'Bread Omelette', category: { name: 'Breakfast' } } },
      { menu_item_id: 2, quantity: 1, price_at_order: 10, menuItem: { id: 2, name: 'Tea', category: { name: 'Drinks' } } }] }));
    const lines = svc.toCsv([r]).trim().split('\n');
    assert.strictEqual(lines.length, 3);
    assert.ok(lines[1].includes('"less ""spicy"", ok"'));
    assert.ok(lines[1].includes('T-107'));
    assert.ok(lines[2].includes('T-107'));
  });

  // ---- controller ----
  await test('rangeFrom: default 30 days, swaps reversed dates, rejects > 10 years', () => {
    const r = ctrl._rangeFrom({});
    assert.ok(r.from && r.to);
    const s = ctrl._rangeFrom({ from: '2026-11-05', to: '2026-11-01' });
    assert.strictEqual(s.from, '2026-11-01');
    assert.throws(() => ctrl._rangeFrom({ from: '2000-01-01', to: '2026-11-01' }), /10 years/);
  });

  await test('GET /orders returns paginated rows with food, token and totals', async () => {
    ORDERS.length = 0; ORDERS.push(...[1, 2, 3].map((i) => order(i, '2026-11-05T05:00:00Z')));
    const r = res();
    await ctrl.orders({ query: { from: '2026-11-01', to: '2026-11-06', limit: '2', page: '2' } }, r);
    assert.strictEqual(r.code, 200);
    assert.strictEqual(r.body.total, 3);
    assert.strictEqual(r.body.pages, 2);
    assert.strictEqual(r.body.rows.length, 1);
    assert.strictEqual(r.body.rows[0].items[0].name, 'Bread Omelette');
    assert.strictEqual(r.body.totals.sales_revenue, 180);
  });

  await test('GET /summary and an invalid group fall back to day', async () => {
    const r = res();
    await ctrl.summary({ query: { from: '2026-11-01', to: '2026-11-06', group: 'bogus' } }, r);
    assert.strictEqual(r.code, 200);
    assert.strictEqual(r.body.totals.revenue, 180);
    assert.strictEqual(r.body.periods.length, 6);
  });

  await test('GET /export sends a CSV attachment', async () => {
    const r = res();
    await ctrl.exportCsv({ query: { from: '2026-11-01', to: '2026-11-06' } }, r);
    assert.ok(/text\/csv/.test(r.headers['Content-Type']));
    assert.ok(/sales-orders-2026-11-01_to_2026-11-06\.csv/.test(r.headers['Content-Disposition']));
    assert.ok(r.body.charCodeAt(0) === 0xFEFF && r.body.includes('Bread Omelette'));
  });

  await test('too-wide range returns 400, not a crash', async () => {
    const r = res();
    await ctrl.summary({ query: { from: '1990-01-01', to: '2026-11-01' } }, r);
    assert.strictEqual(r.code, 400);
  });

  console.log(`\n${n} sales tests ${process.exitCode ? 'FAILED' : 'passed'}`);
})();
