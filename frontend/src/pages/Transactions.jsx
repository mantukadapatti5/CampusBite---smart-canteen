import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useSocket } from '../context/SocketContext.jsx';
import { TYPE_LABEL, TYPE_ICON, METHOD_LABEL, StatusBadge, Field, Modal } from '../components/TxnBits.jsx';
import { rupee, fmtShort, fmtDateTime } from '../utils/format.js';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'order_payment', label: 'Orders' },
  { key: 'wallet_topup', label: 'Top-ups' },
  { key: 'refund', label: 'Refunds' },
  { key: 'failed_all', label: 'Failed' },
];

function Stat({ label, value, tone = 'text-signal' }) {
  return (
    <div className="card p-3 text-center">
      <p className="text-[11px] text-paper/50">{label}</p>
      <p className={`font-mono text-xl ${tone}`}>{value}</p>
    </div>
  );
}

export default function Transactions() {
  const { socket } = useSocket();
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const params = useCallback((p) => {
    const q = { page: p, limit: 15 };
    if (filter === 'failed_all') q.status = 'failed_all'; else if (filter !== 'all') q.type = filter;
    if (from) q.from = from;
    if (to) q.to = to;
    return q;
  }, [filter, from, to]);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const { data } = await api.get('/transactions/mine', { params: params(p) });
      setRows((prev) => (p === 1 ? data.rows : [...prev, ...data.rows]));
      setPage(data.page); setPages(data.pages); setTotal(data.total);
    } finally { setLoading(false); }
  }, [params]);

  const loadSummary = useCallback(() => api.get('/transactions/mine/summary').then(({ data }) => setSummary(data)).catch(() => {}), []);

  useEffect(() => { load(1); }, [load]);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => {
    if (!socket) return undefined;
    const refresh = () => { load(1); loadSummary(); };
    socket.on('payment:update', refresh);
    return () => socket.off('payment:update', refresh);
  }, [socket, load, loadSummary]);

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-display text-3xl text-paper mb-1">My transactions</h1>
      <p className="text-xs text-paper/50 mb-4">Every payment, top-up and refund — including attempts that failed.</p>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Stat label="Wallet balance" value={rupee(summary.wallet_balance, 0)} />
          <Stat label="Total spent" value={rupee(summary.total_spent, 0)} tone="text-paper" />
          <Stat label="Money added" value={rupee(summary.total_added, 0)} tone="text-leaf" />
          <Stat label="Refunded" value={rupee(summary.total_refunded, 0)} tone="text-leaf" />
        </div>
      )}
      {summary && summary.total_spent > 0 && (
        <p className="text-[11px] text-paper/40 mb-3">
          Spent: {rupee(summary.spent_by_wallet, 0)} from wallet · {rupee(summary.spent_by_upi, 0)} by UPI QR
          {summary.failed_count > 0 && ` · ${summary.failed_count} payment attempt(s) did not complete`}
        </p>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`text-xs px-3 py-1.5 rounded-full border ${filter === f.key ? 'border-signal text-signal bg-signal/10' : 'border-white/10 text-paper/60'}`}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-paper/60">
        From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="bg-panel2 border border-white/10 rounded-lg px-2 py-1 text-paper" />
        To <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="bg-panel2 border border-white/10 rounded-lg px-2 py-1 text-paper" />
        {(from || to) && <button onClick={() => { setFrom(''); setTo(''); }} className="text-signal">Clear dates</button>}
        <span className="ml-auto text-paper/40">{total} transaction(s)</span>
      </div>

      <div className="space-y-2">
        {rows.map((t) => {
          const ok = t.status === 'success';
          const credit = t.type !== 'order_payment';
          return (
            <button key={t.id} onClick={() => setSelected(t)} className="card p-3 w-full text-left flex items-center gap-3 hover:border-signal/40">
              <span className="text-2xl">{TYPE_ICON[t.type]}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-paper">{TYPE_LABEL[t.type]}{t.order_token ? ` · ${t.order_token}` : ''}</span>
                <span className="block text-[11px] text-paper/50 truncate">{fmtShort(t.created_at)} · {METHOD_LABEL[t.method]} · {t.txn_ref}</span>
                {!ok && t.failure_reason && <span className="block text-[11px] text-chili/80 truncate">{t.failure_reason}</span>}
              </span>
              <span className="text-right">
                <span className={`block font-mono ${!ok ? 'text-paper/40 line-through' : credit ? 'text-leaf' : 'text-paper'}`}>{ok ? (credit ? '+' : '−') : ''}{rupee(t.amount)}</span>
                <StatusBadge status={t.status} />
              </span>
            </button>
          );
        })}
        {!loading && rows.length === 0 && <p className="text-center text-paper/40 py-10">No transactions found.</p>}
      </div>
      {page < pages && <button disabled={loading} onClick={() => load(page + 1)} className="btn-ghost w-full mt-3">{loading ? 'Loading…' : 'Load more'}</button>}

      {selected && (
        <Modal title="Transaction details" onClose={() => setSelected(null)}>
          <Field label="Transaction ID"><span className="font-mono">{selected.txn_ref}</span></Field>
          <Field label="Type">{TYPE_LABEL[selected.type]}</Field>
          <Field label="Amount"><span className="font-mono">{rupee(selected.amount)}</span></Field>
          <Field label="Paid with">{METHOD_LABEL[selected.method]}</Field>
          <Field label="Status"><StatusBadge status={selected.status} /></Field>
          <Field label="Date & time">{fmtDateTime(selected.created_at)}</Field>
          {selected.paid_at && <Field label="Completed at">{fmtDateTime(selected.paid_at)}</Field>}
          {selected.upi_ref && <Field label="UPI reference"><span className="font-mono">{selected.upi_ref}</span></Field>}
          {selected.wallet_balance_after != null && <Field label="Wallet balance after"><span className="font-mono">{rupee(selected.wallet_balance_after)}</span></Field>}
          {selected.order_token && <Field label="Order">{selected.order_token} ({selected.order_status})</Field>}
          {selected.description && <Field label="Note">{selected.description}</Field>}
          {selected.failure_reason && <Field label="Reason">{selected.failure_reason}</Field>}
          {selected.order_id && <Link to={`/student/orders/${selected.order_id}`} className="btn-primary block text-center text-sm mt-4">Open order</Link>}
        </Modal>
      )}
    </div>
  );
}
