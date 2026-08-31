const crypto = require('crypto');
const express = require('express');
const auth = require('../services/auth');
const calendar = require('../services/calendar');
const db = require('../db/db');
const { getDashboardStats } = require('../services/stats');

const router = express.Router();

function loginPage(errorMessage) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CitaDental AI — Acceso al dashboard</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #f1f5f9; height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; }
  .card { background: #1e293b; padding: 40px; border-radius: 16px; text-align: center; max-width: 380px; box-shadow: 0 10px 40px rgba(0,0,0,.3); }
  h1 { font-size: 22px; margin-bottom: 8px; }
  p { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
  a.btn { display: inline-flex; align-items: center; gap: 10px; background: #fff; color: #1f1f1f; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; }
  .error { background: #7f1d1d; color: #fecaca; padding: 10px; border-radius: 8px; font-size: 13px; margin-bottom: 20px; }
</style>
</head>
<body>
  <div class="card">
    <h1>CitaDental AI</h1>
    <p>Panel privado. Inicia sesión con tu cuenta de Google autorizada.</p>
    ${errorMessage ? `<div class="error">${errorMessage}</div>` : ''}
    <a class="btn" href="/dashboard/login/start">Iniciar sesión con Google</a>
  </div>
</body>
</html>`;
}

function dashboardPage() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CitaDental AI — Dashboard</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 20px 32px; border-bottom: 1px solid #1e293b; }
  header h1 { font-size: 18px; margin: 0; }
  header a { color: #94a3b8; font-size: 13px; text-decoration: none; }
  main { padding: 32px; max-width: 1100px; margin: 0 auto; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .card { background: #1e293b; border-radius: 12px; padding: 20px; }
  .card .value { font-size: 32px; font-weight: 700; }
  .card .label { color: #94a3b8; font-size: 13px; margin-top: 4px; }
  section { margin-bottom: 32px; }
  section h2 { font-size: 15px; color: #cbd5e1; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; font-size: 13px; border-bottom: 1px solid #0f172a; }
  th { color: #94a3b8; font-weight: 600; }
  tr:last-child td { border-bottom: none; }
  .badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .badge.confirmada { background: #14532d; color: #bbf7d0; }
  .badge.cancelada { background: #7f1d1d; color: #fecaca; }
  .empty { color: #64748b; font-size: 13px; padding: 16px; }
</style>
</head>
<body>
  <header>
    <h1>CitaDental AI · Dashboard</h1>
    <div style="display:flex; align-items:center; gap:16px;">
      ${
        calendar.isCalendarConnected()
          ? '<span style="color:#4ade80; font-size:13px;">✓ Google Calendar conectado</span>'
          : '<a href="/dashboard/calendar/connect" style="color:#93c5fd;">Conectar Google Calendar</a>'
      }
      <a href="/dashboard/logout">Cerrar sesión</a>
    </div>
  </header>
  <main>
    <div class="cards" id="cards"></div>
    <section>
      <h2>Últimas citas</h2>
      <div id="appointments"></div>
    </section>
    <section>
      <h2>Últimos leads de demo</h2>
      <div id="leads"></div>
    </section>
    <section>
      <h2>Resetear conversación de WhatsApp</h2>
      <p style="color:#94a3b8; font-size:13px; margin-bottom:12px;">
        Si un número se quedó "atascado" respondiendo como si fuera la clínica (o en cualquier otro modo raro),
        borra su historial aquí para que la próxima respuesta empiece de cero con el comportamiento actual del bot.
      </p>
      <div style="display:flex; gap:8px; max-width:420px;">
        <input id="resetPhone" type="text" placeholder="Número en formato 34600000000"
          style="flex:1; padding:10px 12px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#e2e8f0;" />
        <button id="resetBtn" style="padding:10px 16px; border-radius:8px; border:none; background:#2563eb; color:#fff; font-weight:600; cursor:pointer;">Resetear</button>
      </div>
      <div id="resetMsg" style="margin-top:10px; font-size:13px;"></div>
    </section>
  </main>
  <script>
    async function load() {
      const res = await fetch('/api/stats', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        window.location.href = '/dashboard/login';
        return;
      }
      const data = await res.json();

      document.getElementById('cards').innerHTML = [
        { label: 'WhatsApp recibidos (total)', value: data.totalMessages },
        { label: 'WhatsApp recibidos hoy', value: data.messagesToday },
        { label: 'Citas pactadas (total)', value: data.totalAppointments },
        { label: 'Citas confirmadas ahora', value: data.confirmedAppointments },
        { label: 'Leads de demo', value: data.totalLeads },
      ].map(c => \`<div class="card"><div class="value">\${c.value}</div><div class="label">\${c.label}</div></div>\`).join('');

      const apptRows = data.recentAppointments.map(a => \`
        <tr>
          <td>\${a.patient_name || '—'}<br><span style="color:#64748b">\${a.patient_phone}</span></td>
          <td>\${a.treatment}</td>
          <td>\${a.slot_date} \${a.slot_time}</td>
          <td><span class="badge \${a.status}">\${a.status}</span></td>
        </tr>\`).join('');
      document.getElementById('appointments').innerHTML = data.recentAppointments.length
        ? \`<table><thead><tr><th>Paciente</th><th>Tratamiento</th><th>Fecha</th><th>Estado</th></tr></thead><tbody>\${apptRows}</tbody></table>\`
        : '<div class="empty">Todavía no hay citas registradas.</div>';

      const leadRows = data.recentLeads.map(l => \`
        <tr>
          <td>\${l.nombre || '—'}</td>
          <td>\${l.email || '—'}</td>
          <td>\${l.telefono_contacto || l.phone}</td>
          <td>\${l.notas || '—'}</td>
          <td>\${new Date(l.created_at).toLocaleString('es-ES')}</td>
        </tr>\`).join('');
      document.getElementById('leads').innerHTML = data.recentLeads.length
        ? \`<table><thead><tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Notas</th><th>Fecha</th></tr></thead><tbody>\${leadRows}</tbody></table>\`
        : '<div class="empty">Todavía no hay leads registrados.</div>';
    }
    load();

    document.getElementById('resetBtn').addEventListener('click', async () => {
      const phone = document.getElementById('resetPhone').value.trim();
      const msgEl = document.getElementById('resetMsg');
      if (!phone) {
        msgEl.style.color = '#fca5a5';
        msgEl.textContent = 'Escribe un número primero.';
        return;
      }
      msgEl.style.color = '#94a3b8';
      msgEl.textContent = 'Reseteando...';
      const res = await fetch('/api/reset-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone }),
      });
      if (res.ok) {
        msgEl.style.color = '#4ade80';
        msgEl.textContent = 'Listo. El próximo mensaje de ese número empezará de cero.';
        document.getElementById('resetPhone').value = '';
      } else {
        msgEl.style.color = '#fca5a5';
        msgEl.textContent = 'Error al resetear. Inténtalo de nuevo.';
      }
    });
  </script>
</body>
</html>`;
}

router.get('/dashboard/login', (req, res) => {
  res.send(loginPage(req.query.error));
});

router.get('/dashboard/login/start', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', `citadental_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=300`);
  res.redirect(auth.buildGoogleAuthUrl(req, state));
});

router.get('/dashboard/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.redirect('/dashboard/login');
});

router.get('/auth/google/callback', async (req, res) => {
  try {
    const cookies = req.headers.cookie || '';
    const stateCookie = cookies
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('citadental_oauth_state='));
    const expectedState = stateCookie ? decodeURIComponent(stateCookie.split('=')[1]) : null;

    if (!req.query.state || req.query.state !== expectedState) {
      return res.redirect('/dashboard/login?error=Sesión de login inválida, inténtalo de nuevo.');
    }
    if (!req.query.code) {
      return res.redirect('/dashboard/login?error=Google no devolvió un código de autorización.');
    }

    const email = await auth.exchangeCodeForEmail(req, req.query.code);

    if (!auth.isAllowedEmail(email)) {
      return res.redirect('/dashboard/login?error=Esta cuenta no tiene acceso al dashboard.');
    }

    auth.setSessionCookie(res, email);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Error en callback de Google OAuth:', err);
    res.redirect('/dashboard/login?error=Error al iniciar sesión con Google.');
  }
});

router.get('/dashboard', auth.requireDashboardAuth, (req, res) => {
  res.send(dashboardPage());
});

router.get('/dashboard/calendar/connect', auth.requireDashboardAuth, (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', `citadental_calendar_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=300`);
  res.redirect(calendar.buildCalendarAuthUrl(req, state));
});

router.get('/auth/google/calendar/callback', auth.requireDashboardAuth, async (req, res) => {
  try {
    const cookies = req.headers.cookie || '';
    const stateCookie = cookies
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('citadental_calendar_state='));
    const expectedState = stateCookie ? decodeURIComponent(stateCookie.split('=')[1]) : null;

    if (!req.query.state || req.query.state !== expectedState) {
      return res.redirect('/dashboard?error=Sesión de conexión con Calendar inválida, inténtalo de nuevo.');
    }
    if (!req.query.code) {
      return res.redirect('/dashboard?error=Google no devolvió un código de autorización.');
    }

    const refreshToken = await calendar.exchangeCodeForRefreshToken(req, req.query.code);
    calendar.setSetting('google_calendar_refresh_token', refreshToken);

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Error conectando Google Calendar:', err);
    res.redirect('/dashboard');
  }
});

router.get('/api/stats', (req, res) => {
  const email = auth.getSessionEmail(req);
  if (!email || !auth.isAllowedEmail(email)) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  res.json(getDashboardStats());
});

router.post('/api/reset-conversation', express.json(), (req, res) => {
  const email = auth.getSessionEmail(req);
  if (!email || !auth.isAllowedEmail(email)) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  const phone = (req.body?.phone || '').replace(/\D/g, '');
  if (!phone) {
    return res.status(400).json({ error: 'Falta el número de teléfono' });
  }
  db.prepare('DELETE FROM conversations WHERE phone = ?').run(phone);
  res.json({ ok: true });
});

module.exports = router;
