const QRCode = require('qrcode');
const { sequelize, Transaction, User, Order } = require('../models');
const orders = require('./orderController');
const svc = require('../services/paymentService');
const { emitPaymentUpdate } = require('../websocket/io');

const DEMO_GATEWAY = () => process.env.PAYMENT_DEMO_GATEWAY !== 'false';

function view(txn, { secret = false } = {}) {
  const p = txn.payload || {};
  const out = {
    id: txn.id, txn_ref: txn.txn_ref, type: txn.type, method: txn.method, amount: Number(txn.amount),
    status: txn.status, failure_reason: txn.failure_reason, upi_ref: txn.upi_ref, order_id: txn.order_id,
    description: txn.description, expires_at: txn.expires_at, paid_at: txn.paid_at, created_at: txn.created_at,
    wallet_balance_after: txn.wallet_balance_after == null ? null : Number(txn.wallet_balance_after),
    merchant: svc.MERCHANT_NAME,
  };
  if (secret && txn.status === 'pending') {
    out.qr_data_url = p.qr_data_url; out.pay_url = p.pay_url; out.pay_token = txn.pay_token;
    out.demo_gateway = DEMO_GATEWAY();
  }
  return out;
}

const notify = (txn) => emitPaymentUpdate(txn.user_id, { id: txn.id, status: txn.status, type: txn.type, order_id: txn.order_id });

// A pending UPI session that ran past its time limit becomes 'expired' (checked whenever it is read).
async function expireIfNeeded(txn) {
  if (txn.status === 'pending' && txn.expires_at && new Date(txn.expires_at) < new Date()) {
    await txn.update({ status: 'expired', failure_reason: 'Payment window expired - no money was taken', payload: null });
    notify(txn);
  }
  return txn;
}

async function startUpiSession({ userId, type, amount, description, payload, origin }) {
  const token = svc.makePayToken();
  const pay_url = svc.buildPayUrl(origin, token);
  const qr_data_url = await QRCode.toDataURL(pay_url, { margin: 1, width: 360 });
  const txn = await Transaction.create({
    txn_ref: svc.makeTxnRef(), user_id: userId, type, method: 'upi', direction: 'in', amount,
    status: 'pending', pay_token: token, description,
    expires_at: new Date(Date.now() + svc.SESSION_MINUTES * 60000),
    payload: { ...payload, pay_url, qr_data_url },
  });
  return txn;
}

// POST /api/payments/quote - the bill for the cart (so the cart shows tax and the exact payable amount)
exports.quote = async (req, res) => {
  try {
    const { items, coupon_code } = req.body;
    const p = await orders.priceOrder(items, coupon_code);
    res.json({ subtotal: p.subtotal, discount: p.discount, tax_percent: p.tax_percent, tax: p.tax, total: p.total, coupon_code: p.appliedCouponCode });
  } catch (err) {
    res.status(400).json({ error: err.message, code: err.code });
  }
};

// POST /api/payments/checkout  { items, coupon_code, scheduled_for, method: 'wallet' | 'upi' }
//  wallet -> paid immediately, order created in the same DB transaction (201 + order)
//  upi    -> a QR payment session is created; the order is created ONLY after the payment succeeds (202)
exports.checkout = async (req, res) => {
  const { items, coupon_code, scheduled_for, return_origin } = req.body;
  const raw = req.body.method || req.body.payment_method;
  const method = raw === 'wallet' ? 'wallet' : ['upi', 'upi_demo'].includes(raw) ? 'upi' : null;
  if (!method) return res.status(400).json({ error: 'Choose a payment method: College Wallet or UPI QR', code: 'PAYMENT_REQUIRED' });
  if (scheduled_for && new Date(scheduled_for) < new Date()) {
    return res.status(400).json({ error: 'Scheduled pickup time must be in the future' });
  }

  if (method === 'wallet') {
    const t = await sequelize.transaction();
    try {
      const { order } = await orders.buildOrder({ userId: req.user.id, items, coupon_code, payment_method: 'wallet', scheduled_for }, t);
      await t.commit();
      const full = await orders.publishOrder(order.id);
      const txn = await Transaction.findOne({ where: { order_id: order.id, type: 'order_payment' } });
      emitPaymentUpdate(req.user.id, { kind: 'wallet_paid', order_id: order.id });
      return res.status(201).json({ ...full, transaction: txn ? view(txn) : null });
    } catch (err) {
      await t.rollback();
      if (err.code === 'INSUFFICIENT_WALLET') {
        // keep a record of the declined payment so it shows in the ledger
        try {
          await Transaction.create({
            txn_ref: svc.makeTxnRef(), user_id: req.user.id, type: 'order_payment', method: 'wallet', direction: 'in',
            amount: err.total, status: 'failed', failure_reason: 'Insufficient wallet balance', description: 'Order payment declined',
          });
        } catch (e) { console.error('[payments] could not log failed wallet payment:', e.message); }
        return res.status(402).json({ error: err.message, code: err.code, balance: err.balance, total: err.total });
      }
      return res.status(400).json({ error: err.message, code: err.code });
    }
  }

  // UPI QR: validate first (stock, coupon, price) but create nothing except the pending payment
  try {
    const priced = await orders.priceOrder(items, coupon_code);
    if (!(priced.total > 0)) return res.status(400).json({ error: 'Order total must be greater than zero' });
    const txn = await startUpiSession({
      userId: req.user.id, type: 'order_payment', amount: priced.total, description: 'Order payment (awaiting UPI payment)',
      origin: return_origin,
      payload: { items: items.map((i) => ({ menu_item_id: i.menu_item_id, quantity: i.quantity, special_instructions: i.special_instructions || null })), coupon_code: priced.appliedCouponCode || null, scheduled_for: scheduled_for || null },
    });
    return res.status(202).json({ payment_required: true, payment: view(txn, { secret: true }) });
  } catch (err) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
};

// POST /api/payments/topup { amount } - add money to the wallet by paying a UPI QR
exports.topup = async (req, res) => {
  const v = svc.validateTopupAmount(req.body.amount);
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    const txn = await startUpiSession({
      userId: req.user.id, type: 'wallet_topup', amount: v.amount, description: 'Wallet top-up (awaiting UPI payment)',
      origin: req.body.return_origin, payload: {},
    });
    res.status(202).json({ payment_required: true, payment: view(txn, { secret: true }) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not start the payment' });
  }
};

// GET /api/payments/:id - the student polls this while the QR is on screen
exports.getPayment = async (req, res) => {
  const txn = await Transaction.findByPk(req.params.id);
  if (!txn || txn.user_id !== req.user.id) return res.status(404).json({ error: 'Payment not found' });
  await expireIfNeeded(txn);
  res.json(view(txn, { secret: true }));
};

// POST /api/payments/:id/cancel
exports.cancelPayment = async (req, res) => {
  const txn = await Transaction.findByPk(req.params.id);
  if (!txn || txn.user_id !== req.user.id) return res.status(404).json({ error: 'Payment not found' });
  if (txn.status === 'pending') {
    await txn.update({ status: 'cancelled', failure_reason: 'Cancelled by you - no money was taken', payload: null });
    notify(txn);
  }
  res.json(view(txn));
};

// ---------------- demo UPI gateway (the page opened by scanning the QR) ----------------

const publicView = async (txn) => {
  const out = view(txn);
  if (txn.status === 'success' && txn.order_id) {
    const o = await Order.findByPk(txn.order_id, { attributes: ['token_number'] });
    out.order_token = o ? o.token_number : null;
  }
  return out;
};

async function findByToken(req, res) {
  if (!DEMO_GATEWAY()) { res.status(403).json({ error: 'The demo payment gateway is disabled' }); return null; }
  const txn = await Transaction.findOne({ where: { pay_token: req.params.token } });
  if (!txn) { res.status(404).json({ error: 'This payment link is not valid' }); return null; }
  await expireIfNeeded(txn);
  return txn;
}

exports.gatewayInfo = async (req, res) => {
  const txn = await findByToken(req, res); if (!txn) return;
  res.json(await publicView(txn));
};

// The payer approves the payment. For a wallet top-up the wallet is credited; for an order the order is created
// in the SAME database transaction. If anything fails (e.g. the item sold out meanwhile) nothing is charged.
exports.gatewayConfirm = async (req, res) => {
  const first = await findByToken(req, res); if (!first) return;
  if (first.status !== 'pending') return res.json(await publicView(first));

  const t = await sequelize.transaction();
  try {
    const txn = await Transaction.findOne({ where: { id: first.id }, transaction: t, lock: t.LOCK.UPDATE });
    if (txn.status !== 'pending') { await t.rollback(); return res.json(await publicView(txn)); }
    if (txn.expires_at && new Date(txn.expires_at) < new Date()) { await t.rollback(); await expireIfNeeded(await Transaction.findByPk(txn.id)); return res.json(await publicView(await Transaction.findByPk(txn.id))); }

    const paid = { status: 'success', paid_at: new Date(), upi_ref: svc.makeUtr(), failure_reason: null };
    let order = null;
    if (txn.type === 'wallet_topup') {
      const user = await User.findByPk(txn.user_id, { transaction: t, lock: t.LOCK.UPDATE });
      await user.increment('wallet_balance', { by: Number(txn.amount), transaction: t });
      await user.reload({ transaction: t });
      await txn.update({ ...paid, wallet_balance_after: Number(user.wallet_balance), description: 'Wallet top-up via UPI QR', payload: null }, { transaction: t });
    } else {
      const p = txn.payload || {};
      const sched = p.scheduled_for && new Date(p.scheduled_for) > new Date() ? p.scheduled_for : undefined;
      ({ order } = await orders.buildOrder({
        userId: txn.user_id, items: p.items, coupon_code: p.coupon_code, payment_method: 'upi_demo',
        scheduled_for: sched, paid_txn: txn, expected_total: Number(txn.amount),
      }, t));
      await txn.update({ ...paid, payload: null }, { transaction: t });
    }
    await t.commit();
    if (order) await orders.publishOrder(order.id);
    const done = await Transaction.findByPk(txn.id);
    notify(done);
    return res.json(await publicView(done));
  } catch (err) {
    await t.rollback();
    const reason = `${err.message} (no money was taken)`;
    await Transaction.update({ status: 'failed', failure_reason: reason.slice(0, 250), payload: null }, { where: { id: first.id, status: 'pending' } });
    const failed = await Transaction.findByPk(first.id);
    notify(failed);
    return res.json(await publicView(failed));
  }
};

// The payer declines / the bank rejects the payment
exports.gatewayFail = async (req, res) => {
  const txn = await findByToken(req, res); if (!txn) return;
  if (txn.status === 'pending') {
    const reason = String(req.body?.reason || 'Payment declined at the UPI app').slice(0, 120);
    await txn.update({ status: 'failed', failure_reason: `${reason} - no money was taken`, payload: null });
    notify(txn);
  }
  res.json(await publicView(txn));
};

exports._view = view;
