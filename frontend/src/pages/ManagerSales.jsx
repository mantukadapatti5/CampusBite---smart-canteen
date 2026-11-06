import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useSocket } from '../context/SocketContext.jsx';
import { Field, Modal } from '../components/TxnBits.jsx';
import { rupee, fmtDateTime, todayStr, addDaysStr } from '../utils/format.js';

// Manager portal -> Sales & Orders.
// Shows WHO ordered WHICH food, for how much, under which token - order by order - and analyses
// the sales per day / week / month / year (revenue, orders, items sold, best sellers, busy hours...).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GROUPS = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];
const FINER = { year: 'month', month: 'day', week: 'day', day: 'day' };
const PRESETS = [
  { key: 'today', label: 'Today', group: 'day', range: () => [todayStr(), todayStr()] },
  { key: 'yesterday', label: 'Yesterday', group: 'day', range: () => [addDaysStr(todayStr(), -1), addDaysStr(todayStr(), -1)] },
  { key: '7', label: 'Last 7 days', group: 'day', range: () => [addDaysStr(todayStr(), -6), todayStr()] },
  { key: '30', label: 'Last 30 days', group: 'day', range: () => [addDaysStr(todayStr(), -29), todayStr()] },
  { key: 'month', label: 'This month', group: 'day', range: () => [`${todayStr().slice(0, 8)}01`, todayStr()] },
  { key: '90', label: 'Last 90 days', group: 'week', range: () => [addDaysStr(todayStr(), -89), todayStr()] },
  { key: 'year', label: 'This year', group: 'month', range: () => [`${todayStr().slice(0, 4)}-01-01`, todayStr()] },
];
const STATUS_OPTIONS = [
  { key: 'all', label: 'All orders' },
  { key: 'sales', label: 'Counted sales only' },
  { key: 'pending', label: 'Pending' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'collected', label: 'Collected' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'rejected', label: 'Rejected' },
];
const METHOD_LABEL = { wallet: 'Wallet', upi_demo: 'UPI QR', cash: 'Cash' };
const STATUS_STYLE = {
  pending: 'bg-white/5 text-paper/60 border-white/15',
  accepted: 'bg-signal/15 text-signal border-signal/30',
  preparing: 'bg-signal/15 text-signal border-signal/30',
  ready: 'bg-leaf/15 text-leaf border-leaf/30',
  collected: 'bg-leaf/15 text-leaf border-leaf/30',
  cancelled: 'bg-chili/15 text-chili border-chili/30',
  rejected: 'bg-chili/15 text-chili border-chili/30',
};
const selectCls = 'bg-panel2 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-paper';

// period keys from the API: day "YYYY-MM-DD", week = its Monday "YYYY-MM-DD", month "YYYY-MM", year "YYYY"
function periodLabel(key, group) {
  if (!key) return '';
  if (group === 'year') return key;
  const [y, m, d] = key.split('-');
  if (group === 'month') return `${MONTHS[Number(m) - 1]} ${y}`;
  const base = `${d} ${MONTHS[Number(m) - 1]} ${y}`;
  return group === 'week' ? `Week of ${base}` : base;
}
function axisLabel(key, group) {
  if (group === 'year') return key;
  const [y, m, d] = key.split('-');
  if (group === 'month') return MONTHS[Number(m) - 1] + (MONTHS[Number(m) - 1] === 'Jan' ? ` ${y.slice(2)}` : '');
  return `${d}/${m}`;
}

function Kpi({ label, value, sub, tone = 'text-signal' }) {
  return (
    <div className="card p-3">
      <p className="text-[11px] text-paper/50">{label}</p>
      <p className={`font-mono text-2xl ${tone}`}>{value}</p>
      {sub && <p className="text-[10px] text-paper/40 mt-0.5">{sub}</p>}
    </div>
  );
}

function OrderStatus({ status }) {
  return (
    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLE[status] || STATUS_STYLE.pending}`}>
      {status}
    </span>
  );
}

// horizontal bars: rows = [{ key, label, value, text }]
function HBars({ rows, color = 'bg-signal' }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (rows.length === 0) return <p className="text-xs text-paper/40">No data in this period.</p>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="flex justify-between text-[11px] text-paper/60 mb-0.5"><span className="truncate pr-2">{r.label}</span><span className="font-mono shrink-0">{r.text}</span></div>
          <div className="h-2 rounded bg-panel2"><div className={`h-2 rounded ${color}`} style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function TrendChart({ periods, group, onPick }) {
  if (periods.length === 0) return <p className="text-xs text-paper/40">No data in this period.</p>;
  const max = Math.max(...periods.map((p) => p.revenue), 1);
  const step = Math.max(1, Math.ceil(periods.length / 14));
  const showValues = periods.length <= 14;
  return (
    <div>
      <div className="flex items-end gap-1 h-44 overflow-x-auto pb-1">
        {periods.map((p) => (
          <button
            type="button"
            key={p.key}
            onClick={() => onPick(p)}
            title={`${periodLabel(p.key, group)}: ${rupee(p.revenue, 0)} from ${p.orders} order(s), ${p.items} item(s) - click to zoom in`}
            className="flex-1 min-w-[16px] h-full flex flex-col items-center justify-end group"
          >
            {showValues && <span className="text-[10px] font-mono text-paper/70 mb-0.5">{p.revenue > 0 ? rupee(p.revenue, 0) : ''}</span>}
            <span
              className="w-full rounded-t bg-signal/70 group-hover:bg-signal transition"
              style={{ height: `${p.revenue > 0 ? Math.max(3, (p.revenue / max) * 100) : 1}%` }}
            />
          </button>
        ))}
      </div>
      <div className="flex gap-1 mt-1 overflow-hidden">
        {periods.map((p, i) => (
          <span key={p.key} className="flex-1 min-w-[16px] text-center text-[9px] text-paper/40 whitespace-nowrap">{i % step === 0 ? axisLabel(p.key, group) : ''}</span>
        ))}
      </div>
    </div>
  );
}

function HourChart({ hours }) {
  if (hours.length === 0) return <p className="text-xs text-paper/40">No data in this period.</p>;
  const max = Math.max(...hours.map((h) => h.orders), 1);
  return (
    <div className="flex items-end gap-1 h-32">
      {hours.map((h) => (
        <div key={h.hour} className="flex-1 min-w-[14px] h-full flex flex-col items-center justify-end" title={`${String(h.hour).padStart(2, '0')}:00 - ${h.orders} order(s), ${rupee(h.revenue, 0)}`}>
          <span className="text-[9px] font-mono text-paper/60">{h.orders || ''}</span>
          <span className="w-full rounded-t bg-leaf/70" style={{ height: `${h.orders > 0 ? Math.max(4, (h.orders / max) * 100) : 1}%` }} />
          <span className="text-[9px] font-mono text-paper/40 mt-0.5">{String(h.hour).padStart(2, '0')}</span>
        </div>
      ))}
    </div>
  );
}

export default function ManagerSales() {
  const { socket } = useSocket() || {};
  const [preset, setPreset] = useState('30');
  const [from, setFrom] = useState(addDaysStr(todayStr(), -29));
  const [to, setTo] = useState(todayStr());
  const [group, setGroup] = useState('day');

  const [status, setStatus] = useState('all');
  const [method, setMethod] = useState('');
  const [itemId, setItemId] = useState('');
  const [sort, setSort] = useState('newest');
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [page, setPage] = useState(1);

  const [summary, setSummary] = useState(null);
  const [list, setList] = useState({ rows: [], total: 0, pages: 1, totals: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [itemSort, setItemSort] = useState('quantity');
  const [showAllItems, setShowAllItems] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => { setQ(qLive); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [qLive]);

  const listFilters = useCallback(() => {
    const f = { from, to };
    if (status !== 'all') f.status = status;
    if (method) f.method = method;
    if (itemId) f.item_id = itemId;
    if (q) f.q = q;
    return f;
  }, [from, to, status, method, itemId, q]);

  const loadSummary = useCallback(async () => {
    try {
      const { data } = await api.get('/sales/summary', { params: { from, to, group } });
      setSummary(data); setError('');
    } catch (err) { setError(err.response?.data?.error || 'Could not load the sales analysis'); }
  }, [from, to, group]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/sales/orders', { params: { ...listFilters(), sort, page, limit: 20 } });
      setList(data); setError('');
    } catch (err) { setError(err.response?.data?.error || 'Could not load the orders'); }
    finally { setLoading(false); }
  }, [listFilters, sort, page]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadList(); }, [loadList]);

  // keep the numbers fresh: instantly when an order is placed / changes, and every 30 seconds as a safety net
  const reload = useCallback(() => { loadSummary(); loadList(); }, [loadSummary, loadList]);
  const reloadRef = useRef(reload);
  useEffect(() => { reloadRef.current = reload; }, [reload]);
  useEffect(() => {
    const t = setInterval(() => reloadRef.current(), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!socket) return undefined;
    let timer = null;
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => reloadRef.current(), 600); };
    socket.on('order:new', soon);
    socket.on('order:updated', soon);
    return () => { clearTimeout(timer); socket.off('order:new', soon); socket.off('order:updated', soon); };
  }, [socket]);

  function choosePreset(p) {
    const [f, t] = p.range();
    setPreset(p.key); setFrom(f); setTo(t); setGroup(p.group); setPage(1);
  }
  function setDates(f, t) { setFrom(f); setTo(t); setPreset('custom'); setPage(1); }

  // click a bar / row: zoom into that period (year -> months, month or week -> days)
  function drill(p) {
    const f = p.from < from ? from : p.from;
    const t = p.to > to ? to : p.to;
    setFrom(f); setTo(t); setPreset('custom'); setGroup(FINER[group]); setPage(1);
  }

  function filterByItem(id) {
    setItemId(String(id)); setPage(1);
    if (listRef.current) listRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function clearFilters() { setStatus('all'); setMethod(''); setItemId(''); setQLive(''); setQ(''); setPage(1); }

  async function exportCsv() {
    try {
      const { data } = await api.get('/sales/export', { params: listFilters(), responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url; a.download = `sales-orders-${from}_to_${to}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError('Could not export the CSV'); }
  }

  const t = summary ? summary.totals : null;
  const items = summary
    ? summary.items.slice().sort((a, b) => (itemSort === 'revenue' ? b.revenue - a.revenue : b.quantity - a.quantity || b.revenue - a.revenue))
    : [];
  const shownItems = showAllItems ? items : items.slice(0, 10);
  const maxItemRevenue = Math.max(...items.map((i) => i.revenue), 1);
  const itemName = itemId ? (summary && summary.items.find((i) => String(i.menu_item_id) === itemId)?.name) || `item #${itemId}` : '';
  const filtersActive = status !== 'all' || method || itemId || q;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h1 className="font-display text-3xl text-paper">Sales & Orders</h1>
        <button onClick={exportCsv} className="btn-ghost text-xs">⬇ Export CSV (food-wise)</button>
      </div>
      <p className="text-xs text-paper/50 mb-4">
        Every order with the student, the food they ordered, the token and the amount — plus sales analysis per day, week, month and year.
      </p>

      {/* ---------- period ---------- */}
      <div className="card p-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => choosePreset(p)} className={`text-xs px-3 py-1.5 rounded-full border ${preset === p.key ? 'border-signal text-signal bg-signal/10' : 'border-white/10 text-paper/60'}`}>{p.label}</button>
          ))}
          <span className="text-xs text-paper/50 ml-2">From</span>
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setDates(e.target.value, to)} className={selectCls} />
          <span className="text-xs text-paper/50">To</span>
          <input type="date" value={to} min={from} max={todayStr()} onChange={(e) => e.target.value && setDates(from, e.target.value)} className={selectCls} />
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-xs text-paper/50">Analyse by</span>
          {GROUPS.map((g) => (
            <button key={g.key} onClick={() => setGroup(g.key)} className={`text-xs px-3 py-1 rounded-lg border ${group === g.key ? 'border-signal text-signal bg-signal/10' : 'border-white/10 text-paper/60'}`}>{g.label}</button>
          ))}
          <span className="text-[11px] text-paper/40 ml-auto">Click a bar to zoom into that {group === 'year' ? 'year' : group === 'month' ? 'month' : group}.</span>
        </div>
      </div>

      {error && <p className="text-chili text-sm mb-3">{error}</p>}
      {summary && summary.truncated && <p className="text-signal text-xs mb-3">Very large range — only the newest 20,000 orders are included. Choose a shorter range for exact figures.</p>}

      {/* ---------- headline numbers ---------- */}
      {t && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <Kpi label="Revenue" value={rupee(t.revenue, 0)} sub={`incl. ${rupee(t.tax, 0)} tax, after ${rupee(t.discount, 0)} discounts`} />
            <Kpi label="Orders" value={t.orders} sub={t.in_progress_orders ? `${t.in_progress_orders} still in progress` : 'paid orders, cancelled ones excluded'} tone="text-paper" />
            <Kpi label="Food items sold" value={t.items_sold} sub="total quantity across all orders" tone="text-leaf" />
            <Kpi label="Average order value" value={rupee(t.avg_order_value, 0)} sub={t.best_period ? `best ${group}: ${periodLabel(t.best_period.key, group)} (${rupee(t.best_period.revenue, 0)})` : 'no sales yet'} tone="text-paper" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Kpi label="Students who ordered" value={t.unique_customers} sub={t.walk_in_orders ? `+ ${t.walk_in_orders} walk-in order(s)` : undefined} tone="text-paper" />
            <Kpi label="Item sales (before tax)" value={rupee(t.subtotal, 0)} sub="price × quantity of every item" tone="text-paper" />
            <Kpi label="Discounts given" value={rupee(t.discount, 0)} tone="text-leaf" />
            <Kpi label="Cancelled / rejected" value={t.cancelled_orders} sub={`${rupee(t.cancelled_amount, 0)} refunded`} tone="text-chili" />
          </div>
        </>
      )}

      {/* ---------- trend ---------- */}
      {summary && (
        <div className="card p-4 mb-4">
          <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
            <h3 className="font-display text-xl text-paper">Revenue per {group}</h3>
            <button className="btn-ghost text-xs" onClick={() => setShowTable(!showTable)}>{showTable ? 'Hide table' : 'Show table'}</button>
          </div>
          <TrendChart periods={summary.periods} group={group} onPick={drill} />
          {showTable && (
            <div className="overflow-auto max-h-80 mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-paper/50 border-b border-white/10">
                    <th className="py-1.5 pr-2">{GROUPS.find((g) => g.key === group).label}</th>
                    <th className="pr-2 text-right">Orders</th><th className="pr-2 text-right">Items sold</th><th className="pr-2 text-right">Avg order</th><th className="text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.periods.slice().reverse().map((p) => (
                    <tr key={p.key} onClick={() => drill(p)} className={`border-b border-white/5 cursor-pointer hover:bg-white/5 ${p.orders ? 'text-paper/80' : 'text-paper/30'}`}>
                      <td className="py-1.5 pr-2">{periodLabel(p.key, group)}</td>
                      <td className="pr-2 text-right font-mono">{p.orders}</td>
                      <td className="pr-2 text-right font-mono">{p.items}</td>
                      <td className="pr-2 text-right font-mono">{rupee(p.avg_order_value, 0)}</td>
                      <td className="text-right font-mono text-signal">{rupee(p.revenue, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ---------- what sold ---------- */}
      {summary && (
        <div className="grid lg:grid-cols-3 gap-4 mb-4">
          <div className="card p-4 lg:col-span-2">
            <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
              <h3 className="font-display text-xl text-paper">Food ordered — item by item</h3>
              <div className="flex gap-1">
                {[['quantity', 'By quantity'], ['revenue', 'By revenue']].map(([k, l]) => (
                  <button key={k} onClick={() => setItemSort(k)} className={`text-[11px] px-2.5 py-1 rounded-lg border ${itemSort === k ? 'border-signal text-signal bg-signal/10' : 'border-white/10 text-paper/60'}`}>{l}</button>
                ))}
              </div>
            </div>
            {items.length === 0 ? <p className="text-xs text-paper/40">No food ordered in this period.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[480px]">
                  <thead>
                    <tr className="text-left text-xs text-paper/50 border-b border-white/10">
                      <th className="py-1.5 pr-2">#</th><th className="pr-2">Food</th><th className="pr-2 text-right">Qty sold</th><th className="pr-2 text-right">In orders</th><th className="pr-2 text-right">Amount</th><th className="w-24 pl-2">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownItems.map((i, idx) => (
                      <tr key={i.menu_item_id} onClick={() => filterByItem(i.menu_item_id)} className="border-b border-white/5 text-paper/80 cursor-pointer hover:bg-white/5" title="Click to list the orders that contain this food">
                        <td className="py-1.5 pr-2 text-paper/40 font-mono text-xs">{idx + 1}</td>
                        <td className="pr-2">{i.name} <span className="text-[10px] text-paper/40">{i.category}</span></td>
                        <td className="pr-2 text-right font-mono text-signal">{i.quantity}</td>
                        <td className="pr-2 text-right font-mono">{i.orders}</td>
                        <td className="pr-2 text-right font-mono">{rupee(i.revenue, 0)}</td>
                        <td className="pl-2"><div className="h-1.5 rounded bg-panel2"><div className="h-1.5 rounded bg-signal" style={{ width: `${(i.revenue / maxItemRevenue) * 100}%` }} /></div><span className="text-[10px] text-paper/40">{i.share_pct}%</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {items.length > 10 && (
              <button className="btn-ghost text-xs mt-3" onClick={() => setShowAllItems(!showAllItems)}>{showAllItems ? 'Show top 10 only' : `Show all ${items.length} items`}</button>
            )}
            <p className="text-[10px] text-paper/30 mt-2">Amount = price × quantity (before discount and tax). Click a food to see every order that contains it.</p>
          </div>

          <div className="space-y-4">
            <div className="card p-4">
              <h3 className="font-display text-lg text-paper mb-2">Best-selling categories</h3>
              <HBars rows={summary.categories.map((c) => ({ key: c.category, label: c.category, value: c.revenue, text: `${rupee(c.revenue, 0)} · ${c.quantity}` }))} color="bg-leaf" />
            </div>
            <div className="card p-4">
              <h3 className="font-display text-lg text-paper mb-2">Paid with</h3>
              <HBars rows={summary.methods.map((m) => ({ key: m.method, label: METHOD_LABEL[m.method] || m.method, value: m.revenue, text: `${rupee(m.revenue, 0)} · ${m.orders}` }))} />
            </div>
          </div>
        </div>
      )}

      {summary && (
        <div className="grid lg:grid-cols-3 gap-4 mb-6">
          <div className="card p-4">
            <h3 className="font-display text-lg text-paper mb-2">Busiest hours <span className="text-[10px] text-paper/40 font-body">orders per hour</span></h3>
            <HourChart hours={summary.hours} />
          </div>
          <div className="card p-4">
            <h3 className="font-display text-lg text-paper mb-2">Busiest weekdays</h3>
            <HBars rows={summary.weekdays.map((w) => ({ key: w.dow, label: w.name, value: w.orders, text: `${w.orders} orders · ${rupee(w.revenue, 0)}` }))} color="bg-leaf" />
          </div>
          <div className="card p-4">
            <h3 className="font-display text-lg text-paper mb-2">Top students</h3>
            {summary.customers.length === 0 ? <p className="text-xs text-paper/40">No student orders in this period.</p> : (
              <ul className="space-y-1.5">
                {summary.customers.map((c, i) => (
                  <li key={c.user_id} className="flex items-center justify-between gap-2 text-sm">
                    <button type="button" className="text-left min-w-0" onClick={() => { setQLive(c.usn_or_id); setPage(1); if (listRef.current) listRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} title="Click to list this student's orders">
                      <span className="block text-paper truncate">{i + 1}. {c.name}</span>
                      <span className="block text-[10px] text-paper/40">{c.usn_or_id} · {c.orders} order(s) · {c.items} item(s)</span>
                    </button>
                    <span className="font-mono text-signal shrink-0">{rupee(c.spent, 0)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ---------- order by order ---------- */}
      <div ref={listRef} className="scroll-mt-4">
        <h2 className="font-display text-2xl text-paper mb-1">Orders — who ordered what</h2>
        <p className="text-xs text-paper/50 mb-3">Each line is one order: the student, the food with quantities, the token and the amount paid.</p>
      </div>
      <div className="card p-3 mb-3 flex flex-wrap items-center gap-2">
        <input value={qLive} onChange={(e) => setQLive(e.target.value)} placeholder="Search token, student, USN or food (e.g. T-284, bread omelette)…" className={`${selectCls} flex-1 min-w-[200px]`} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={selectCls}>
          {STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }} className={selectCls}>
          <option value="">All payment methods</option>
          {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className={selectCls}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="amount">Highest amount</option>
        </select>
        {itemId && (
          <button onClick={() => { setItemId(''); setPage(1); }} className="text-xs px-2.5 py-1 rounded-full border border-signal text-signal bg-signal/10">Food: {itemName} ✕</button>
        )}
        {filtersActive && <button onClick={clearFilters} className="text-xs text-signal">Clear filters</button>}
      </div>

      {list.totals && (
        <p className="text-xs text-paper/50 mb-2">
          {list.total} order(s) listed · {list.totals.sales_orders} counted as sales · {rupee(list.totals.sales_revenue)} · {list.totals.items_sold} item(s)
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="text-left text-[11px] text-paper/50 border-b border-white/10">
              <th className="p-2">Token</th><th>Date & time</th><th>Student</th><th>Food ordered</th><th className="text-right">Amount</th><th className="pl-3">Payment</th><th className="pl-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r.id} onClick={() => setSelected(r)} className="border-b border-white/5 hover:bg-white/5 cursor-pointer text-paper/80 align-top">
                <td className="p-2"><span className="flap-digit px-2 py-0.5 text-xs">{r.token_number}</span></td>
                <td className="text-xs py-2 whitespace-nowrap">{r.day.slice(8)} {MONTHS[Number(r.day.slice(5, 7)) - 1]} {r.day.slice(0, 4)}<span className="block text-[10px] text-paper/40">{r.time}</span></td>
                <td className="py-2"><span className="block text-xs text-paper">{r.customer_name}</span><span className="block text-[10px] text-paper/40">{r.customer_id}</span></td>
                <td className="py-2 pr-2">
                  {r.items.map((i, idx) => (
                    <span key={idx} className="block text-xs">{i.name} <span className="font-mono text-signal">× {i.quantity}</span>{i.special_instructions ? <span className="text-[10px] text-paper/40"> ({i.special_instructions})</span> : null}</span>
                  ))}
                </td>
                <td className={`text-right font-mono py-2 ${r.is_sale ? 'text-paper' : 'text-paper/40 line-through'}`}>{rupee(r.total)}</td>
                <td className="pl-3 py-2 text-xs">{METHOD_LABEL[r.payment_method] || r.payment_method}</td>
                <td className="pl-3 py-2"><OrderStatus status={r.status} /></td>
              </tr>
            ))}
            {!loading && list.rows.length === 0 && <tr><td colSpan={7} className="text-center text-paper/40 py-10">No orders match these filters.</td></tr>}
            {loading && list.rows.length === 0 && <tr><td colSpan={7} className="text-center text-paper/40 py-10">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-3 text-xs text-paper/60">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn-ghost text-xs disabled:opacity-40">← Previous</button>
        <span>Page {list.page || page} of {list.pages}</span>
        <button disabled={page >= list.pages} onClick={() => setPage(page + 1)} className="btn-ghost text-xs disabled:opacity-40">Next →</button>
      </div>
      <p className="text-[10px] text-paper/30 mt-3">Cancelled and rejected orders are refunded, so they are listed (struck through) but never added to revenue.</p>

      {selected && (
        <Modal title={`Order ${selected.token_number}`} onClose={() => setSelected(null)}>
          <Field label="Student / customer">{selected.customer_name}</Field>
          <Field label="USN / ID">{selected.customer_id}</Field>
          <Field label="Ordered at">{fmtDateTime(selected.created_at)}</Field>
          <Field label="Status"><OrderStatus status={selected.status} /></Field>
          <Field label="Payment">{METHOD_LABEL[selected.payment_method] || selected.payment_method} · {selected.payment_status}</Field>
          {selected.slot_time && <Field label="Pickup slot">{selected.slot_date} {selected.slot_time}</Field>}
          {selected.counter_number && <Field label="Counter">#{selected.counter_number}</Field>}

          <p className="text-xs text-paper/50 mt-3 mb-1">Food ordered</p>
          <table className="w-full text-sm mb-2">
            <thead>
              <tr className="text-left text-[11px] text-paper/50 border-b border-white/10"><th className="py-1">Item</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Total</th></tr>
            </thead>
            <tbody>
              {selected.items.map((i, idx) => (
                <tr key={idx} className="border-b border-white/5 text-paper/80">
                  <td className="py-1">{i.name}{i.special_instructions && <span className="block text-[10px] text-signal/80">↳ {i.special_instructions}</span>}</td>
                  <td className="text-right font-mono">{i.quantity}</td>
                  <td className="text-right font-mono">{rupee(i.unit_price)}</td>
                  <td className="text-right font-mono">{rupee(i.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Field label="Subtotal"><span className="font-mono">{rupee(selected.subtotal)}</span></Field>
          {selected.discount > 0 && <Field label={`Discount${selected.coupon_code ? ` (${selected.coupon_code})` : ''}`}><span className="font-mono">−{rupee(selected.discount)}</span></Field>}
          {selected.tax > 0 && <Field label="Tax"><span className="font-mono">{rupee(selected.tax)}</span></Field>}
          <Field label="Total paid"><span className="font-mono text-signal">{rupee(selected.total)}</span></Field>
          {!selected.is_sale && <p className="text-xs text-chili mt-2">This order was {selected.status} and refunded, so it is not counted in revenue.</p>}
        </Modal>
      )}
    </div>
  );
}
