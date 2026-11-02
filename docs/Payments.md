# CampusBite – Payment system (for the report / viva)

## Rules the system enforces
1. **No payment → no order.** An order row is created only after its payment is *secured*:
   wallet payments debit the wallet inside the **same database transaction** as the order;
   QR payments create the order only when the payment is confirmed.
2. **Every attempt is recorded** in the `transactions` ledger – success, failed, expired, cancelled and refunds.
3. **Nothing is half-done.** If anything fails while an order is being created (sold out, price changed,
   database error) the transaction is rolled back and the payment is marked *failed – no money was taken*.
4. **Refunds go to the wallet** (wallet *and* UPI payments); walk-in cash orders are refunded in cash.

## Payment methods
| Method | Who | How |
|---|---|---|
| **UPI QR** | student/staff | cart → "Pay by UPI QR" → QR code (valid 5 min) → scan → pay → order is created |
| **College wallet** | student/staff | instant; insufficient balance → declined (HTTP 402) and logged as a failed payment |
| **Wallet top-up** | student/staff | wallet page → amount (₹10–₹5000) → UPI QR → wallet credited only after the payment succeeds |
| **Cash** | canteen staff (walk-in orders) | recorded as a successful cash transaction when the order is typed in |
| Reward points | student | 10 points = ₹1 added to the wallet (ledger row, no cash moved) |

The QR encodes a link to the **demo UPI gateway page** (`/pay/<secret-token>`). Scanning it with a phone
opens a page that behaves like a UPI app (Pay / Decline). On the same computer the QR screen also has
"Simulate payment success / failure" buttons. In production this page is replaced by a real gateway
(Razorpay / PhonePe / bank UPI) whose webhook calls the same confirm step. No real money moves.

## Data model – table `transactions`
`txn_ref` (e.g. TXN261030K7QX2M) · `user_id` · `order_id` · `type` (order_payment, wallet_topup, refund, points_redeem) ·
`method` (upi, wallet, cash, reward_points) · `direction` (in / out / internal) · `amount` · `status`
(pending, success, failed, expired, cancelled) · `failure_reason` · `upi_ref` (12-digit UTR) · `wallet_balance_after` ·
`pay_token`, `expires_at`, `payload` (only while a QR payment is pending) · timestamps.

## API (62 → 76 endpoints)
| Endpoint | Access | Purpose |
|---|---|---|
| POST /api/payments/quote | logged in | exact bill incl. tax and coupon |
| POST /api/payments/checkout | logged in | `method: wallet` → order (201) · `method: upi` → QR session (202) |
| POST /api/payments/topup | logged in | start a wallet top-up QR session (alias: POST /api/wallet/topup) |
| GET /api/payments/:id | owner | poll a QR session |
| POST /api/payments/:id/cancel | owner | cancel a pending payment |
| GET /api/payments/pay/:token | public (secret link) | gateway page data |
| POST /api/payments/pay/:token/confirm · /fail | public (secret link) | demo gateway: approve / decline |
| GET /api/transactions/mine · /mine/summary | logged in | student's ledger and totals |
| GET /api/transactions · /summary · /export | manager, admin | all transactions, analytics, CSV |
| GET /api/transactions/:id | owner, manager, admin | one transaction |

## Manager analytics (Manager portal → Transactions)
Money received · order revenue (+ average order) · refunds (money out) · net revenue · wallet top-ups · wallet balances held ·
failed/expired payments · payment success rate · daily money-flow chart · orders by method · failure reasons ·
searchable/filterable table (type, method, status, dates, ID/student/USN/order token) · details dialog · CSV export.
"Money received" counts UPI order payments + wallet top-ups + counter cash; wallet-paid orders are *not* counted again
(that money was counted when the wallet was topped up).

## Student portal → Transactions
Wallet balance, total spent (wallet vs UPI), money added, refunds, failed attempts; filters (All / Orders / Top-ups /
Refunds / Failed) and date range; detail dialog with UPI reference and balance after; link to the order.

## Also fixed while building this
Quantities must be whole numbers 1–50 (negative / zero / fractional quantities were accepted before); the cart now shows tax,
so the amount on screen equals the amount charged; managers can open orders and invoices; invoices show tax; the seat is
reserved only after the payment is secured; paid orders from before this feature get a ledger row automatically.

## Tests
`npm run test:payments` – 36 offline tests (no database needed) · `node scripts/check-payments.mjs` – live end-to-end check.
