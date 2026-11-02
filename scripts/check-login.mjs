// Diagnoses login problems end to end.  Usage:  node scripts/check-login.mjs [apiBase]
// (needs Node 18+).  Example:  node scripts/check-login.mjs http://localhost:5000/api
const base = (process.argv[2] || 'http://localhost:5000/api').replace(/\/+$/, '');
const DEMO = [
  { portal: 'Student', usn: 'student1', pw: 'STUDENT12', role: 'student', home: '/student/menu', forbidden: '/admin/dashboard' },
  { portal: 'Kitchen', usn: 'kitchen1', pw: 'KITCHEEN12', role: 'canteen_staff', home: '/kitchen/dashboard', forbidden: '/admin/dashboard' },
  { portal: 'Manager', usn: 'manager', pw: 'MANAGER12', role: 'manager', home: '/manager/dashboard', forbidden: null },
  { portal: 'Admin', usn: 'admin1', pw: 'ADMIN12', role: 'admin', home: '/admin/dashboard', forbidden: null },
];
let failed = 0;
const ok = (m) => console.log('  PASS  ' + m);
const bad = (m) => { failed++; console.log('  FAIL  ' + m); };

async function j(path, opts = {}) {
  const res = await fetch(base + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  let body = null; try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, body };
}

console.log(`Checking ${base}\n`);
try {
  const h = await j('/health');
  if (h.status === 200 && h.body?.db === 'up') ok(`server + database online, ${h.body.users} account(s) in the database`);
  else bad(`health check returned ${h.status} ${JSON.stringify(h.body)}`);
  if (h.body?.users === 0) bad('database has NO accounts - restart the backend so it creates the demo accounts');
} catch (e) {
  bad(`cannot reach the server: ${e.message}\n        -> run "docker compose up --build" and wait for "Smart Canteen API ... running on port 5000"`);
  process.exit(1);
}

for (const d of DEMO) {
  console.log(`\n${d.portal} portal (${d.usn})`);
  for (const variant of [d.usn, d.usn.toUpperCase()]) {
    const r = await j('/auth/login', { method: 'POST', body: JSON.stringify({ usn_or_id: variant, password: d.pw }) });
    if (r.status === 200 && r.body?.token) ok(`login as "${variant}" -> role ${r.body.user.role}, opens ${d.home}`);
    else { bad(`login as "${variant}" -> HTTP ${r.status} ${JSON.stringify(r.body)}`); }
    if (variant !== d.usn) continue;
    if (r.status !== 200) continue;
    if (r.body.user.role !== d.role) bad(`expected role ${d.role} but got ${r.body.user.role}`);
    const auth = { Authorization: `Bearer ${r.body.token}` };
    const me = await j('/auth/me', { headers: auth });
    me.status === 200 ? ok('token accepted by /auth/me') : bad(`/auth/me -> HTTP ${me.status}`);
    const probe = { student: '/menu', canteen_staff: '/admin/kitchen-dashboard', manager: '/admin/dashboard', admin: '/admin/dashboard' }[d.role];
    const p = await j(probe, { headers: auth });
    p.status === 200 ? ok(`portal data loads (${probe})`) : bad(`${probe} -> HTTP ${p.status} ${JSON.stringify(p.body)}`);
    if (d.forbidden) {
      const f = await j('/admin/dashboard', { headers: auth });
      f.status === 403 ? ok('manager-only data correctly blocked (403)') : bad(`expected 403 on /admin/dashboard but got ${f.status}`);
    }
  }
}
const wrong = await j('/auth/login', { method: 'POST', body: JSON.stringify({ usn_or_id: 'student1', password: 'nope' }) });
console.log('\nSecurity'); wrong.status === 401 ? ok('wrong password rejected (401)') : bad(`wrong password returned ${wrong.status}`);

console.log(failed ? `\n${failed} check(s) FAILED - see the messages above, then run: docker compose logs backend` : '\nALL CHECKS PASSED - all four portals can log in.');
process.exit(failed ? 1 : 0);
