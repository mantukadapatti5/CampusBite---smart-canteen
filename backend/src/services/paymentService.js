// Pure helpers for the payment ledger (no database access, fully unit-tested).
const crypto = require('crypto');
const { dayKey } = require('../utils/dateRange');

const SESSION_MINUTES = Number(process.env.PAYMENT_SESSION_MINUTES || 5);
const TOPUP_MIN = 10;
const TOPUP_MAX = 5000;
const MERCHANT_NAME = 'CampusBite Canteen';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid misreading

function makeTxnRef(now = new Date()) {
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const rnd = Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `TXN${yy}${mm}${dd}${rnd}`;
}
const makePayToken = () => crypto.randomBytes(18).toString('hex'); // 36 hex chars, unguessable
function makeUtr() { // 12-digit UPI reference number (simulated)
  let s = ''; const b = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) s += String(b[i] % 10);
  return s;
}
const money = (n) => Math.round(Number(n) * 100) / 100;

// Only http(s) origins are accepted for the QR link (prevents javascript:/data: links)
function safeOrigin(origin, fallback = 'http://localhost:4173') {
  try {
    const u = new URL(String(origin));
    return ['http:', 'https:'].includes(u.protocol) ? u.origin : fallback;
  } catch { return fallback; }
}
const buildPayUrl = (origin, token) => `${safeOrigin(origin)}/pay/${token}`;

function validateTopupAmount(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v) || v < TOPUP_MIN || v > TOPUP_MAX || Math.round(v) !== v) {
    return { ok: false, error: `Enter a whole amount between ₹${TOPUP_MIN} and ₹${TOPUP_MAX}` };
  }
  return { ok: true, amount: v };
}

// Wallet impact seen by the STUDENT: +credit, -debit, 0 = none (failed / pending / UPI-paid order)
function walletEffect(t) {
  if (t.status !== 'success') return 0;
  const a = Number(t.amount);
  if (t.type === 'wallet_topup' || t.type === 'points_redeem') return a;
  if (t.type === 'refund') return t.method === 'wallet' ? a : 0;
  if (t.type === 'order_payment') return t.method === 'wallet' ? -a : 0;
  return 0;
}

/**
 * Manager summary over a list of ledger rows.
 *  money_in   = cash/UPI/wallet-top-up money received (successful, direction 'in'), where wallet-paid orders are NOT
 *               counted again (that money was already counted when the wallet was topped up).
 *  revenue    = value of all successfully paid orders (any method) minus refunds
 */
function buildSummary(rows, { from, to, walletLiability = 0 } = {}, tz) {
  const ok = rows.filter((r) => r.status === 'success');
  const sum = (arr) => money(arr.reduce((s, r) => s + Number(r.amount), 0));
  const orders = ok.filter((r) => r.type === 'order_payment');
  const topups = ok.filter((r) => r.type === 'wallet_topup');
  const refunds = ok.filter((r) => r.type === 'refund');
  const attempts = rows.filter((r) => ['order_payment', 'wallet_topup'].includes(r.type));
  const failed = attempts.filter((r) => ['failed', 'expired', 'cancelled'].includes(r.status));
  const pending = attempts.filter((r) => r.status === 'pending');
  const finished = attempts.filter((r) => r.status !== 'pending');

  const upiOrders = orders.filter((r) => r.method === 'upi');
  const walletOrders = orders.filter((r) => r.method === 'wallet');
  const cashOrders = orders.filter((r) => r.method === 'cash');
  const cashRefunds = refunds.filter((r) => r.method === 'cash');
  const money_in = money(sum(upiOrders) + sum(cashOrders) + sum(topups));
  const money_out = sum(cashRefunds);            // real money handed back
  const refunded_to_wallet = sum(refunds.filter((r) => r.method === 'wallet'));
  const order_revenue = sum(orders);
  const refunds_total = sum(refunds);

  const dayMap = new Map();
  const bucket = (r) => {
    const k = dayKey(new Date(r.paid_at || r.created_at), tz);
    if (!dayMap.has(k)) dayMap.set(k, { date: k, orders_amount: 0, orders_count: 0, topups: 0, refunds: 0 });
    return dayMap.get(k);
  };
  orders.forEach((r) => { const b = bucket(r); b.orders_amount = money(b.orders_amount + Number(r.amount)); b.orders_count += 1; });
  topups.forEach((r) => { const b = bucket(r); b.topups = money(b.topups + Number(r.amount)); });
  refunds.forEach((r) => { const b = bucket(r); b.refunds = money(b.refunds + Number(r.amount)); });

  const by = (list, key) => Object.entries(list.reduce((m, r) => { (m[r[key]] = m[r[key]] || { count: 0, amount: 0 }); m[r[key]].count++; m[r[key]].amount = money(m[r[key]].amount + Number(r.amount)); return m; }, {}))
    .map(([k, v]) => ({ [key]: k, ...v })).sort((a, b) => b.amount - a.amount);

  return {
    range: { from, to },
    totals: {
      transactions: rows.length,
      successful: ok.length,
      money_in, money_out, refunded_to_wallet,
      order_revenue, net_revenue: money(order_revenue - refunds_total),
      topups: sum(topups), refunds: refunds_total,
      upi_orders: sum(upiOrders), wallet_orders: sum(walletOrders), cash_orders: sum(cashOrders),
      orders_paid: orders.length,
      avg_order_value: orders.length ? money(order_revenue / orders.length) : 0,
      failed_count: failed.length, failed_amount: sum(failed), pending_count: pending.length,
      success_rate: finished.length ? Math.round((finished.filter((r) => r.status === 'success').length / finished.length) * 1000) / 10 : null,
      wallet_liability: money(walletLiability),
    },
    by_method: by(orders, 'method'),
    by_type: by(ok, 'type'),
    failure_reasons: Object.entries(failed.reduce((m, r) => { const k = r.failure_reason || r.status; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    daily: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function toCsv(rows) {
  const head = ['Transaction ID', 'Date & time', 'Student / customer', 'USN / ID', 'Type', 'Method', 'Direction', 'Amount (INR)', 'Status', 'Order token', 'UPI reference', 'Wallet balance after', 'Failure reason'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([r.txn_ref, new Date(r.created_at).toISOString(), r.customer_name, r.customer_id, r.type, r.method, r.direction, Number(r.amount).toFixed(2), r.status, r.order_token || '', r.upi_ref || '', r.wallet_balance_after == null ? '' : Number(r.wallet_balance_after).toFixed(2), r.failure_reason || ''].map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = { SESSION_MINUTES, TOPUP_MIN, TOPUP_MAX, MERCHANT_NAME, makeTxnRef, makePayToken, makeUtr, money, safeOrigin, buildPayUrl, validateTopupAmount, walletEffect, buildSummary, toCsv };
