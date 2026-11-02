// `npm run seed` - FULL RESET (wipes every table, then re-creates demo data).
// You normally do not need this any more: the server creates missing demo
// accounts and starter data by itself when it starts.
require('../config/env');
const bcrypt = require('bcryptjs');
const sequelize = require('../config/db');
const models = require('../models');
const { ensureDemoData } = require('./demoData');

async function seed() {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ force: true }); // WARNING: wipes existing data, demo-only
    console.log('Tables reset.');
    const r = await ensureDemoData({ models, hash: bcrypt.hash, compare: bcrypt.compare, resetPasswords: true });
    console.log(`Demo users created: ${r.accounts_created} (STUDENT1/STUDENT12, KITCHEN1/KITCHEEN12, MANAGER/MANAGER12, ADMIN1/ADMIN12 + 3 alternates)`);
    console.log(`Seeded ${r.categories} categories with ${r.items} menu items, ${r.coupons} coupons, settings and an announcement.`);
    console.log('Seeding complete.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
}

seed();
