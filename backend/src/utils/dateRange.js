// Time-zone aware day boundaries (the canteen's day is Asia/Kolkata by default,
// but the Docker container runs in UTC).
const TZ = () => process.env.APP_TZ || 'Asia/Kolkata';

function tzOffsetMs(date, tz = TZ()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// "2026-10-30" -> the instant that day starts in the canteen time zone
function dayStart(dateStr, tz = TZ()) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  return new Date(guess.getTime() - tzOffsetMs(guess, tz));
}
const dayKey = (date, tz = TZ()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Inclusive date range from query params; defaults to the last `defaultDays` days.
function parseRange({ from, to } = {}, defaultDays = 30, now = new Date(), tz = TZ()) {
  const today = dayKey(now, tz);
  const endDay = isDateStr(to) ? to : today;
  const [y, m, d] = endDay.split('-').map(Number);
  const startDay = isDateStr(from) ? from : new Date(Date.UTC(y, m - 1, d - (defaultDays - 1))).toISOString().slice(0, 10);
  const start = dayStart(startDay, tz);
  const end = new Date(dayStart(endDay, tz).getTime() + 24 * 3600 * 1000 - 1);
  return { start, end, from: startDay, to: endDay };
}

module.exports = { tzOffsetMs, dayStart, dayKey, parseRange, isDateStr };
