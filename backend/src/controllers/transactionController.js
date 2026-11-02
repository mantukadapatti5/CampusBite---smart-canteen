const { Op } = require('sequelize');
const { Transaction, User, Order } = require('../models');
const svc = require('../services/paymentService');
const ledger = require('../services/ledger');
const { parseRange, isDateStr } = require('../utils/dateRange');

const TYPES = ['order_payment', 'wallet_topup', 'refund', 'points_redeem'];
const METHODS = ['upi', 'wallet', 'cash', 'reward_points'];
const STATUSES = ['pending', 'success', 'failed', 'expired', 'cancelled'];
const HIDE = ['pay_token', 'payload'];

const INCLUDE = [
  { model: User, as: 'user', attributes: ['id', 'name', 'usn_or_id', 'role'] },
  { model: Order, as: 'order', attributes: ['id', 'token_number', 'status', 'walk_in_name', 'is_manual_entry', 'total_amount', 'payment_status'] },
];

function shape(t) {
  const o = t.order; const u = t.user;
  const walkIn = o && o.is_manual_entry;
  return {
    id: t.id, txn_ref: t.txn_ref, type: t.type, method: t.method, direction: t.direction, amount: Number(t.amount),
    status: t.status, failure_reason: t.failure_reason, upi_ref: t.upi_ref, description: t.description,
    created_at: t.created_at, paid_at: t.paid_at, expires_at: t.expires_at,
    wallet_balance_after: t.wallet_balance_after == null ? null : Number(t.wallet_balance_after),
    wallet_effect: svc.walletEffect(t),
    order_id: t.order_id, order_token: o ? o.token_number : null, order_status: o ? o.status : null,
    customer_name: walkIn ? `Walk-in: ${o.walk_in_name}` : (u ? u.name : null),
    customer_id: walkIn ? 'walk-in' : (u ? u.usn_or_id : null), customer_role: u ? u.role : null,
  };
}

function buildWhere(query, userId) {
  const where = {};
  if (userId) where.user_id = userId;
  if (TYPES.includes(query.type)) where.type = query.type;
  if (METHODS.includes(query.method)) where.method = query.method;
  if (STATUSES.includes(query.status)) where.status = query.status;
  if (query.status === 'failed_all') where.status = { [Op.in]: ['failed', 'expired', 'cancelled'] };
  if (isDateStr(query.from) || isDateStr(query.to)) {
    const r = parseRange({ from: query.from, to: query.to }, 3650);
    where.created_at = { [Op.between]: [r.start, r.end] };
  }
  const q = String(query.q || '').trim().slice(0, 60);
  if (q) {
    const like = { [Op.iLike]: `%${q}%` };
    where[Op.or] = [{ txn_ref: like }, { upi_ref: like }, { '$user.name$': like }, { '$user.usn_or_id$': like }, { '$order.token_number$': like }, { '$order.walk_in_name$': like }];
  }
  return where;
}

const pageOf = (query) => {
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  return { limit, page, offset: (page - 1) * limit };
};

async function list(req, res, userId) {
  await ledger.expireStale();
  const { limit, page, offset } = pageOf(req.query);
  const { rows, count } = await Transaction.findAndCountAll({
    where: buildWhere(req.query, userId), include: INCLUDE, attributes: { exclude: HIDE },
    order: [['created_at', 'DESC'], ['id', 'DESC']], limit, offset, subQuery: false,
  });
  res.json({ rows: rows.map(shape), total: count, page, pages: Math.max(1, Math.ceil(count / limit)), limit });
}

// ---------- student: my transactions ----------
exports.mine = (req, res) => list(req, res, req.user.id);

exports.mySummary = async (req, res) => {
  await ledger.expireStale();
  const rows = await Transaction.findAll({ where: { user_id: req.user.id }, attributes: ['type', 'method', 'direction', 'amount', 'status', 'created_at', 'paid_at', 'failure_reason'] });
  const me = await User.findByPk(req.user.id, { attributes: ['wallet_balance', 'reward_points'] });
  const ok = rows.filter((r) => r.status === 'success');
  const sum = (a) => svc.money(a.reduce((s, r) => s + Number(r.amount), 0));
  res.json({
    wallet_balance: Number(me.wallet_balance), reward_points: me.reward_points,
    total_spent: sum(ok.filter((r) => r.type === 'order_payment')),
    spent_by_wallet: sum(ok.filter((r) => r.type === 'order_payment' && r.method === 'wallet')),
    spent_by_upi: sum(ok.filter((r) => r.type === 'order_payment' && r.method === 'upi')),
    total_added: sum(ok.filter((r) => r.type === 'wallet_topup')),
    total_refunded: sum(ok.filter((r) => r.type === 'refund')),
    failed_count: rows.filter((r) => ['failed', 'expired', 'cancelled'].includes(r.status) && ['order_payment', 'wallet_topup'].includes(r.type)).length,
    transactions: rows.length,
  });
};

// ---------- manager / admin ----------
exports.all = (req, res) => list(req, res, null);

exports.summary = async (req, res) => {
  await ledger.expireStale();
  const range = parseRange(req.query, 30);
  const rows = await Transaction.findAll({
    where: { created_at: { [Op.between]: [range.start, range.end] } },
    attributes: ['type', 'method', 'direction', 'amount', 'status', 'created_at', 'paid_at', 'failure_reason'],
  });
  res.json(svc.buildSummary(rows, { from: range.from, to: range.to, walletLiability: await ledger.walletLiability() }));
};

exports.exportCsv = async (req, res) => {
  await ledger.expireStale();
  const rows = await Transaction.findAll({
    where: buildWhere(req.query, null), include: INCLUDE, attributes: { exclude: HIDE },
    order: [['created_at', 'DESC'], ['id', 'DESC']], limit: 10000, subQuery: false,
  });
  const range = parseRange(req.query, 30);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${range.from}_to_${range.to}.csv"`);
  res.send('\uFEFF' + svc.toCsv(rows.map(shape)));
};

// ---------- one transaction (owner, or manager / admin) ----------
exports.getOne = async (req, res) => {
  const t = await Transaction.findByPk(req.params.id, { include: INCLUDE, attributes: { exclude: HIDE } });
  if (!t) return res.status(404).json({ error: 'Transaction not found' });
  if (t.user_id !== req.user.id && !['manager', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Not your transaction' });
  res.json(shape(t));
};

exports._shape = shape;
