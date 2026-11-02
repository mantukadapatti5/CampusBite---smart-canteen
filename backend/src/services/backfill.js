// Orders that were paid before the payment ledger existed get a matching ledger row,
// so the manager's transaction analysis is complete. Safe to run on every start.
const { Op } = require('sequelize');

async function backfillTransactions({ Order, Transaction }, log = console.log) {
  const have = new Set((await Transaction.findAll({ where: { type: 'order_payment', order_id: { [Op.ne]: null } }, attributes: ['order_id'], raw: true })).map((r) => r.order_id));
  const haveRefund = new Set((await Transaction.findAll({ where: { type: 'refund', order_id: { [Op.ne]: null } }, attributes: ['order_id'], raw: true })).map((r) => r.order_id));
  const paid = await Order.findAll({ where: { payment_status: { [Op.in]: ['paid', 'refunded'] } } });
  let created = 0;
  for (const o of paid) {
    const method = o.payment_method === 'upi_demo' ? 'upi' : o.payment_method;
    if (!have.has(o.id)) {
      await Transaction.create({
        txn_ref: `TXNL${String(o.id).padStart(8, '0')}`, user_id: o.user_id, order_id: o.id, type: 'order_payment', method,
        direction: 'in', amount: o.total_amount, status: 'success', paid_at: o.created_at, created_at: o.created_at,
        description: `Order ${o.token_number} (earlier order)`,
      });
      created++;
    }
    if (o.payment_status === 'refunded' && !haveRefund.has(o.id)) {
      await Transaction.create({
        txn_ref: `TXNR${String(o.id).padStart(8, '0')}`, user_id: o.user_id, order_id: o.id, type: 'refund',
        method: method === 'cash' ? 'cash' : 'wallet', direction: 'out', amount: o.total_amount, status: 'success',
        paid_at: o.updated_at, created_at: o.updated_at, description: `Refund: order ${o.token_number} (earlier order)`,
      });
      created++;
    }
  }
  if (created) log(`[payments] ledger back-filled with ${created} row(s) for earlier orders.`);
  return created;
}

module.exports = { backfillTransactions };
