import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import { useCart } from '../context/CartContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { rupee } from '../utils/format.js';

// The QR payment screen. The order (or wallet credit) only exists once this
// screen reports "Payment successful"; every other outcome leaves nothing behind.
export default function PaymentSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { clearCart } = useCart();
  const { refreshUser } = useAuth();
  const { socket } = useSocket();
  const [pay, setPay] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(null);
  const handled = useRef(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/payments/${id}`);
      setPay(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load this payment');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // poll while waiting, and react instantly to the socket event
  useEffect(() => {
    if (!pay || pay.status !== 'pending') return undefined;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [pay?.status, load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!socket) return undefined;
    socket.on('payment:update', load);
    return () => socket.off('payment:update', load);
  }, [socket, load]);

  useEffect(() => {
    if (!pay?.expires_at || pay.status !== 'pending') { setLeft(null); return undefined; }
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(pay.expires_at) - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pay?.expires_at, pay?.status]);

  // success: clear the cart / refresh wallet, then open the order
  useEffect(() => {
    if (!pay || pay.status !== 'success' || handled.current) return undefined;
    handled.current = true;
    refreshUser();
    if (pay.type === 'order_payment') {
      clearCart();
      const t = setTimeout(() => navigate(`/student/orders/${pay.order_id}`), 2200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [pay, clearCart, navigate, refreshUser]);

  async function demo(action, body) {
    setBusy(true);
    try {
      await api.post(`/payments/pay/${pay.pay_token}/${action}`, body || {});
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Gateway error');
    } finally { setBusy(false); }
  }

  async function cancel() {
    setBusy(true);
    try { await api.post(`/payments/${id}/cancel`); await load(); } finally { setBusy(false); }
  }

  if (error && !pay) return <p className="text-chili text-center mt-16">{error}</p>;
  if (!pay) return <p className="text-paper/50 text-center mt-16">Loading payment…</p>;

  const isTopup = pay.type === 'wallet_topup';
  const mm = left != null ? `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}` : '';

  return (
    <div className="max-w-sm mx-auto">
      <h1 className="font-display text-3xl text-paper mb-1">{isTopup ? 'Add money to wallet' : 'Pay for your order'}</h1>
      <p className="text-xs text-paper/50 mb-4">Transaction {pay.txn_ref}</p>

      <div className="card p-5 text-center">
        <p className="text-xs text-paper/50">Amount to pay</p>
        <p className="font-mono text-4xl text-signal mb-3">{rupee(pay.amount)}</p>

        {pay.status === 'pending' && (
          <>
            <img src={pay.qr_data_url} alt="UPI payment QR code" className="mx-auto w-56 h-56 bg-white rounded-xl p-2" />
            <p className="text-sm text-paper mt-3">Scan this QR code with your phone camera or any UPI app</p>
            <p className="text-xs text-paper/50 mt-1">to pay {pay.merchant}</p>
            <p className={`font-mono text-lg mt-3 ${left != null && left < 60 ? 'text-chili' : 'text-paper'}`}>⏱ {mm}</p>
            <p className="text-[11px] text-paper/40">Waiting for payment… this screen updates by itself.</p>

            {pay.demo_gateway && (
              <div className="mt-4 pt-4 border-t border-white/10 text-left">
                <p className="text-[11px] text-paper/40 mb-2">Demo payment gateway — no real money moves. Simulate what the UPI app would do:</p>
                <div className="grid grid-cols-2 gap-2">
                  <button disabled={busy} onClick={() => demo('confirm')} className="btn-primary text-xs">✓ Simulate payment success</button>
                  <button disabled={busy} onClick={() => demo('fail', { reason: 'Payment declined at the UPI app' })} className="btn-ghost text-xs">✕ Simulate failure</button>
                </div>
                <a href={pay.pay_url} target="_blank" rel="noreferrer" className="block text-center text-xs text-signal mt-3 underline">
                  Open the payment page (what your phone shows after scanning)
                </a>
              </div>
            )}
            <button disabled={busy} onClick={cancel} className="text-xs text-paper/50 hover:text-chili mt-4">Cancel payment</button>
          </>
        )}

        {pay.status === 'success' && (
          <div className="py-4">
            <div className="text-5xl mb-2">✅</div>
            <p className="text-leaf font-semibold text-lg">Payment successful</p>
            <p className="text-xs text-paper/50 mt-1">UPI ref {pay.upi_ref}</p>
            {isTopup ? (
              <>
                <p className="text-sm text-paper mt-3">New wallet balance: <span className="font-mono text-signal">{rupee(pay.wallet_balance_after)}</span></p>
                <div className="flex gap-2 justify-center mt-4">
                  <Link to="/student/menu" className="btn-primary text-sm">Order food</Link>
                  <Link to="/student/transactions" className="btn-ghost text-sm">View transactions</Link>
                </div>
              </>
            ) : (
              <p className="text-sm text-paper mt-3">Your order has been placed — opening it now…</p>
            )}
          </div>
        )}

        {['failed', 'expired', 'cancelled'].includes(pay.status) && (
          <div className="py-4">
            <div className="text-5xl mb-2">{pay.status === 'failed' ? '❌' : '⌛'}</div>
            <p className="text-chili font-semibold text-lg">
              {pay.status === 'failed' ? 'Payment failed' : pay.status === 'expired' ? 'Payment expired' : 'Payment cancelled'}
            </p>
            <p className="text-sm text-paper/70 mt-2">{pay.failure_reason}</p>
            <p className="text-xs text-paper/50 mt-1">{isTopup ? 'Your wallet was not changed.' : 'No order was placed and you were not charged.'}</p>
            <div className="flex gap-2 justify-center mt-4">
              {isTopup
                ? <Link to="/student/wallet" className="btn-primary text-sm">Try again</Link>
                : <Link to="/student/cart" className="btn-primary text-sm">Back to cart</Link>}
              <Link to="/student/transactions" className="btn-ghost text-sm">Transactions</Link>
            </div>
          </div>
        )}
      </div>
      {error && <p className="text-chili text-xs mt-2 text-center">{error}</p>}
    </div>
  );
}
