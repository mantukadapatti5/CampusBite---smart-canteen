// Optional demo data (SEED_DEMO_HISTORY=true, fresh database only): two weeks of
// believable orders, wallet top-ups, refunds and a few failed payments, so the manager's
// transaction analysis and the ML Insights page have something to show on day one.
const { makeRng } = require('../ml/rng');
const { makeTxnRef, money } = require('../services/paymentService');

const HOUR_WEIGHT = { 8: 9, 9: 10, 10: 5, 11: 7, 12: 15, 13: 19, 14: 10, 15: 7, 16: 12, 17: 11, 18: 7, 19: 5 };
const pickWeighted = (rng, w) => { const t = Object.values(w).reduce((a, b) => a + b, 0); let r = rng() * t; for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return Number(k); } return 13; };
const pad = (n) => String(n).padStart(2, '0');

async function seedDemoHistory({ models, days = 14, orders = 110, log = console.log }) {
  const { User, MenuItem, Order, OrderItem, PickupSlot, Transaction, CanteenSettings } = models;
  if ((await Order.count()) > 0 || (await Transaction.count()) > 0) return { skipped: true };
  const students = await User.findAll({ where: { role: 'student' } });
  const items = await MenuItem.findAll();
  if (!students.length || !items.length) return { skipped: true };
  const settings = await CanteenSettings.findByPk(1);
  const taxPct = settings ? Number(settings.tax_percent) : 5;
  const rng = makeRng(20261030);
  const out = { orders: 0, topups: 0, failed: 0, refunds: 0 };
  const stamp = (d) => ({ created_at: d, updated_at: d });

  // wallet top-ups spread over the period
  for (let i = 0; i < 12; i++) {
    const when = new Date(Date.now() - rng() * days * 86400000);
    await Transaction.create({ txn_ref: makeTxnRef(when), user_id: students[i % students.length].id, type: 'wallet_topup', method: 'upi', direction: 'in', amount: [100, 200, 300, 500][Math.floor(rng() * 4)], status: 'success', paid_at: when, upi_ref: String(Math.floor(1e11 + rng() * 9e11)), description: 'Wallet top-up via UPI QR', ...stamp(when) });
    out.topups++;
  }

  for (let i = 0; i < orders; i++) {
    const dayBack = Math.floor(rng() * days) + (rng() < 0.15 ? 0 : 1);
    const hour = pickWeighted(rng, HOUR_WEIGHT); const minute = Math.floor(rng() * 60);
    const when = new Date(); when.setDate(when.getDate() - dayBack); when.setHours(hour, minute, Math.floor(rng() * 60), 0);
    if (when > new Date()) continue;
    const slotMin = Math.floor(minute / 10) * 10 + 10;
    const slotDate = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
    const slotTime = slotMin >= 60 ? `${pad(Math.min(hour + 1, 23))}:00` : `${pad(hour)}:${pad(slotMin)}`;
    const [slot] = await PickupSlot.findOrCreate({ where: { slot_date: slotDate, slot_time: slotTime }, defaults: { capacity: 15, order_count: 0 } });
    await slot.increment('order_count');

    const n = 1 + Math.floor(rng() * 3); const chosen = new Set(); let subtotal = 0; const lines = [];
    while (chosen.size < n) chosen.add(items[Math.floor(rng() * items.length)]);
    for (const it of chosen) { const q = 1 + Math.floor(rng() * 2); subtotal += Number(it.price) * q; lines.push({ it, q }); }
    const tax = money((subtotal * taxPct) / 100); const total = money(subtotal + tax);
    const r = rng();
    const manual = r < 0.1; const method = manual ? 'cash' : r < 0.55 ? 'wallet' : 'upi_demo';
    const cancelled = rng() < 0.05;
    const student = students[Math.floor(rng() * students.length)];
    const uid = manual ? (await User.findOne({ where: { role: 'canteen_staff' } }) || student).id : student.id;
    const order = await Order.create({
      user_id: uid, pickup_slot_id: slot.id, token_number: `T-${100 + Math.floor(rng() * 900)}`, subtotal_amount: subtotal, discount_amount: 0, tax_amount: tax,
      total_amount: total, payment_method: method, payment_status: cancelled ? 'refunded' : 'paid', status: cancelled ? 'cancelled' : 'collected',
      is_manual_entry: manual, walk_in_name: manual ? 'Walk-in customer' : null, ...stamp(when),
    });
    for (const { it, q } of lines) await OrderItem.create({ order_id: order.id, menu_item_id: it.id, quantity: q, price_at_order: it.price });
    await Transaction.create({ txn_ref: makeTxnRef(when), user_id: uid, order_id: order.id, type: 'order_payment', method: method === 'upi_demo' ? 'upi' : method, direction: 'in', amount: total, status: 'success', paid_at: when, upi_ref: method === 'upi_demo' ? String(Math.floor(1e11 + rng() * 9e11)) : null, description: `Order ${order.token_number}`, ...stamp(when) });
    out.orders++;
    if (cancelled) {
      await Transaction.create({ txn_ref: makeTxnRef(when), user_id: uid, order_id: order.id, type: 'refund', method: method === 'cash' ? 'cash' : 'wallet', direction: 'out', amount: total, status: 'success', paid_at: when, description: `Refund: order ${order.token_number} cancelled`, ...stamp(when) });
      out.refunds++;
    }
    if (rng() < 0.07) { // an attempt that never completed
      const status = rng() < 0.5 ? 'failed' : 'expired';
      await Transaction.create({ txn_ref: makeTxnRef(when), user_id: student.id, type: 'order_payment', method: 'upi', direction: 'in', amount: total, status, failure_reason: status === 'failed' ? 'Payment declined at the UPI app - no money was taken' : 'Payment window expired - no money was taken', description: 'Order payment (not completed)', ...stamp(when) });
      out.failed++;
    }
  }
  log(`[demo] history seeded: ${out.orders} orders, ${out.topups} top-ups, ${out.refunds} refunds, ${out.failed} failed attempts.`);
  return out;
}

module.exports = { seedDemoHistory };
