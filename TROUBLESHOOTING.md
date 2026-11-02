# CampusBite – Login troubleshooting

## 1. Start the project (no manual seed step any more)
```
docker compose up --build        (Windows: double-click start.bat)
```
Wait until the backend prints:
```
Database connected.
Models synced.
Demo data ready (accounts created: 7, ...)
Smart Canteen API + WebSocket running on port 5000
```
Then open **http://localhost:4174** and click one of the **demo portal buttons** on the login page.

| Portal | USN / ID | Password |
|---|---|---|
| Student | `student1` | `STUDENT12` |
| Kitchen | `kitchen1` | `KITCHEEN12` (two E's) |
| Manager | `manager` | `MANAGER12` |
| Admin | `admin1` | `ADMIN12` |

Passwords are case-sensitive; the USN/ID is not.

## 2. Check everything automatically
```
node scripts/check-login.mjs
```
It tests the server, the database, all four logins, role protection and a wrong password, and tells you what is wrong.

## 3. Read the message on the login page
| Message | Meaning | Fix |
|---|---|---|
| "Server offline – cannot reach …" | The browser cannot reach the backend | Start Docker; open http://localhost:5001/api/health ; run `docker compose ps` (all 3 services must be *running*) |
| "Server online, but there are no accounts yet" | Empty database | Restart the backend: `docker compose restart backend` |
| "Wrong USN/ID or password" | Typed credentials wrong | Use the demo buttons; check Caps Lock |
| "Server error … (HTTP 500)" | Backend problem | `docker compose logs backend` |
| "Your session expired or was reset" | Old saved login after a reset | Log in again |

## 4. Still failing?
```
docker compose down -v      # deletes the database volume
docker compose up --build   # (or double-click reset-and-start.bat)
docker compose logs backend # send me these lines if it still fails
```
Docker Compose publishes the frontend/backend/Postgres on host ports 4174/5001/5433 to avoid conflicts with common development services. If one is already in use, change the left-hand port number in `docker-compose.yml`.

## 5. Opening the site from a phone / another PC
Use `http://<your-PC-IP>:4174`. The frontend now detects this and calls the API on `http://<your-PC-IP>:5001/api` automatically. Make sure your firewall allows ports 4174 and 5001.

## 6. Running without Docker
```
cd backend && npm install && npm run dev     # .env is provided; defaults work with the docker Postgres (see README)
cd frontend && npm install && npm run dev
```
The backend now creates the demo accounts itself on start-up (`AUTO_SEED=true`). `npm run seed` still exists but **wipes** the database.

## 7. Before a real deployment
Set `RESET_DEMO_PASSWORDS: "false"`, change `JWT_SECRET`, and change or delete the 7 demo accounts.


## 8. Payments
* QR screen says "Payment expired" – the QR is valid for 5 minutes; start again from the cart.
* Scanned the QR with a phone but the page does not open – the phone must reach `http://<your-PC-IP>:4174` and
  `:5001` (same Wi-Fi, firewall allows both). On the same PC use the **Simulate payment success** button.
* "Insufficient wallet balance" – add money in **Wallet → Add money** (QR) or choose **UPI QR** in the cart.
* Check everything: `node scripts/check-payments.mjs`.
