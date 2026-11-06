# Manager portal → Sales & Orders

Shows the manager **who ordered which food, how many, for how much and under which token**, and analyses
sales per **day / week / month / year**. Open it from the sidebar: **🧾 Sales & Orders** (`/manager/sales`).
Managers and admins only (students and kitchen staff get 403).

## What the page shows
| Section | Details |
|---|---|
| Period | Today, Yesterday, 7 / 30 / 90 days, This month, This year, or any custom dates. "Analyse by" Day / Week / Month / Year. |
| Headline cards | Revenue, orders, food items sold, average order value, students who ordered, item sales before tax, discounts, cancelled / refunded. |
| Revenue trend | Bar chart per day / week / month / year (+ table). Click a bar or row to zoom in (year → months, month/week → days). |
| Food ordered | Every food with quantity sold, number of orders, amount and share. Click a food to list the orders that contain it. |
| Categories, payment methods, busiest hours, busiest weekdays, top students | Click a student to list their orders. |
| **Orders – who ordered what** | One row per order: **token, date/time, student name + USN, each food × quantity, amount, payment method, status**. Search by token / student / USN / food (e.g. "bread omelette"), filter by status, payment method or food, sort, paginate. Click a row for the full bill (price per item, special instructions, discount, tax, pickup slot, counter). |
| Export | **⬇ Export CSV** – one line per food item, opens in Excel. Uses the same filters. |

The page refreshes by itself when an order is placed or changes (socket) and every 30 seconds.

## Definitions
* **Sale** = `payment_status = paid` and status is not `cancelled` / `rejected` (those are refunded).
* **Food amount** = price at the time of ordering × quantity (before discount and tax).
* **Order amount / revenue** = order total (after discount, incl. tax).
* Days, weeks (Monday start), months and years use the canteen time zone `APP_TZ` (default `Asia/Kolkata`).

## API (manager / admin token)
* `GET /api/sales/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&group=day|week|month|year`
* `GET /api/sales/orders?from&to&status=all|sales|<status>&method=&item_id=&q=&sort=newest|oldest|amount&page=&limit=`
* `GET /api/sales/export?...` (CSV)

Default range is the last 30 days; max 10 years; at most 20,000 orders per request.

## Related fixes made so the numbers agree
* Dashboard "revenue today" and Reports now count only paid, non-cancelled orders, and "today" / report days use the canteen time zone.
* Managers now receive live `order:new` / `order:updated` socket events.

## Tests
`cd backend && npm run test:sales` (offline, no database needed).
