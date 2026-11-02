'use strict';
// Module-level tests for the machine-learning module (no database or HTTP server needed).
// Run:  npm run ml:test
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { generateAll } = require('../dataset');
const { readCsv } = require('../csv');
const { train, saveStore, loadStore } = require('../trainer');
const A = require('../algorithms');
const mlService = require('../mlService');

const results = [];
function test(id, title, fn) {
  try { const detail = fn(); results.push({ id, title, ok: true, detail: detail || '' }); }
  catch (e) { results.push({ id, title, ok: false, detail: e.message }); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'mlA-'));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'mlB-'));
const menu = require('../../seed/menu_dataset.json').categories.flatMap((c) => c.items.map((i, k) => ({
  id: k + 1, name: i.name, category_slug: c.slug, price: i.price, is_veg: i.is_veg, stock_quantity: 40, is_available: true,
})));
const total = (r) => r.items.reduce((s, x) => s + x.predicted_quantity, 0);
const pick = (r, n) => r.items.find((x) => x.name === n).predicted_quantity;

test('ML-01', 'Dataset generation is reproducible (same seed -> identical CSV files)', () => {
  const a = generateAll({ dir: dirA }); generateAll({ dir: dirB });
  for (const f of ['hourly_orders', 'daily_item_sales', 'order_wait_times']) assert(sha(path.join(dirA, f + '.csv')) === sha(path.join(dirB, f + '.csv')), f + ' differs');
  assert(a.hourly_orders === 4380 && a.daily_item_sales === 13505 && a.order_wait_times === 6000, JSON.stringify(a));
  return `rows ${a.hourly_orders} / ${a.daily_item_sales} / ${a.order_wait_times}`;
});
test('ML-02', 'Generated data is valid (ranges, 37 items, 6 categories, no negatives)', () => {
  const h = readCsv(path.join(dirA, 'hourly_orders.csv')), d = readCsv(path.join(dirA, 'daily_item_sales.csv')), w = readCsv(path.join(dirA, 'order_wait_times.csv'));
  assert(h.every((r) => r.hour >= 8 && r.hour <= 19 && r.orders >= 0), 'hourly range');
  assert(new Set(d.map((r) => r.item_name)).size === 37 && new Set(d.map((r) => r.category_slug)).size === 6, 'items/categories');
  assert(d.every((r) => r.qty >= 0) && w.every((r) => r.wait_minutes >= 1), 'negatives');
  return '37 items, 6 categories, 12 opening hours, no negative values';
});
let store;
test('ML-03', 'Training and evaluation complete and the model file round-trips', () => {
  store = train();
  const tmp = path.join(os.tmpdir(), 'mlstore-test.json'); fs.writeFileSync(tmp, JSON.stringify(store));
  const back = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  const row = [13, 2, 0, 0, 0, 0, 10];
  assert(A.predict(back.tasks.crowd.model, row) === A.predict(store.tasks.crowd.model, row), 'reload mismatch');
  assert(store.training_seconds < 60, 'too slow');
  return `trained in ${store.training_seconds}s; reload gives identical predictions`;
});
test('ML-04', 'Held-out R2 of the selected model is at least 0.80 for every task', () => {
  const out = Object.entries(store.tasks).map(([k, t]) => { const r = t.results[t.selected]; assert(r.r2 >= 0.8, `${k} R2 ${r.r2}`); return `${k} ${t.selected} R2=${r.r2}`; });
  return out.join('; ');
});
test('ML-05', 'The selected model has lower RMSE than the old (non-ML) method on every task', () => {
  const out = Object.entries(store.tasks).map(([k, t]) => { assert(t.results[t.selected].rmse < t.results.baseline.rmse, k); return `${k} ${t.improvement_vs_baseline_pct}%`; });
  return 'RMSE reduction: ' + out.join(', ');
});
test('ML-06', 'Crowd forecast behaves sensibly (peak at lunch, Sunday/holiday low, exam and rain effects)', () => {
  const tue = mlService.predictCrowd('2026-10-27', {}), sun = mlService.predictCrowd('2026-10-25', {});
  const hol = mlService.predictCrowd('2026-10-27', { holiday: true }), rain = mlService.predictCrowd('2026-10-27', { rain: true }), exam = mlService.predictCrowd('2026-10-27', { exam: true });
  assert(tue.hours.length === 12 && tue.hours.every((h) => h.predicted_orders >= 0), 'shape');
  assert([12, 13].includes(tue.peak_hour), 'peak ' + tue.peak_hour);
  assert(sun.total_orders < tue.total_orders * 0.4 && hol.total_orders < tue.total_orders * 0.4, 'sunday/holiday');
  assert(rain.total_orders > tue.total_orders, 'rain'); assert(exam.hours[9].predicted_orders > tue.hours[9].predicted_orders, 'exam evening');
  return `Tue ${tue.total_orders}, Sun ${sun.total_orders}, holiday ${hol.total_orders}, rain ${rain.total_orders}; peak ${tue.peak_label}`;
});
test('ML-07', 'Demand forecast reacts to weather and weekday (rain: tea up, juice down; Friday biryani up)', () => {
  const dry = mlService.predictDemand(menu, '2026-10-28', {}), rain = mlService.predictDemand(menu, '2026-10-28', { rain: true });
  const wed = mlService.predictDemand(menu, '2026-10-28', {}), fri = mlService.predictDemand(menu, '2026-10-30', {});
  assert(pick(rain, 'Masala Tea') > pick(dry, 'Masala Tea'), 'tea'); assert(pick(rain, 'Watermelon Juice') < pick(dry, 'Watermelon Juice'), 'juice');
  assert(pick(fri, 'Chicken Biryani') > pick(wed, 'Chicken Biryani'), 'biryani');
  return `Masala Tea ${pick(dry, 'Masala Tea')} dry vs ${pick(rain, 'Masala Tea')} rain; Watermelon Juice ${pick(dry, 'Watermelon Juice')} vs ${pick(rain, 'Watermelon Juice')}; Chicken Biryani Wed ${pick(wed, 'Chicken Biryani')} vs Fri ${pick(fri, 'Chicken Biryani')}`;
});
test('ML-08', 'A new menu item with no history gets a finite, non-negative forecast (category fallback)', () => {
  const r = mlService.predictDemand([{ id: 99, name: 'Paneer Roll', category_slug: 'snacks', price: 50, is_veg: true, stock_quantity: 5, is_available: true }], '2026-10-28', {});
  const v = r.items[0].predicted_quantity; assert(Number.isFinite(v) && v >= 0, 'bad value'); return `forecast ${v} units`;
});
test('ML-09', 'Stock flags are correct (restock when stock < forecast, unavailable when off the menu)', () => {
  const r = mlService.predictDemand([
    { id: 1, name: 'Masala Tea', category_slug: 'beverages', price: 10, is_veg: true, stock_quantity: 3, is_available: true },
    { id: 2, name: 'Masala Dosa', category_slug: 'breakfast', price: 35, is_veg: true, stock_quantity: 500, is_available: true },
    { id: 3, name: 'Upma', category_slug: 'breakfast', price: 20, is_veg: true, stock_quantity: 0, is_available: false }], '2026-10-28', {});
  const s = (n) => r.items.find((x) => x.name === n).status;
  assert(s('Masala Tea') === 'restock' && s('Masala Dosa') === 'ok' && s('Upma') === 'unavailable', JSON.stringify(r.items.map((x) => x.status)));
  return 'restock / ok / unavailable';
});
test('ML-10', 'Wait-time prediction grows with queue length and prep time, and is never below 1 minute', () => {
  const w = (a, p) => mlService.predictWait({ orders_ahead: a, items_count: 2, total_qty: 3, max_prep_min: p, hour: 13, dow: 2 }).minutes;
  assert(w(0, 5) < w(5, 5) && w(5, 5) < w(10, 5) && w(10, 5) < w(15, 5), 'queue'); assert(w(5, 4) < w(5, 10), 'prep');
  assert(mlService.predictWait({ orders_ahead: 0, items_count: 1, total_qty: 1, max_prep_min: 1, hour: 15, dow: 2 }).minutes >= 1, 'min');
  return `orders ahead 0/5/10/15 -> ${w(0, 5)}/${w(5, 5)}/${w(10, 5)}/${w(15, 5)} min`;
});
test('ML-11', 'The overview sent to the browser never contains the raw trained model', () => {
  const o = JSON.stringify(mlService.overview()); assert(!o.includes('"trees"') && !o.includes('"weights"'), 'model leaked');
  return `payload ${Math.round(o.length / 1024)} KB, metrics only`;
});
test('ML-12', 'Selected models are re-fitted and saved; saved file loads at start-up', () => {
  const s = loadStore(); assert(s && s.tasks.crowd.model && s.tasks.demand.meta && s.tasks.wait.model, 'store incomplete');
  return `crowd=${s.tasks.crowd.selected}, demand=${s.tasks.demand.selected}, wait=${s.tasks.wait.selected}`;
});

let pass = 0;
for (const r of results) { if (r.ok) pass++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.title}\n        ${r.detail}`); }
console.log(`\n${pass}/${results.length} ML tests passed`);
fs.writeFileSync(path.join(__dirname, 'last_run.json'), JSON.stringify({ run_at: new Date().toISOString(), node: process.version, pass, total: results.length, results }, null, 1));
process.exit(pass === results.length ? 0 : 1);
