// Pure helper (no import.meta / window access) so it can be unit-tested in Node.
// Decides which URL the browser should call for the API:
//  * an explicit, non-localhost VITE_API_URL always wins;
//  * if the page is opened through a LAN IP / host name (phone, another PC,
//    cloud VM) "localhost" would point at the visitor's own device, so use the
//    page's host with port 5000 instead;
//  * otherwise keep http://localhost:5000/api.
export function resolveApiBase(envUrl, loc) {
  const clean = (u) => String(u).replace(/\/+$/, '');
  const isLocalUrl = (u) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(u);
  const isLocalHost = (h) => !h || h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  if (envUrl && !isLocalUrl(envUrl)) return clean(envUrl);
  if (loc && !isLocalHost(loc.hostname)) return `${loc.protocol}//${loc.hostname}:5000/api`;
  return clean(envUrl || 'http://localhost:5000/api');
}
