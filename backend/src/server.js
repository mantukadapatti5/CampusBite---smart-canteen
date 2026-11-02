require('./config/env'); // must be first: .env + safe defaults (JWT_SECRET, DB_*)
const http = require('http');
const bcrypt = require('bcryptjs');
const app = require('./app');
const sequelize = require('./config/db');
const { initSocket } = require('./websocket/io');
const models = require('./models'); // registers associations
const { ensureDemoData } = require('./seed/demoData');
const { seedDemoHistory } = require('./seed/demoHistory');
const { backfillTransactions } = require('./services/backfill');
const mlService = require('./ml/mlService');

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await sequelize.authenticate();
    console.log('Database connected.');

    // sync() is fine for a college project / demo; use proper migrations
    // (sequelize-cli) if this ever goes to production.
    await sequelize.sync();
    console.log('Models synced.');

    // Payment ledger: give earlier paid orders a transaction row (idempotent)
    try { await backfillTransactions(models); } catch (e) { console.error('Ledger back-fill failed (server keeps running):', e.message); }

    // Make sure the demo accounts (all four portals) and the starter menu exist.
    // Create-if-missing only: it never wipes or overwrites existing data unless
    // RESET_DEMO_PASSWORDS=true, which repairs the demo accounts' passwords.
    if (process.env.AUTO_SEED !== 'false') {
      try {
        const r = await ensureDemoData({
          models, hash: bcrypt.hash, compare: bcrypt.compare,
          resetPasswords: process.env.RESET_DEMO_PASSWORDS === 'true',
        });
        console.log(`Demo data ready (accounts created: ${r.accounts_created}, repaired: ${r.accounts_repaired}, menu items seeded: ${r.items}).`);
        if (process.env.SEED_DEMO_HISTORY === 'true') await seedDemoHistory({ models });
      } catch (e) {
        console.error('Demo data setup failed (server keeps running):', e.message);
      }
    }

    // Socket.io needs the raw http server (not the express app) so it can
    // upgrade HTTP connections to WebSocket connections on the same port.
    const httpServer = http.createServer(app);
    initSocket(httpServer);

    httpServer.listen(PORT, () => {
      console.log(`Smart Canteen API + WebSocket running on port ${PORT}`);
      mlService.init(); // load the trained ML models (trains automatically if none exist)
    });
  } catch (err) {
    console.error('Unable to start server:', err);
    process.exit(1);
  }
}

start();
