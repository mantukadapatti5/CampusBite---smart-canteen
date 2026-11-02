import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import { rupee } from '../utils/format.js';

// Public page opened by scanning the QR code - plays the role of the customer's UPI app.
// (In production this whole page is replaced by a real UPI app / payment gateway.)
export default function PayGateway() {
  const { token } = useParams();
  const [pay, setPay] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const { data } = await api.get(`/payments/pay/${token}`); setPay(data); setError(''); }
    catch (err) { setError(err.response?.data?.error || 'This payment link is not valid'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function act(action, body) {
    setBusy(true);
    try { const { data } = await api.post(`/payments/pay/${token}/${action}`, body || {}); setPay(data); }
    catch (err) { setError(err.response?.data?.error || 'Payment error'); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-ink">
      <div className="w-full max-w-sm">
        <div className="text-center mb-4">
          <p className="font-display text-2xl text-signal">CampusBite</p>
          <p className="text-xs text-paper/50">Demo UPI payment</p>
        </div>
        <div className="card p-6 text-center">
          {error && !pay && <><div className="text-4xl mb-2">⚠️</div><p className="text-chili">{error}</p></>}
          {!pay && !error && <p className="text-paper/50">Loading…</p>}

          {pay && pay.status === 'pending' && (
            <>
              <p className="text-xs text-paper/50">Paying</p>
              <p className="text-paper font-medium">{pay.merchant}</p>
              <p className="font-mono text-5xl text-signal my-4">{rupee(pay.amount)}</p>
              <p className="text-xs text-paper/50 mb-5">{pay.type === 'wallet_topup' ? 'Wallet top-up' : 'Canteen order'} · {pay.txn_ref}</p>
              <button disabled={busy} onClick={() => act('confirm')} className="btn-primary w-full text-base">{busy ? 'Processing…' : `Pay ${rupee(pay.amount, 0)}`}</button>
              <button disabled={busy} onClick={() => act('fail', { reason: 'Payment declined by you' })} className="btn-ghost w-full mt-2 text-sm">Decline</button>
              <p className="text-[11px] text-paper/30 mt-4">Demo mode: no real money is moved.</p>
            </>
          )}
          {pay && pay.status === 'success' && (
            <>
              <div className="text-6xl mb-2">✅</div>
              <p className="text-leaf text-xl font-semibold">Payment successful</p>
              <p className="font-mono text-3xl text-signal my-3">{rupee(pay.amount)}</p>
              <p className="text-xs text-paper/50">UPI ref {pay.upi_ref}</p>
              {pay.order_token && <p className="text-sm text-paper mt-3">Order token <span className="flap-digit px-2 py-1">{pay.order_token}</span></p>}
              <p className="text-xs text-paper/50 mt-4">You can go back to the canteen app — it has already updated.</p>
            </>
          )}
          {pay && ['failed', 'expired', 'cancelled'].includes(pay.status) && (
            <>
              <div className="text-6xl mb-2">{pay.status === 'failed' ? '❌' : '⌛'}</div>
              <p className="text-chili text-xl font-semibold">{pay.status === 'failed' ? 'Payment failed' : pay.status === 'expired' ? 'Payment expired' : 'Payment cancelled'}</p>
              <p className="text-sm text-paper/70 mt-2">{pay.failure_reason}</p>
              <p className="text-xs text-paper/50 mt-3">No money was taken. Start again from the canteen app.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
