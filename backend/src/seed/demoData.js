// Single source of truth for the demo accounts and starter data.
// Used by (a) server.js on every start-up (create-if-missing, never wipes data)
// and (b) `npm run seed` (full reset). Because the server now calls this
// automatically, a fresh `docker compose up` always has working logins for all
// four portals - no manual seed step is needed any more.
const dataset = require('./menu_dataset.json');

const DEMO_ACCOUNTS = [
  { name: 'Demo Student', usn_or_id: 'student1', phone: '9900000001', password: 'STUDENT12', role: 'student', wallet_balance: 200, referral_code: 'STUDENT001' },
  { name: 'Demo Kitchen Staff', usn_or_id: 'kitchen1', phone: '9900000002', password: 'KITCHEEN12', role: 'canteen_staff', referral_code: 'KITCHEN001' },
  { name: 'Demo Manager', usn_or_id: 'manager', phone: '9900000004', password: 'MANAGER12', role: 'manager', referral_code: 'MANAGER001' },
  { name: 'Demo Admin', usn_or_id: 'admin1', phone: '9900000003', password: 'ADMIN12', role: 'admin', referral_code: 'ADMIN00001' },
  { name: 'Demo Student (Alternate)', usn_or_id: '4at22cs000', phone: '9900000011', password: 'password123', role: 'student', wallet_balance: 200, referral_code: 'STUDENT002' },
  { name: 'Demo Kitchen Staff (Alternate)', usn_or_id: 'staff001', phone: '9900000012', password: 'password123', role: 'canteen_staff', referral_code: 'STAFF002' },
  { name: 'Demo Admin (Alternate)', usn_or_id: 'admin001', phone: '9900000013', password: 'password123', role: 'admin', referral_code: 'ADMIN00002' },
];

/**
 * @param {object}   o
 * @param {object}   o.models          { User, Category, MenuItem, Coupon, CanteenSettings, Announcement }
 * @param {Function} o.hash            async (plain) => hash       (bcrypt.hash)
 * @param {Function} o.compare         async (plain, hash) => bool (bcrypt.compare)
 * @param {boolean}  o.resetPasswords  if true, demo accounts whose password/role differ are repaired
 * @param {Function} o.log
 */
async function ensureDemoData({ models, hash, compare, resetPasswords = false, log = console.log }) {
  const { User, Category, MenuItem, Coupon, CanteenSettings, Announcement } = models;
  const out = { accounts_created: 0, accounts_repaired: 0, accounts_skipped: 0, categories: 0, items: 0, coupons: 0 };

  for (const acc of DEMO_ACCOUNTS) {
    const existing = await User.findOne({ where: { usn_or_id: acc.usn_or_id } });
    if (!existing) {
      const phoneOwner = await User.findOne({ where: { phone: acc.phone } });
      if (phoneOwner) { out.accounts_skipped++; log(`[demo] skipped ${acc.usn_or_id}: phone ${acc.phone} already used by another account`); continue; }
      const { password, ...fields } = acc;
      await User.create({ ...fields, password_hash: await hash(password, 10) });
      out.accounts_created++;
    } else if (resetPasswords) {
      const ok = existing.password_hash && (await compare(acc.password, existing.password_hash));
      if (!ok || existing.role !== acc.role) {
        await existing.update({ password_hash: await hash(acc.password, 10), role: acc.role });
        out.accounts_repaired++;
      }
    }
  }

  if ((await Category.count()) === 0) {
    for (const cat of dataset.categories) {
      const category = await Category.create({ name: cat.name, slug: cat.slug, sort_order: cat.sort_order });
      await MenuItem.bulkCreate(cat.items.map((item) => ({ ...item, category_id: category.id })));
      out.categories++; out.items += cat.items.length;
    }
  }
  if ((await Coupon.count()) === 0) {
    await Coupon.bulkCreate([
      { code: 'WELCOME10', discount_percent: 10, min_order_amount: 0 },
      { code: 'BIGLUNCH20', discount_percent: 20, min_order_amount: 100 },
    ]);
    out.coupons = 2;
  }
  if (!(await CanteenSettings.findByPk(1))) {
    await CanteenSettings.create({ id: 1, opens_at: '08:00', closes_at: '20:00', tax_percent: 5 });
  }
  if ((await Announcement.count()) === 0) {
    await Announcement.create({ message: 'Welcome to Smart Canteen! Order ahead to skip the queue.' });
  }
  return out;
}

module.exports = { ensureDemoData, DEMO_ACCOUNTS };
