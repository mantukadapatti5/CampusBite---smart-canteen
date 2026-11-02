// Small database helpers shared by the payment controllers.
const { Op } = require('sequelize');
const { Transaction, User } = require('../models');

// pending UPI sessions older than their expiry become 'expired' (so lists never show a dead "pending")
async function expireStale() {
  await Transaction.update(
    { status: 'expired', failure_reason: 'Payment window expired - no money was taken', payload: null },
    { where: { status: 'pending', expires_at: { [Op.lt]: new Date() } } }
  );
}
const walletLiability = async () => Number((await User.sum('wallet_balance')) || 0);

module.exports = { expireStale, walletLiability };
