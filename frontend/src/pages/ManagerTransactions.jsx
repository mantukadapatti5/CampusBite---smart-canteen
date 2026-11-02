import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import { TYPE_LABEL, METHOD_LABEL, STATUS_LABEL, StatusBadge, Field, Modal } from '../components/TxnBits.jsx';
import { rupee, fmtShort, fmtDateTime, todayStr, addDaysStr } from '../utils/format.js';

const PRESETS = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
];
const selectCls = 'bg-panel2 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-paper';

function Kpi({ label, value, sub, tone = 'text-signal' }) {
  return (
    <div className="card p-3">
      <p className="text-[11px] text-paper/50">{label}</p>
      <p className={`font-mono text-2xl ${tone}`}>{value}</p>
      {sub && <p className="text-[10px] text-paper/40 mt-0.5">{sub}</p>}
    </div>
  );
}

function Bars({ data, labelOf, color = 'bg-signal' }) {
  const max = Math.max(...data.map((d) => d.amount), 1);
  if (data.length === 0) return <p className="text-xs text-paper/40">No data in this period.</p>;
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.key}>
          <div className="flex justify-between text-[11px] text-paper/60 mb-0.5"><span>{labelOf(d.key)}</span><span className="font-mono">{rupee(d.amount, 0)} · {d.count}</span></div>
          <div className="h-2 rounded bg-panel2"><div className={`h-2 rounded ${color}`} style={{ width: `${(d.amount / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function DailyChart({ daily }) {
  if (daily.length === 0) return <p className="text-xs text-paper/40">No successful transactions in this period.</p>;
  const max = Math.max(...daily.flatMap((d) => [d.orders_amount, d.topups, d.refunds]), 1);
  const step = Math.ceil(daily.length / 12);
  return (
    <div>
      <div className="flex items-end gap-1 h-36 overflow-x-auto">
        {daily.map((d) => (
          <div key={d.date} className="flex-1 min-w-[22px] flex items-end justify-center gap-[2px] h-full" title={`${d.date}: orders ${rupee(d.orders_amount, 0)} (${d.orders_count}), top-ups ${rupee(d.topups, 0)}, refunds ${rupee(d.refunds, 0)}`}>
            <div className="w-1/3 bg-signal rounded-t" style={{ height: `${Math.max(2, (d.orders_amount / max) * 100)}%` }} />
            <div className="w-1/3 bg-leaf rounded-t" style={{ height: `${Math.max(2, (d.topups / max) * 100)}%` }} />
            <div className="w-1/3 bg-chili rounded-t" style={{ height: `${Math.max(2, (d.refunds / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1">
        {daily.map((d, i) => <span key={d.date} className="flex-1 min-w-[22px] text-center text-[9px] text-paper/40">{i % step === 0 ? d.date.slice(5) : ''}</span>)}
      </div>
      <p className="text-[10px] text-paper/50 mt-2"><span className="text-signal">■</span> Order payments &nbsp;<span className="text-leaf">■</span> Wallet top-ups &nbsp;<span className="text-chili">■</span> Refunds</p>
    </div>
  );
}

export default function ManagerTransactions() {
  const [preset, setPreset] = useState('30');
  const [from, setFrom] = useState(addDaysStr(todayStr(), -29));
  const [to, setTo] = useState(todayStr());
  const [type, setType] = useState('');
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState(null);
  const [list, setList] = useState({ rows: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { const t = setTimeout(() => { setQ(qLive); setPage(1); }, 400); return () => clearTimeout(t); }, [qLive]);

  function choosePreset(p) {
    setPreset(p.key); setPage(1);
    setTo(todayStr()); setFrom(addDaysStr(todayStr(), -(p.days - 1)));
  }

  const filters = useCallback(() => {
    const f = { from, to };
    if (type) f.type = type; if (method) f.method = method; if (status) f.status = status; if (q) f.q = q;
    return f;
  }, [from, to, type, method, status, q]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [s, l] = await Promise.all([
        api.get('/transactions/summary', { params: { from, to } }),
        api.get('/transactions', { params: { ...filters(), page, limit: 20 } }),
      ]);
      setSummary(s.data); setList(l.data);
    } catch (err) { setError(err.response?.data?.error || 'Could not load transactions'); }
    finally { setLoading(false); }
  }, [from, to, filters, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]); // keep the numbers fresh

  async function exportCsv() {
    const { data } = await api.get('/transactions/export', { params: filters(), responseType: 'blob' });
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url; a.download = `transactions-${from}_to_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const t = summary?.totals;
  const reset = (setter) => (e) => { setter(e.target.value); setPage(1); };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h1 className="font-display text-3xl text-paper">Transactions</h1>
        <button onClick={exportCsv} className="btn-ghost text-xs">⬇ Export CSV</button>
      </div>
      <p className="text-xs text-paper/50 mb-4">All payments, wallet top-ups and refunds — money received, money returned and every failed attempt.</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {PRESETS.map((p) => (
          <button key={p.key} onClick={() => choosePreset(p)} className={`text-xs px-3 py-1.5 rounded-full border ${preset === p.key ? 'border-signal text-signal bg-signal/10' : 'border-white/10 text-paper/60'}`}>{p.label}</button>
        ))}
        <span className="text-xs text-paper/50 ml-2">From</span>
        <input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPreset('custom'); setPage(1); }} className={selectCls} />
        <span className="text-xs text-paper/50">To</span>
        <input type="date" value={to} min={from} max={todayStr()} onChange={(e) => { setTo(e.target.value); setPreset('custom'); setPage(1); }} className={selectCls} />
      </div>

      {error && <p className="text-chili text-sm mb-3">{error}</p>}

      {t && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <Kpi label="Money received" value={rupee(t.money_in, 0)} sub="UPI order payments + wallet top-ups + counter cash" tone="text-leaf" />
            <Kpi label="Order revenue" value={rupee(t.order_revenue, 0)} sub={`${t.orders_paid} paid orders · avg ${rupee(t.avg_order_value, 0)}`} />
            <Kpi label="Refunds (money out)" value={rupee(t.refunds, 0)} sub={`${rupee(t.refunded_to_wallet, 0)} back to wallets · ${rupee(t.money_out, 0)} cash`} tone="text-chili" />
            <Kpi label="Net revenue" value={rupee(t.net_revenue, 0)} sub="order revenue − refunds" tone="text-paper" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Kpi label="Wallet top-ups" value={rupee(t.topups, 0)} tone="text-leaf" />
            <Kpi label="Wallet balances held" value={rupee(t.wallet_liability, 0)} sub="owed to students (all time)" tone="text-paper" />
            <Kpi label="Failed / expired payments" value={t.failed_count} sub={`${rupee(t.failed_amount, 0)} not collected${t.pending_count ? ` · ${t.pending_count} waiting` : ''}`} tone="text-chili" />
            <Kpi label="Payment success rate" value={t.success_rate == null ? '—' : `${t.success_rate}%`} sub={`${t.successful} successful of ${t.transactions} records`} tone="text-paper" />
          </div>

          <div className="grid lg:grid-cols-3 gap-3 mb-4">
            <div className="card p-4 lg:col-span-2">
              <h3 className="font-display text-lg text-paper mb-2">Daily money flow</h3>
              <DailyChart daily={summary.daily} />
            </div>
            <div className="card p-4 space-y-4">
              <div>
                <h3 className="font-display text-lg text-paper mb-2">Orders by payment method</h3>
                <Bars data={summary.by_method.map((m) => ({ key: m.method, amount: m.amount, count: m.count }))} labelOf={(k) => METHOD_LABEL[k] || k} />
              </div>
              <div>
                <h3 className="font-display text-lg text-paper mb-2">Why payments failed</h3>
                {summary.failure_reasons.length === 0 ? <p className="text-xs text-paper/40">No failures 🎉</p> : (
                  <ul className="text-xs text-paper/70 space-y-1">
                    {summary.failure_reasons.map((f) => <li key={f.reason} className="flex justify-between gap-2"><span className="truncate">{f.reason}</span><span className="font-mono">{f.count}</span></li>)}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="card p-3 mb-3 flex flex-wrap items-center gap-2">
        <input value={qLive} onChange={(e) => setQLive(e.target.value)} placeholder="Search ID, student, USN, order token…" className={`${selectCls} flex-1 min-w-[180px]`} />
        <select value={type} onChange={reset(setType)} className={selectCls}><option value="">All types</option>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={method} onChange={reset(setMethod)} className={selectCls}><option value="">All methods</option>{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={status} onChange={reset(setStatus)} className={selectCls}><option value="">All statuses</option><option value="failed_all">Failed / expired / cancelled</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <span className="text-xs text-paper/40 ml-auto">{list.total} record(s)</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="text-left text-[11px] text-paper/50 border-b border-white/10">
              <th className="p-2">Transaction</th><th>Date & time</th><th>Customer</th><th>Type</th><th>Method</th><th>Order</th><th className="text-right">Amount</th><th className="pl-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r.id} onClick={() => setSelected(r)} className="border-b border-white/5 hover:bg-white/5 cursor-pointer text-paper/80">
                <td className="p-2 font-mono text-xs">{r.txn_ref}</td>
                <td className="text-xs">{fmtShort(r.created_at)}</td>
                <td><span className="block text-xs text-paper">{r.customer_name || '—'}</span><span className="block text-[10px] text-paper/40">{r.customer_id}</span></td>
                <td className="text-xs">{TYPE_LABEL[r.type]}</td>
                <td className="text-xs">{METHOD_LABEL[r.method]}</td>
                <td className="text-xs font-mono">{r.order_token || '—'}</td>
                <td className={`text-right font-mono ${r.status !== 'success' ? 'text-paper/40 line-through' : r.direction === 'out' ? 'text-chili' : r.direction === 'in' ? 'text-leaf' : 'text-paper'}`}>
                  {r.status === 'success' ? (r.direction === 'out' ? '−' : r.direction === 'in' ? '+' : '') : ''}{rupee(r.amount)}
                </td>
                <td className="pl-3"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {!loading && list.rows.length === 0 && <tr><td colSpan={8} className="text-center text-paper/40 py-10">No transactions match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-3 text-xs text-paper/60">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn-ghost text-xs disabled:opacity-40">← Previous</button>
        <span>Page {page} of {list.pages}</span>
        <button disabled={page >= list.pages} onClick={() => setPage(page + 1)} className="btn-ghost text-xs disabled:opacity-40">Next →</button>
      </div>
      <p className="text-[10px] text-paper/30 mt-3">“Money received” does not count wallet-paid orders again — that money was already counted when the wallet was topped up.</p>

      {selected && (
        <Modal title="Transaction details" onClose={() => setSelected(null)}>
          <Field label="Transaction ID"><span className="font-mono">{selected.txn_ref}</span></Field>
          <Field label="Customer">{selected.customer_name} ({selected.customer_id})</Field>
          <Field label="Type">{TYPE_LABEL[selected.type]}</Field>
          <Field label="Amount"><span className="font-mono">{rupee(selected.amount)}</span></Field>
          <Field label="Money flow">{selected.direction === 'in' ? 'Received by the canteen' : selected.direction === 'out' ? 'Returned to the customer' : 'Internal (no cash moved)'}</Field>
          <Field label="Method">{METHOD_LABEL[selected.method]}</Field>
          <Field label="Status"><StatusBadge status={selected.status} /></Field>
          <Field label="Created">{fmtDateTime(selected.created_at)}</Field>
          {selected.paid_at && <Field label="Completed">{fmtDateTime(selected.paid_at)}</Field>}
          {selected.upi_ref && <Field label="UPI reference"><span className="font-mono">{selected.upi_ref}</span></Field>}
          {selected.wallet_balance_after != null && <Field label="Wallet balance after"><span className="font-mono">{rupee(selected.wallet_balance_after)}</span></Field>}
          {selected.order_token && <Field label="Order">{selected.order_token} ({selected.order_status})</Field>}
          {selected.description && <Field label="Note">{selected.description}</Field>}
          {selected.failure_reason && <Field label="Failure reason">{selected.failure_reason}</Field>}
        </Modal>
      )}
    </div>
  );
}
