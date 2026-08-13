const crypto = require('crypto');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-cambia-esto';
const ALLOWED_DASHBOARD_EMAIL = (process.env.ALLOWED_DASHBOARD_EMAIL || '').toLowerCase();
const SESSION_COOKIE = 'citadental_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function redirectUri(req) {
  return `${baseUrl(req)}/auth/google/callback`;
}

function sign(value) {
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
  return `${value}.${hmac}`;
}

function unsign(signed) {
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const hmac = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
  if (hmac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) {
    return null;
  }
  return value;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const [k, ...rest] = part.trim().split('=');
    if (k) acc[k] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function buildGoogleAuthUrl(req, state) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCodeForEmail(req, code) {
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
    throw new Error(`Error intercambiando código con Google: ${res.status} ${await res.text()}`);
  }

  const { id_token } = await res.json();

  // Verificamos el id_token con el endpoint de Google (evita reimplementar verificación JWT).
  const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${id_token}`);
  if (!verifyRes.ok) {
    throw new Error('id_token de Google inválido');
  }
  const payload = await verifyRes.json();

  if (payload.aud !== GOOGLE_CLIENT_ID) {
    throw new Error('El id_token no corresponde a esta aplicación');
  }
  if (payload.email_verified !== 'true' && payload.email_verified !== true) {
    throw new Error('Email de Google no verificado');
  }

  return payload.email.toLowerCase();
}

function isAllowedEmail(email) {
  return Boolean(email) && email.toLowerCase() === ALLOWED_DASHBOARD_EMAIL;
}

function createSessionCookie(email) {
  const expires = Date.now() + SESSION_MAX_AGE_MS;
  return sign(`${email}|${expires}`);
}

function setSessionCookie(res, email) {
  const value = createSessionCookie(email);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

function getSessionEmail(req) {
  const cookies = parseCookies(req);
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;

  const unsigned = unsign(raw);
  if (!unsigned) return null;

  const [email, expiresStr] = unsigned.split('|');
  const expires = Number(expiresStr);
  if (!email || !expires || Date.now() > expires) return null;

  return email;
}

function requireDashboardAuth(req, res, next) {
  const email = getSessionEmail(req);
  if (!email || !isAllowedEmail(email)) {
    return res.redirect('/dashboard/login');
  }
  req.dashboardEmail = email;
  next();
}

module.exports = {
  SESSION_COOKIE,
  buildGoogleAuthUrl,
  exchangeCodeForEmail,
  isAllowedEmail,
  setSessionCookie,
  clearSessionCookie,
  getSessionEmail,
  requireDashboardAuth,
  sign,
  unsign,
};
