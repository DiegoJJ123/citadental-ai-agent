// Fechas en la zona horaria de la clínica. El servidor (Render) corre en UTC,
// así que "10:00 en Madrid" no se puede construir con new Date('...T10:00').
// Se usa Intl (ICU), que conoce el horario de verano.
const DEFAULT_TZ = 'Europe/Madrid';

function partsIn(tz, ts) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(ts));
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
  };
}

// Diferencia (ms) entre la hora local de `tz` y UTC en el instante ts.
function offsetMs(tz, ts) {
  const p = partsIn(tz, ts);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}

// 'YYYY-MM-DD' + 'HH:MM' en hora local de tz → Date (instante real).
function zonedToDate(date, time, tz = DEFAULT_TZ) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - offsetMs(tz, guess);
  ts = guess - offsetMs(tz, ts); // segunda pasada: corrige los días de cambio de hora
  return new Date(ts);
}

const pad = (n) => String(n).padStart(2, '0');

// Date → { date: 'YYYY-MM-DD', time: 'HH:MM', weekday: 0-6 } en hora local de tz.
function dateToZoned(dateObj, tz = DEFAULT_TZ) {
  const p = partsIn(tz, dateObj.getTime());
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}`, weekday: p.weekday };
}

// Suma n días a 'YYYY-MM-DD' (aritmética de calendario, sin horas).
function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function weekdayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function todayIn(tz = DEFAULT_TZ) {
  return dateToZoned(new Date(), tz).date;
}

module.exports = { DEFAULT_TZ, zonedToDate, dateToZoned, addDays, weekdayOf, todayIn };
