// Google Calendar de cada clínica (agenda real). La clínica conecta su cuenta
// de Google desde el onboarding y guardamos su refresh token en clinics.
// Scope calendar.events: leer y crear/borrar eventos (sin acceso a otros datos).
const { zonedToDate, DEFAULT_TZ } = require('./tz');

const API = 'https://www.googleapis.com/calendar/v3';

async function getAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Google Calendar: no se pudo renovar el acceso (${res.status}) ${text}`);
    err.code = res.status === 400 || res.status === 401 ? 'calendar_disconnected' : 'calendar_error';
    throw err;
  }
  return (await res.json()).access_token;
}

async function call(clinic, method, path, { query, body } = {}) {
  if (!clinic.google_refresh_token) {
    const err = new Error('La clínica no tiene Google Calendar conectado');
    err.code = 'calendar_disconnected';
    throw err;
  }
  const token = await getAccessToken(clinic.google_refresh_token);
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === 'DELETE' && (res.status === 204 || res.status === 410 || res.status === 404)) return null;
  if (!res.ok) throw new Error(`Google Calendar ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function calendarId(clinic) {
  return encodeURIComponent(clinic.google_calendar_id || 'primary');
}

// Intervalos ocupados [inicio, fin) en ms entre dos instantes. Cuentan como
// ocupado los eventos normales y los de día completo (vacaciones, cierres),
// salvo los marcados como "disponible" (transparency = transparent).
async function listBusy(clinic, from, to, tz = DEFAULT_TZ) {
  const busy = [];
  let pageToken;
  do {
    const data = await call(clinic, 'GET', `/calendars/${calendarId(clinic)}/events`, {
      query: {
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '2500',
        pageToken,
      },
    });
    for (const ev of data.items || []) {
      if (ev.status === 'cancelled' || ev.transparency === 'transparent') continue;
      // Los eventos de día completo traen solo la fecha: es el día entero en hora de la clínica.
      const start = ev.start?.dateTime ? Date.parse(ev.start.dateTime) : ev.start?.date ? zonedToDate(ev.start.date, '00:00', tz).getTime() : NaN;
      const end = ev.end?.dateTime ? Date.parse(ev.end.dateTime) : ev.end?.date ? zonedToDate(ev.end.date, '00:00', tz).getTime() : NaN;
      if (!Number.isNaN(start) && !Number.isNaN(end)) busy.push({ start, end });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return busy;
}

async function createEvent(clinic, { summary, description, start, end, tz }) {
  // start/end llegan como 'YYYY-MM-DDTHH:MM:00' en hora local; Google aplica timeZone.
  const ev = await call(clinic, 'POST', `/calendars/${calendarId(clinic)}/events`, {
    body: {
      summary,
      description,
      start: { dateTime: start, timeZone: tz },
      end: { dateTime: end, timeZone: tz },
      reminders: { useDefault: true },
    },
  });
  return ev.id;
}

async function deleteEvent(clinic, eventId) {
  if (!eventId) return;
  await call(clinic, 'DELETE', `/calendars/${calendarId(clinic)}/events/${encodeURIComponent(eventId)}`);
}

// Comprobación rápida para el onboarding: ¿la conexión funciona?
async function ping(clinic) {
  const now = new Date();
  await listBusy(clinic, now, new Date(now.getTime() + 24 * 3600 * 1000), clinic.schedule?.timezone);
  return true;
}

module.exports = { listBusy, createEvent, deleteEvent, ping };
