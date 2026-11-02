const { sequelize, User, Transaction } = require('../models');
const { makeTxnRef } = require('../services/paymentService');

const POINTS_TO_RUPEE = 10; // 10 reward points = ₹1 wallet credit

exports.getBalance = async (req, res) => {
  const user = await User.findByPk(req.user.id, { attributes: ['wallet_balance', 'reward_points'] });
  res.json(user);
};

// Adding money now goes through a UPI QR payment: the wallet is credited only after the
// payment succeeds (see paymentController). This route is kept as an alias.
exports.topUp = (req, res) => require('./paymentController').topup(req, res);

// Convert reward points into wallet credit. Simple fixed rate — no
// external loyalty platform, just an internal ledger on the User row.
exports.redeemPoints = async (req, res) => {
  const { points } = req.body;
  const value = Number(points);
  if (!Number.isInteger(value) || value <= 0) {
    return res.status(400).json({ error: 'Enter a whole, positive number of points to redeem' });
  }

  const t = await sequelize.transaction();
  try {
    const user = await User.findByPk(req.user.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (user.reward_points < value) {
      await t.rollback();
      return res.status(400).json({ error: `You only have ${user.reward_points} points` });
    }
    const credit = value / POINTS_TO_RUPEE;
    await user.decrement('reward_points', { by: value, transaction: t });
    await user.increment('wallet_balance', { by: credit, transaction: t });
    await user.reload({ transaction: t });
    await Transaction.create({
      txn_ref: makeTxnRef(), user_id: user.id, type: 'points_redeem', method: 'reward_points', direction: 'internal',
      amount: credit, status: 'success', paid_at: new Date(), wallet_balance_after: Number(user.wallet_balance),
      description: `${value} reward points redeemed`,
    }, { transaction: t });
    await t.commit();
    res.json({ wallet_balance: user.wallet_balance, reward_points: user.reward_points });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: 'Could not redeem points' });
  }
};
