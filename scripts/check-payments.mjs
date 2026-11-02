// End-to-end smoke test of the payment system against a RUNNING server.
// Usage:  node scripts/check-payments.mjs [apiBase]       (Node 18+)
// It places a wallet order, makes a QR payment succeed and another one fail, tops up the wallet,
// cancels an order (refund) and checks the student's and the manager's transaction views.
const base = (process.argv[2] || 'http://localhost:5000/api').replace(/\/+$/, '');
let failed = 0;
const ok = (m) => console.log('  PASS  ' + m);
const bad = (m) => { failed++; console.log('  FAIL  ' + m); };
const check = (c, m) => (c ? ok(m) : bad(m));
async function j(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data };
}
const login = async (u, p) => (await j('/auth/login', { method: 'POST', body: { usn_or_id: u, password: p } })).data;

console.log(`Payment checks against ${base}\n`);
const s = await login('student1', 'STUDENT12'); const m = await login('manager', 'MANAGER12'); const k = await login('kitchen1', 'KITCHEEN12');
if (!s?.token || !m?.token || !k?.token) { console.log('Cannot log in with the demo accounts - run: node scripts/check-login.mjs'); process.exit(1); }
const menu = (await j('/menu')).data; const items = (Array.isArray(menu) ? menu : []).flatMap((c) => c.items || []).filter((i) => i.is_available && (i.stock_quantity == null || i.stock_quantity < 0 || i.stock_quantity > 5));
const item = items[0]; const cart = [{ menu_item_id: item.id, quantity: 1 }];
console.log(`Using menu item "${item.name}" (₹${item.price})\n`);

console.log('Bill');
const q = await j('/payments/quote', { method: 'POST', token: s.token, body: { items: cart } });
check(q.status === 200 && q.data.total >= Number(item.price), `quote includes tax: ₹${q.data?.subtotal} + ₹${q.data?.tax} = ₹${q.data?.total}`);
const total = q.data.total;

console.log('\nTop-up by QR');
let w = (await j('/wallet', { token: s.token })).data; const start = Number(w.wallet_balance);
const t1 = await j('/payments/topup', { method: 'POST', token: s.token, body: { amount: 200, return_origin: 'http://localhost:4173' } });
check(t1.status === 202 && t1.data.payment.qr_data_url?.startsWith('data:image'), 'QR session created (HTTP 202) with a QR image');
check(Number((await j('/wallet', { token: s.token })).data.wallet_balance) === start, 'wallet NOT credited before the payment');
const tok1 = t1.data.payment.pay_token;
const c1 = await j(`/payments/pay/${tok1}/confirm`, { method: 'POST' });
check(c1.data?.status === 'success' && /^\d{12}$/.test(c1.data.upi_ref || ''), `payment confirmed, UPI ref ${c1.data?.upi_ref}`);
check(Number((await j('/wallet', { token: s.token })).data.wallet_balance) === start + 200, 'wallet credited after the payment (+₹200)');

console.log('\nWallet order');
const o1 = await j('/payments/checkout', { method: 'POST', token: s.token, body: { items: cart, method: 'wallet' } });
check(o1.status === 201 && o1.data.payment_status === 'paid', `order ${o1.data?.token_number} placed and paid from the wallet`);

console.log('\nQR order - success');
const p2 = await j('/payments/checkout', { method: 'POST', token: s.token, body: { items: cart, method: 'upi', return_origin: 'http://localhost:4173' } });
check(p2.status === 202, 'QR session created, no order yet');
const before = (await j('/orders/mine', { token: s.token })).data.length;
const c2 = await j(`/payments/pay/${p2.data.payment.pay_token}/confirm`, { method: 'POST' });
check(c2.data?.status === 'success' && c2.data.order_token, `paid -> order ${c2.data?.order_token} created`);
check((await j('/orders/mine', { token: s.token })).data.length === before + 1, 'exactly one order added');

console.log('\nQR order - failure');
const p3 = await j('/payments/checkout', { method: 'POST', token: s.token, body: { items: cart, method: 'upi', return_origin: 'http://localhost:4173' } });
const f3 = await j(`/payments/pay/${p3.data.payment.pay_token}/fail`, { method: 'POST', body: { reason: 'Test decline' } });
check(f3.data?.status === 'failed', 'declined payment marked failed');
check((await j('/orders/mine', { token: s.token })).data.length === before + 1, 'NO order was created for the failed payment');

console.log('\nInsufficient wallet');
const big = await j('/payments/checkout', { method: 'POST', token: s.token, body: { items: [{ menu_item_id: item.id, quantity: 50 }], method: 'wallet' } });
check([400, 402].includes(big.status), `rejected (HTTP ${big.status}): ${big.data?.error}`);

console.log('\nRefund');
const cancel = await j(`/orders/${o1.data.id}/status`, { method: 'PATCH', token: k.token, body: { status: 'cancelled' } });
check(cancel.status === 200, 'kitchen cancelled the wallet order');
const mine = (await j('/transactions/mine?limit=50', { token: s.token })).data;
check(mine.rows.some((r) => r.type === 'refund' && r.status === 'success'), 'refund appears in the student ledger');
check(mine.rows.some((r) => r.status === 'failed'), 'failed attempts appear in the student ledger');

console.log('\nManager view');
const sum = await j('/transactions/summary', { token: m.token });
check(sum.status === 200 && sum.data.totals.transactions > 0, `summary: money in ₹${sum.data.totals?.money_in}, revenue ₹${sum.data.totals?.order_revenue}, refunds ₹${sum.data.totals?.refunds}, failed ${sum.data.totals?.failed_count}`);
check((await j('/transactions?limit=5', { token: m.token })).data.rows.length > 0, 'manager can list all transactions');
check((await j('/transactions', { token: s.token })).status === 403, 'student is blocked from the manager transaction list (403)');
const csv = await fetch(base + '/transactions/export', { headers: { Authorization: `Bearer ${m.token}` } });
check(csv.status === 200 && (await csv.text()).includes('Transaction ID'), 'CSV export works');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL PAYMENT CHECKS PASSED');
process.exit(failed ? 1 : 0);
