// Manager / admin "Sales & Orders" analysis: who ordered which food, for how much, under which token,
// plus day / week / month / year trends. All maths lives in services/salesService.js (unit-tested).
const { Op } = require('sequelize');
const { Order, OrderItem, MenuItem, Category, User, PickupSlot } = require('../models');
const { parseRange, isDateStr } = require('../utils/dateRange');
const svc = require('../services/salesService');

const MAX_ORDERS = 20000;   // safety cap for one request (a college canteen is far below this)
const MAX_DAYS = 3660;      // 10 years

// Resolves ?from=&to= (YYYY-MM-DD, canteen time zone). Defaults to the last 30 days.
function rangeFrom(query) {
  let { from, to } = query;
  if (isDateStr(from) && isDateStr(to) && from > to) [from, to] = [to, from];
  const r = parseRange({ from, to }, 30);
  const days = Math.round((r.end.getTime() - r.start.getTime()) / 86400000);
  if (days > MAX_DAYS) { const e = new Error('Please choose a range of 10 years or less'); e.status = 400; throw e; }
  return r;
}

async function loadRows(range) {
  const orders = await Order.findAll({
    where: { created_at: { [Op.between]: [range.start, range.end] } },
    include: [
      { model: OrderItem, as: 'items', include: [{ model: MenuItem, as: 'menuItem', attributes: ['id', 'name'], include: [{ model: Category, as: 'category', attributes: ['name'] }] }] },
      { model: User, as: 'user', attributes: ['id', 'name', 'usn_or_id'] },
      { model: PickupSlot, as: 'pickupSlot', attributes: ['slot_date', 'slot_time'] },
    ],
    order: [['created_at', 'DESC']],
    limit: MAX_ORDERS,
  });
  return { rows: orders.map((o) => svc.normalizeOrder(o)), truncated: orders.length >= MAX_ORDERS };
}

const filtersOf = (q) => ({ status: q.status, method: q.method, item_id: q.item_id, q: q.q });
const fail = (res, err) => res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not load the sales data' });

// GET /api/sales/summary?from=&to=&group=day|week|month|year
exports.summary = async (req, res) => {
  try {
    const range = rangeFrom(req.query);
    const group = svc.GROUPS.includes(req.query.group) ? req.query.group : 'day';
    const { rows, truncated } = await loadRows(range);
    res.json({ ...svc.buildSummary(rows, { from: range.from, to: range.to, group }), truncated });
  } catch (err) { if (!err.status) console.error('[sales] summary failed:', err); fail(res, err); }
};

// GET /api/sales/orders?from=&to=&status=&method=&item_id=&q=&sort=&page=&limit=
// One row per order: token, student, every food item with quantity and price, amounts, payment, status.
exports.orders = async (req, res) => {
  try {
    const range = rangeFrom(req.query);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const { rows, truncated } = await loadRows(range);
    const filtered = svc.sortRows(svc.filterRows(rows, filtersOf(req.query)), req.query.sort);
    const pages = Math.max(1, Math.ceil(filtered.length / limit));
    const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
    res.json({
      range: { from: range.from, to: range.to },
      rows: filtered.slice((page - 1) * limit, page * limit),
      total: filtered.length, page, pages, limit,
      totals: svc.listTotals(filtered), truncated,
    });
  } catch (err) { if (!err.status) console.error('[sales] orders failed:', err); fail(res, err); }
};

// GET /api/sales/export?... same filters as /orders - a CSV with one line per food item
exports.exportCsv = async (req, res) => {
  try {
    const range = rangeFrom(req.query);
    const { rows } = await loadRows(range);
    const filtered = svc.sortRows(svc.filterRows(rows, filtersOf(req.query)), 'oldest');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sales-orders-${range.from}_to_${range.to}.csv"`);
    res.send('﻿' + svc.toCsv(filtered));
  } catch (err) { if (!err.status) console.error('[sales] export failed:', err); fail(res, err); }
};

exports._rangeFrom = rangeFrom;
