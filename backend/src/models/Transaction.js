const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

// Payment ledger: one row per money event. Every payment ATTEMPT is stored
// (success, failed, expired, cancelled) so students and the manager can see
// exactly what happened. An order row is only ever created after the
// payment row reaches 'success'.
const Transaction = sequelize.define('Transaction', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  // human-readable id shown in the UI, e.g. TXN261030K7QX2M
  txn_ref: { type: DataTypes.STRING, allowNull: false, unique: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  order_id: { type: DataTypes.INTEGER, allowNull: true },
  type: {
    // order_payment: paying for an order | wallet_topup: adding money to the wallet
    // refund: money returned for a cancelled/rejected order | points_redeem: reward points -> wallet
    type: DataTypes.ENUM('order_payment', 'wallet_topup', 'refund', 'points_redeem'),
    allowNull: false,
  },
  // upi = paid by scanning the QR code, wallet = college wallet, cash = counter cash (walk-in orders)
  method: { type: DataTypes.ENUM('upi', 'wallet', 'cash', 'reward_points'), allowNull: false },
  // from the CANTEEN's point of view: in = money received, out = money returned, internal = no cash moved
  direction: { type: DataTypes.ENUM('in', 'out', 'internal'), allowNull: false },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  status: {
    type: DataTypes.ENUM('pending', 'success', 'failed', 'expired', 'cancelled'),
    allowNull: false,
    defaultValue: 'pending',
  },
  failure_reason: { type: DataTypes.STRING, allowNull: true },
  upi_ref: { type: DataTypes.STRING, allowNull: true },          // 12-digit UPI reference (UTR)
  pay_token: { type: DataTypes.STRING, allowNull: true, unique: true }, // secret in the QR link, pending UPI sessions only
  expires_at: { type: DataTypes.DATE, allowNull: true },
  paid_at: { type: DataTypes.DATE, allowNull: true },
  wallet_balance_after: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  description: { type: DataTypes.STRING, allowNull: true },
  // cart snapshot + QR image for a pending UPI order payment (cleared when finished)
  payload: { type: DataTypes.JSONB, allowNull: true },
}, {
  tableName: 'transactions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Transaction;
