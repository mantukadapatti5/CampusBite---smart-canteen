import React from 'react';

export const TYPE_LABEL = { order_payment: 'Order payment', wallet_topup: 'Wallet top-up', refund: 'Refund', points_redeem: 'Points redeemed' };
export const TYPE_ICON = { order_payment: '🍽️', wallet_topup: '➕', refund: '↩️', points_redeem: '⭐' };
export const METHOD_LABEL = { upi: 'UPI QR', wallet: 'Wallet', cash: 'Cash', reward_points: 'Reward points' };
export const STATUS_LABEL = { success: 'Success', pending: 'Waiting for payment', failed: 'Failed', expired: 'Expired', cancelled: 'Cancelled' };
const STATUS_STYLE = {
  success: 'bg-leaf/15 text-leaf border-leaf/30',
  pending: 'bg-signal/15 text-signal border-signal/30',
  failed: 'bg-chili/15 text-chili border-chili/30',
  expired: 'bg-white/5 text-paper/50 border-white/15',
  cancelled: 'bg-white/5 text-paper/50 border-white/15',
};

export function StatusBadge({ status }) {
  return (
    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLE[status] || STATUS_STYLE.expired}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export function Field({ label, children }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-white/5 text-sm">
      <span className="text-paper/50">{label}</span>
      <span className="text-paper text-right break-all">{children ?? '—'}</span>
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card p-5 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-3">
          <h3 className="font-display text-xl text-paper">{title}</h3>
          <button onClick={onClose} className="text-paper/50 hover:text-paper text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
