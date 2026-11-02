import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api/client';
import { queueOrder } from '../utils/offlineQueue';
import { rupee } from '../utils/format.js';

export default function Cart() {
  const { items, addItem, decreaseItem, removeItem, clearCart, setInstructions, total } = useCart();
  const { user, refreshUser } = useAuth();
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [couponInfo, setCouponInfo] = useState(null);
  const [couponError, setCouponError] = useState('');
  const [method, setMethod] = useState('upi'); // 'upi' = pay by scanning a QR code, 'wallet' = college wallet
  const [scheduleLater, setScheduleLater] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const navigate = useNavigate();
  const wallet = Number(user?.wallet_balance || 0);

  async function applyCoupon() {
    setCouponError('');
    setCouponInfo(null);
    if (!couponCode.trim()) return;
    try {
      const { data } = await api.get('/coupons/validate', { params: { code: couponCode.trim(), subtotal: total } });
      setCouponInfo(data);
    } catch (err) {
      setCouponError(err.response?.data?.error || 'Could not validate coupon');
    }
  }

  // The exact bill (including tax) comes from the server, so the amount on screen is the amount charged.
  const itemsKey = JSON.stringify(items.map((i) => [i.id, i.quantity]));
  useEffect(() => {
    if (items.length === 0 || !navigator.onLine) return undefined;
    const t = setTimeout(async () => {
      try {
        const { data } = await api.post('/payments/quote', {
          items: items.map((i) => ({ menu_item_id: i.id, quantity: i.quantity })),
          coupon_code: couponInfo ? couponInfo.code : undefined,
        });
        setQuote(data); setQuoteError('');
      } catch (err) {
        setQuote(null); setQuoteError(err.response?.data?.error || '');
      }
    }, 300);
    return () => clearTimeout(t);
  }, [itemsKey, couponInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  const payable = quote ? quote.total : total;
  const walletShort = method === 'wallet' && quote && wallet < quote.total;

  async function pay() {
    setError('');
    setPlacing(true);
    const payload = {
      items: items.map((i) => ({ menu_item_id: i.id, quantity: i.quantity, special_instructions: i.special_instructions || undefined })),
      coupon_code: couponInfo ? couponInfo.code : undefined,
      method,
      scheduled_for: scheduleLater && scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      return_origin: window.location.origin,
    };

    // Wallet orders can wait in the offline queue; a QR payment needs a live connection.
    if (!navigator.onLine) {
      if (method === 'wallet') { queueOrder(payload); clearCart(); setPlacing(false); navigate('/student/orders'); return; }
      setError('You are offline. QR payment needs an internet connection — or pay from your wallet and the order will be sent when you are back online.');
      setPlacing(false);
      return;
    }

    try {
      const { data } = await api.post('/payments/checkout', payload);
      if (data.payment_required) {
        navigate(`/student/pay/${data.payment.id}`); // order is created only after the QR is paid
        return;
      }
      clearCart();
      await refreshUser();
      navigate(`/student/orders/${data.id}`);
    } catch (err) {
      if (!err.response && method === 'wallet') {
        queueOrder(payload); clearCart(); navigate('/student/orders'); return;
      }
      setError(err.response?.data?.error || 'Could not complete the payment');
      if (err.response?.status === 402) refreshUser();
    } finally {
      setPlacing(false);
    }
  }

  if (items.length === 0) {
    return <p className="text-paper/50 text-center mt-16">Your order is empty. Go add something tasty.</p>;
  }

  const option = (key, title, sub) => (
    <button
      type="button"
      onClick={() => setMethod(key)}
      className={`text-left p-3 rounded-lg border ${method === key ? 'border-signal bg-signal/10' : 'border-white/10'}`}
    >
      <p className={`text-sm font-medium ${method === key ? 'text-signal' : 'text-paper'}`}>{title}</p>
      <p className="text-[11px] text-paper/50 mt-0.5">{sub}</p>
    </button>
  );

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="font-display text-3xl text-paper mb-4">Your order</h1>

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="card p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-paper font-medium">{item.name}</p>
                <p className="text-xs text-paper/50">₹{item.price} x {item.quantity}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => decreaseItem(item.id)} className="btn-ghost px-2 py-1 text-sm">−</button>
                <span className="font-mono text-signal w-6 text-center">{item.quantity}</span>
                <button onClick={() => addItem(item)} className="btn-ghost px-2 py-1 text-sm">+</button>
                <button onClick={() => removeItem(item.id)} className="text-chili text-xs ml-2">Remove</button>
              </div>
            </div>
            <input
              value={item.special_instructions || ''}
              onChange={(e) => setInstructions(item.id, e.target.value)}
              placeholder="Special instructions (e.g. less spicy, no onion)"
              className="w-full mt-2 bg-panel2 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-paper outline-none focus:border-signal"
            />
          </div>
        ))}
      </div>

      <div className="card p-4 mt-4">
        <label className="block text-xs text-paper/60 mb-1">Coupon code</label>
        <div className="flex gap-2">
          <input
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
            placeholder="e.g. WELCOME10"
            className="flex-1 bg-panel2 border border-white/10 rounded-lg px-3 py-2 text-paper text-sm outline-none focus:border-signal uppercase"
          />
          <button onClick={applyCoupon} className="btn-ghost text-xs px-3">Apply</button>
        </div>
        {couponError && <p className="text-chili text-xs mt-2">{couponError}</p>}
        {couponInfo && <p className="text-leaf text-xs mt-2">"{couponInfo.code}" applied — {couponInfo.discount_percent}% off</p>}
      </div>

      <div className="card p-4 mt-4">
        <label className="flex items-center gap-2 text-xs text-paper/60">
          <input type="checkbox" checked={scheduleLater} onChange={(e) => setScheduleLater(e.target.checked)} />
          Schedule for later instead of next available slot
        </label>
        {scheduleLater && (
          <input
            type="datetime-local"
            value={scheduledFor}
            min={new Date(Date.now() + 15 * 60000).toISOString().slice(0, 16)}
            onChange={(e) => setScheduledFor(e.target.value)}
            className="w-full mt-2 bg-panel2 border border-white/10 rounded-lg px-3 py-2 text-paper text-sm outline-none focus:border-signal"
          />
        )}
      </div>

      <div className="card p-4 mt-4">
        <p className="text-xs text-paper/60 mb-2">How do you want to pay?</p>
        <div className="grid grid-cols-2 gap-2">
          {option('upi', '📱 Pay by UPI QR', 'Scan a QR code, order is placed after payment')}
          {option('wallet', `💳 College wallet (${rupee(wallet, 0)})`, 'Instant, paid from your balance')}
        </div>
        {walletShort && (
          <p className="text-[11px] text-chili mt-2">
            Your wallet has {rupee(wallet)} but this order needs {rupee(quote.total)}.{' '}
            <Link to="/student/wallet" className="underline text-signal">Add money</Link> or choose UPI QR.
          </p>
        )}
        <p className="text-[11px] text-paper/40 mt-2">The order reaches the kitchen only after the payment succeeds. If a payment fails, no order is placed and nothing is charged.</p>
      </div>

      <div className="card p-4 mt-4 space-y-1">
        <div className="flex justify-between text-sm text-paper/60">
          <span>Subtotal</span>
          <span className="font-mono">{rupee(quote ? quote.subtotal : total)}</span>
        </div>
        {quote && quote.discount > 0 && (
          <div className="flex justify-between text-sm text-leaf"><span>Discount</span><span className="font-mono">−{rupee(quote.discount)}</span></div>
        )}
        {quote && quote.tax > 0 && (
          <div className="flex justify-between text-sm text-paper/60"><span>Tax ({quote.tax_percent}%)</span><span className="font-mono">{rupee(quote.tax)}</span></div>
        )}
        <div className="flex justify-between text-lg font-semibold text-paper pt-2 border-t border-white/10 mt-2">
          <span>Total to pay</span>
          <span className="font-mono text-signal">{rupee(payable)}</span>
        </div>
      </div>

      {(quoteError || error) && <p className="text-chili text-sm mt-3">{error || quoteError}</p>}

      <button
        onClick={pay}
        disabled={placing || !!quoteError || walletShort || (scheduleLater && !scheduledFor)}
        className="btn-primary w-full mt-4"
      >
        {placing ? 'Please wait…' : method === 'upi' ? `Continue to QR payment · ${rupee(payable)}` : `Pay ${rupee(payable)} from wallet & place order`}
      </button>
    </div>
  );
}
