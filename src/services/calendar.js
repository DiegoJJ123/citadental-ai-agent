const db = require('../db/db');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function redirectUri(req) {
  return `${req.protocol}://${req.get('host')}/auth/google/calendar/callback`;
}

// opts.selectAccount: en el onboarding la clínica elige SU cuenta de Google.
function buildCalendarAuthUrl(req, state, opts = {}) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: CALENDAR_SCOPE,
    access_type: 'offline',
    prompt: opts.selectAccount ? 'consent select_account' : 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCodeForRefreshToken(req, code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(req),
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    throw new Error(`Error intercambiando código de Calendar: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (!data.refresh_token) {
    throw new Error(
      'Google no devolvió refresh_token (probablemente ya estaba autorizado antes). Revoca el acceso en https://myaccount.google.com/permissions y vuelve a conectarlo.'
    );
  }
  return data.refresh_token;
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = ?`
  ).run(key, value, value);
}

// El disco de Render no es persistente: la SQLite se borra en cada deploy o
// reinicio. Por eso el refresh token se puede fijar en la variable de entorno
// GOOGLE_CALENDAR_REFRESH_TOKEN, que sobrevive a los deploys. Si además hay
// uno guardado en la BD (recién conectado desde el dashboard), manda ese.
function getRefreshToken() {
  return getSetting('google_calendar_refresh_token') || process.env.GOOGLE_CALENDAR_REFRESH_TOKEN || null;
}

function isCalendarConnected() {
  return Boolean(getRefreshToken());
}

function isCalendarPersisted() {
  return Boolean(process.env.GOOGLE_CALENDAR_REFRESH_TOKEN);
}

async function getAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    throw new Error(`Error renovando access_token de Calendar: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token;
}

// Crea un evento de 30 minutos con reunión de Google Meet incluida.
async function createDemoEvent({ summary, description, startISO, attendeeEmail }) {
  const accessToken = await getAccessToken();
  if (!accessToken) return null;

  const start = new Date(startISO);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  const body = {
    summary,
    description,
    start: { dateTime: start.toISOString(), timeZone: 'Europe/Madrid' },
    end: { dateTime: end.toISOString(), timeZone: 'Europe/Madrid' },
    conferenceData: {
      createRequest: {
        requestId: `citadental-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    attendees: attendeeEmail ? [{ email: attendeeEmail }] : undefined,
  };

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    throw new Error(`Error creando evento de Calendar: ${res.status} ${await res.text()}`);
  }

  const event = await res.json();
  return {
    eventLink: event.htmlLink,
    meetLink: event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || null,
  };
}

module.exports = {
  buildCalendarAuthUrl,
  exchangeCodeForRefreshToken,
  isCalendarConnected,
  isCalendarPersisted,
  setSetting,
  getSetting,
  createDemoEvent,
};
