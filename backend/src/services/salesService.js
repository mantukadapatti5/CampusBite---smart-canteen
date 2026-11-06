// Pure helpers for the manager's "Sales & Orders" analysis (no database access, fully unit-tested).
//
// An "order row" is the flat shape produced by normalizeOrder(): who ordered, which food, how many,
// how much, which token, when. Everything else (filters, totals, per-day / week / month / year
// buckets, top items, busy hours...) is computed from those rows.
//
// What counts as a SALE: an order whose payment is secured ('paid') and that was not cancelled or
// rejected. Cancelled / rejected orders are refunded, so they are listed but never added to revenue.
const { dayKey } = require('../utils/dateRange');

const TZ = () => process.env.APP_TZ || 'Asia/Kolkata';
const GROUPS = ['day', 'week', 'month', 'year'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NOT_A_SALE = ['cancelled', 'rejected'];

const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const plain = (o) => (o && typeof o.get === 'function' ? o.get({ plain: true }) : o);

const isSale = (o) => o.payment_status === 'paid' && !NOT_A_SALE.includes(o.status);

// ---------------------------------------------------------------- date helpers ('YYYY-MM-DD' strings)
const parts = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
const toStr = (ms) => new Date(ms).toISOString().slice(0, 10);
function addDays(s, n) { const { y, m, d } = parts(s); return toStr(Date.UTC(y, m - 1, d + n)); }
function dowOf(s) { const { y, m, d } = parts(s); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
const mondayOf = (s) => addDays(s, -((dowOf(s) + 6) % 7));
function lastDayOfMonth(y, m) { return toStr(Date.UTC(y, m, 0)); }
function hourOf(date, tz = TZ()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(date)) % 24;
}
function timeOf(date, tz = TZ()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

// The bucket (period) a day belongs to, with the first and last day of that bucket.
function periodOf(day, group) {
  if (group === 'week') { const f = mondayOf(day); return { key: f, from: f, to: addDays(f, 6) }; }
  if (group === 'month') { const { y, m } = parts(day); return { key: day.slice(0, 7), from: `${day.slice(0, 7)}-01`, to: lastDayOfMonth(y, m) }; }
  if (group === 'year') { const { y } = parts(day); return { key: String(y), from: `${y}-01-01`, to: `${y}-12-31` }; }
  return { key: day, from: day, to: day };
}

// every bucket between two days, in order (so a quiet day / month still shows up as zero)
function periodsBetween(from, to, group) {
  const out = []; let cursor = from;
  while (cursor <= to && out.length < 4000) {
    const p = periodOf(cursor, group);
    out.push(p);
    cursor = addDays(p.to, 1);
  }
  return out;
}

// ---------------------------------------------------------------- order rows
function normalizeOrder(raw, tz = TZ()) {
  const o = plain(raw);
  const created = new Date(o.created_at);
  const walkIn = !!o.is_manual_entry;
  const items = (o.items || []).map((oi) => {
    const mi = oi.menuItem || null;
    const qty = Number(oi.quantity) || 0;
    const unit = Number(oi.price_at_order) || 0;
    return {
      menu_item_id: oi.menu_item_id,
      name: mi ? mi.name : `Deleted item #${oi.menu_item_id}`,
      category: mi && mi.category ? mi.category.name : 'Other',
      quantity: qty,
      unit_price: money(unit),
      line_total: money(unit * qty),
      special_instructions: oi.special_instructions || null,
    };
  });
  return {
    id: o.id,
    token_number: o.token_number,
    created_at: created.toISOString(),
    day: dayKey(created, tz),
    time: timeOf(created, tz),
    hour: hourOf(created, tz),
    status: o.status,
    payment_status: o.payment_status,
    payment_method: o.payment_method,
    is_sale: isSale(o),
    is_walk_in: walkIn,
    user_id: walkIn ? null : o.user_id,
    customer_name: walkIn ? `Walk-in: ${o.walk_in_name || 'customer'}` : (o.user ? o.user.name : 'Unknown'),
    customer_id: walkIn ? 'walk-in' : (o.user ? o.user.usn_or_id : ''),
    items,
    items_count: items.reduce((s, i) => s + i.quantity, 0),
    items_text: items.map((i) => `${i.name} x${i.quantity}`).join(', '),
    subtotal: money(o.subtotal_amount),
    discount: money(o.discount_amount),
    tax: money(o.tax_amount),
    total: money(o.total_amount),
    coupon_code: o.coupon_code || null,
    slot_date: o.pickupSlot ? o.pickupSlot.slot_date : null,
    slot_time: o.pickupSlot ? o.pickupSlot.slot_time : null,
    counter_number: o.counter_number || null,
  };
}

// ---------------------------------------------------------------- filters
// filters: { status: 'all' | 'sales' | <order status>, method, item_id, q }
function filterRows(rows, f = {}) {
  const status = f.status || 'all';
  const q = String(f.q || '').trim().toLowerCase().slice(0, 60);
  const itemId = f.item_id ? Number(f.item_id) : null;
  return rows.filter((r) => {
    if (status === 'sales' && !r.is_sale) return false;
    if (status !== 'all' && status !== 'sales' && r.status !== status) return false;
    if (f.method && r.payment_method !== f.method) return false;
    if (itemId && !r.items.some((i) => i.menu_item_id === itemId)) return false;
    if (q) {
      const hay = `${r.token_number} ${r.customer_name} ${r.customer_id} ${r.items_text}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function sortRows(rows, sort) {
  const list = rows.slice();
  if (sort === 'oldest') list.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  else if (sort === 'amount') list.sort((a, b) => b.total - a.total || b.id - a.id);
  else list.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
  return list;
}

const sumOf = (arr, f) => money(arr.reduce((s, x) => s + f(x), 0));
function listTotals(rows) {
  const sales = rows.filter((r) => r.is_sale);
  return { orders: rows.length, sales_orders: sales.length, sales_revenue: sumOf(sales, (r) => r.total), items_sold: sales.reduce((s, r) => s + r.items_count, 0) };
}

// ---------------------------------------------------------------- the analysis
function bump(map, key, init) { if (!map.has(key)) map.set(key, init()); return map.get(key); }

function buildSummary(rows, { from, to, group = 'day' }) {
  const g = GROUPS.includes(group) ? group : 'day';
  const sales = rows.filter((r) => r.is_sale);
  const cancelled = rows.filter((r) => !r.is_sale && NOT_A_SALE.includes(r.status));

  // periods (zero-filled)
  const periodMap = new Map(periodsBetween(from, to, g).map((p) => [p.key, { ...p, orders: 0, items: 0, revenue: 0 }]));
  for (const r of sales) {
    const p = periodOf(r.day, g);
    const b = bump(periodMap, p.key, () => ({ ...p, orders: 0, items: 0, revenue: 0 }));
    b.orders += 1; b.items += r.items_count; b.revenue = money(b.revenue + r.total);
  }
  const periods = [...periodMap.values()].sort((a, b) => a.key.localeCompare(b.key))
    .map((p) => ({ ...p, avg_order_value: p.orders ? money(p.revenue / p.orders) : 0 }));

  // items & categories (item revenue = unit price x quantity, before discount and tax)
  const itemMap = new Map(); const catMap = new Map();
  for (const r of sales) {
    for (const i of r.items) {
      const it = bump(itemMap, i.menu_item_id, () => ({ menu_item_id: i.menu_item_id, name: i.name, category: i.category, quantity: 0, orders: 0, revenue: 0 }));
      it.quantity += i.quantity; it.orders += 1; it.revenue = money(it.revenue + i.line_total);
      const c = bump(catMap, i.category, () => ({ category: i.category, quantity: 0, revenue: 0 }));
      c.quantity += i.quantity; c.revenue = money(c.revenue + i.line_total);
    }
  }
  const itemRevenueTotal = money([...itemMap.values()].reduce((s, i) => s + i.revenue, 0));
  const items = [...itemMap.values()]
    .map((i) => ({ ...i, share_pct: itemRevenueTotal ? Math.round((i.revenue / itemRevenueTotal) * 1000) / 10 : 0 }))
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue || a.name.localeCompare(b.name));
  const categories = [...catMap.values()].sort((a, b) => b.revenue - a.revenue);

  // busiest hours (only the opening-hours span that has data, zero-filled in between)
  const hourMap = new Map();
  for (const r of sales) { const h = bump(hourMap, r.hour, () => ({ hour: r.hour, orders: 0, revenue: 0 })); h.orders += 1; h.revenue = money(h.revenue + r.total); }
  const hours = [];
  if (hourMap.size) {
    const hs = [...hourMap.keys()]; const lo = Math.min(...hs); const hi = Math.max(...hs);
    for (let h = lo; h <= hi; h++) hours.push(hourMap.get(h) || { hour: h, orders: 0, revenue: 0 });
  }

  // weekdays (Monday first)
  const dowMap = new Map();
  for (const r of sales) { const d = dowOf(r.day); const w = bump(dowMap, d, () => ({ dow: d, name: WEEKDAYS[d], orders: 0, revenue: 0 })); w.orders += 1; w.revenue = money(w.revenue + r.total); }
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((d) => dowMap.get(d) || { dow: d, name: WEEKDAYS[d], orders: 0, revenue: 0 });

  // payment methods
  const methodMap = new Map();
  for (const r of sales) { const m = bump(methodMap, r.payment_method, () => ({ method: r.payment_method, orders: 0, revenue: 0 })); m.orders += 1; m.revenue = money(m.revenue + r.total); }
  const methods = [...methodMap.values()].sort((a, b) => b.revenue - a.revenue);

  // best customers (walk-in orders are anonymous, so they are not ranked)
  const custMap = new Map();
  for (const r of sales.filter((x) => !x.is_walk_in)) {
    const c = bump(custMap, r.user_id, () => ({ user_id: r.user_id, name: r.customer_name, usn_or_id: r.customer_id, orders: 0, items: 0, spent: 0 }));
    c.orders += 1; c.items += r.items_count; c.spent = money(c.spent + r.total);
  }
  const customers = [...custMap.values()].sort((a, b) => b.spent - a.spent || b.orders - a.orders).slice(0, 10);

  const revenue = sumOf(sales, (r) => r.total);
  const busiest = periods.reduce((b, p) => (p.revenue > (b ? b.revenue : 0) ? p : b), null);
  return {
    range: { from, to, group: g },
    totals: {
      orders: sales.length,
      items_sold: sales.reduce((s, r) => s + r.items_count, 0),
      subtotal: sumOf(sales, (r) => r.subtotal),
      discount: sumOf(sales, (r) => r.discount),
      tax: sumOf(sales, (r) => r.tax),
      revenue,
      avg_order_value: sales.length ? money(revenue / sales.length) : 0,
      unique_customers: custMap.size,
      walk_in_orders: sales.filter((r) => r.is_walk_in).length,
      cancelled_orders: cancelled.length,
      cancelled_amount: sumOf(cancelled, (r) => r.total),
      in_progress_orders: sales.filter((r) => ['pending', 'accepted', 'preparing', 'ready'].includes(r.status)).length,
      best_period: busiest && busiest.revenue > 0 ? { key: busiest.key, revenue: busiest.revenue, orders: busiest.orders } : null,
    },
    periods, items, categories, hours, weekdays, methods, customers,
  };
}

// ---------------------------------------------------------------- CSV (one line per food item)
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const METHOD_NAME = { wallet: 'Wallet', upi_demo: 'UPI QR', cash: 'Cash' };
// Order-level amounts (subtotal / discount / tax / total) are written on the FIRST line of each order only,
// so summing the column in Excel never counts an order twice.
function toCsv(rows) {
  const head = ['Date', 'Time', 'Token', 'Order status', 'Student / customer', 'USN / ID', 'Food item', 'Category', 'Quantity', 'Unit price (INR)', 'Item total (INR)',
    'Special instructions', 'Order subtotal (INR)', 'Discount (INR)', 'Tax (INR)', 'Order total (INR)', 'Payment method', 'Payment status', 'Coupon', 'Counted as sale'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    const list = r.items.length ? r.items : [null];
    list.forEach((i, idx) => {
      const first = idx === 0;
      lines.push([
        r.day, r.time, r.token_number, r.status, r.customer_name, r.customer_id,
        i ? i.name : '', i ? i.category : '', i ? i.quantity : '', i ? i.unit_price.toFixed(2) : '', i ? i.line_total.toFixed(2) : '',
        i ? i.special_instructions || '' : '',
        first ? r.subtotal.toFixed(2) : '', first ? r.discount.toFixed(2) : '', first ? r.tax.toFixed(2) : '', first ? r.total.toFixed(2) : '',
        METHOD_NAME[r.payment_method] || r.payment_method, r.payment_status, first ? r.coupon_code || '' : '', first ? (r.is_sale ? 'yes' : 'no') : '',
      ].map(csvCell).join(','));
    });
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = {
  GROUPS, NOT_A_SALE, isSale, normalizeOrder, filterRows, sortRows, listTotals, buildSummary, toCsv,
  periodOf, periodsBetween, addDays, mondayOf, money,
};
