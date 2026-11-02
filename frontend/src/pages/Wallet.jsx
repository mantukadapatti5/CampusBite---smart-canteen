import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { TYPE_LABEL, TYPE_ICON, StatusBadge } from '../components/TxnBits.jsx';
import { rupee, fmtShort } from '../utils/format.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Wallet() {
  const { user, refreshUser } = useAuth();
  const [amount, setAmount] = useState('');
  const [redeemPoints, setRedeemPoints] = useState('');
  const [error, setError] = useState('');
  const [redeemError, setRedeemError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [recent, setRecent] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/transactions/mine', { params: { limit: 5 } }).then(({ data }) => setRecent(data.rows)).catch(() => {});
  }, []);

  async function topUp(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // money is added only after the UPI QR payment succeeds
      const { data } = await api.post('/payments/topup', { amount: Number(amount), return_origin: window.location.origin });
      navigate(`/student/pay/${data.payment.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Top-up failed');
    } finally {
      setLoading(false);
    }
  }

  async function redeem(e) {
    e.preventDefault();
    setRedeemError('');
    try {
      await api.post('/wallet/redeem-points', { points: Number(redeemPoints) });
      await refreshUser();
      setRedeemPoints('');
    } catch (err) {
      setRedeemError(err.response?.data?.error || 'Redemption failed');
    }
  }

  function copyReferral() {
    navigator.clipboard.writeText(user?.referral_code || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="max-w-sm mx-auto space-y-4">
      <h1 className="font-display text-3xl text-paper mb-2">College Wallet</h1>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4 text-center">
          <p className="text-xs text-paper/50 mb-1">Balance</p>
          <p className="font-mono text-3xl text-signal">₹{Number(user?.wallet_balance || 0).toFixed(0)}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-paper/50 mb-1">Reward points</p>
          <p className="font-mono text-3xl text-signal">{user?.reward_points || 0}</p>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-display text-lg text-paper mb-2">Add money</h3>
        <p className="text-[11px] text-paper/40 mb-3">
          Pay by scanning a UPI QR code. The money is added to your wallet only after the payment succeeds.
        </p>
        <form onSubmit={topUp} className="flex gap-2">
          <input
            type="number" min="10" max="5000" step="1" required
            value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount (₹10 – ₹5000)"
            className="flex-1 bg-panel2 border border-white/10 rounded-lg px-3 py-2 text-paper text-sm outline-none focus:border-signal"
          />
          <button type="submit" disabled={loading} className="btn-primary text-sm px-4">
            {loading ? 'Please wait…' : 'Pay by QR'}
          </button>
        </form>
        {error && <p className="text-chili text-xs mt-2">{error}</p>}
        <div className="flex gap-2 mt-3">
          {[50, 100, 200, 500].map((v) => (
            <button key={v} onClick={() => setAmount(String(v))} className="btn-ghost text-xs px-3 py-1">₹{v}</button>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-display text-lg text-paper">Recent activity</h3>
          <Link to="/student/transactions" className="text-xs text-signal">View all →</Link>
        </div>
        {recent.length === 0 && <p className="text-xs text-paper/40">No transactions yet.</p>}
        {recent.map((t) => (
          <div key={t.id} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
            <div className="min-w-0">
              <p className="text-sm text-paper truncate">{TYPE_ICON[t.type]} {TYPE_LABEL[t.type]}</p>
              <p className="text-[10px] text-paper/40">{fmtShort(t.created_at)}</p>
            </div>
            <div className="text-right">
              <p className={`font-mono text-sm ${t.status !== 'success' ? 'text-paper/40' : t.type === 'order_payment' ? 'text-paper' : 'text-leaf'}`}>
                {t.status === 'success' ? (t.type === 'order_payment' ? '−' : '+') : ''}{rupee(t.amount, 0)}
              </p>
              <StatusBadge status={t.status} />
            </div>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <h3 className="font-display text-lg text-paper mb-2">Redeem points</h3>
        <p className="text-[11px] text-paper/40 mb-3">10 points = ₹1 wallet credit.</p>
        <form onSubmit={redeem} className="flex gap-2">
          <input
            type="number" min="1" required
            value={redeemPoints} onChange={(e) => setRedeemPoints(e.target.value)}
            placeholder="Points to redeem"
            className="flex-1 bg-panel2 border border-white/10 rounded-lg px-3 py-2 text-paper text-sm outline-none focus:border-signal"
          />
          <button type="submit" className="btn-primary text-sm px-4">Redeem</button>
        </form>
        {redeemError && <p className="text-chili text-xs mt-2">{redeemError}</p>}
      </div>

      <div className="card p-4">
        <h3 className="font-display text-lg text-paper mb-2">Your referral code</h3>
        <p className="text-[11px] text-paper/40 mb-3">
          Share this — when a friend registers with it, you both get 50 bonus points.
        </p>
        <div className="flex gap-2">
          <span className="flap-digit px-3 py-2 flex-1 text-center">{user?.referral_code}</span>
          <button onClick={copyReferral} className="btn-ghost text-xs px-3">{copied ? 'Copied!' : 'Copy'}</button>
        </div>
      </div>
    </div>
  );
}
