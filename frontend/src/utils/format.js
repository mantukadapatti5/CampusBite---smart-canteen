export const rupee = (n, digits = 2) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtShort = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const todayStr = () => new Date().toLocaleDateString('en-CA');
export const addDaysStr = (s, n) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
