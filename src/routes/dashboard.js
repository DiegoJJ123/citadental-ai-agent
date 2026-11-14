const crypto = require('crypto');
const express = require('express');
const auth = require('../services/auth');
const calendar = require('../services/calendar');
const db = require('../db/db');
const { getDashboardStats } = require('../services/stats');
const clinics = require('../services/clinics');
const brand = require('../services/brand');

const router = express.Router();

function loginPage(errorMessage) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>CitaDental AI · Acceso</title>
${brand.HEAD}
<style>${brand.CSS}
  .login{min-height:calc(100vh - 64px);display:grid;grid-template-columns:1.05fr .95fr;align-items:center;gap:40px;max-width:1080px;margin:0 auto;padding:40px 24px}
  @media (max-width:820px){.login{grid-template-columns:1fr;text-align:center;padding:28px 18px}.login .art{order:-1}.login .art img{width:170px!important}}
  .login h1{font-size:clamp(34px,5vw,54px);font-weight:800;line-height:1.05;margin:18px 0 14px}
  .login p.lead{font-size:18px;color:var(--text-muted);max-width:460px;margin:0 0 28px}
  @media (max-width:820px){.login p.lead{margin:0 auto 24px}}
  .gbtn{display:inline-flex;align-items:center;gap:12px;background:var(--brand-deep);color:#fff;padding:15px 28px;border-radius:999px;text-decoration:none;font-weight:600;font-size:16px;box-shadow:var(--shadow-soft);transition:all .15s}
  .gbtn:hover{background:var(--brand-mid);transform:translateY(-2px);box-shadow:var(--shadow-glow)}
  .gbtn .g{background:#fff;border-radius:50%;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center}
  .fine{font-size:13px;color:var(--text-muted);margin-top:18px}
  .art{display:flex;justify-content:center;position:relative}
  .art:before{content:"";position:absolute;width:340px;height:340px;border-radius:50%;background:radial-gradient(circle,rgba(111,174,245,.35),transparent 65%);top:50%;left:50%;transform:translate(-50%,-50%)}
  .art img{position:relative;width:300px;height:auto;filter:drop-shadow(0 24px 40px rgba(31,78,168,.3))}
  .error{max-width:460px}
</style>
</head>
<body>${brand.BG}
  <header class="topbar"><a href="https://www.citadentalai.site" style="text-decoration:none">${brand.logo()}</a><nav><a href="https://www.citadentalai.site">Volver a la web</a></nav></header>
  <main class="login">
    <div>
      <span class="eyebrow"><i></i>Panel privado</span>
      <h1>Tu recepcionista con IA, <span class="text-gradient">bajo control</span>.</h1>
      <p class="lead">Da de alta clínicas, revisa las conversaciones del asistente y toma el control cuando haga falta.</p>
      ${errorMessage ? `<div class="err error">${escapeHtml(errorMessage)}</div>` : ''}
      <a class="gbtn" href="/dashboard/login/start"><span class="g"><svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6A14.6 14.6 0 0 1 9.5 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.5 2.2-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg></span>Iniciar sesión con Google</a>
      <p class="fine">Solo para la cuenta autorizada de CitaDental AI.</p>
    </div>
    <div class="art"><img src="${brand.MASCOT_URL}" alt="Mascota de CitaDental AI" class="float"></div>
  </main>
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
${brand.HEAD}
<style>${brand.CSS}
  main { padding: 28px 24px; max-width: 1100px; margin: 0 auto; }
  .hero{display:flex;align-items:center;gap:18px;margin-bottom:22px} .hero img{width:80px;height:auto;filter:drop-shadow(0 12px 20px rgba(31,78,168,.25))}
  .hero h1{font-size:30px;font-weight:800;margin:8px 0 2px} .hero p{margin:0;color:var(--text-muted)}
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 28px; }
  .card { background: #fff; border:1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; box-shadow:var(--shadow-soft); }
  .card .value { font-family:"Plus Jakarta Sans",sans-serif; font-size: 32px; font-weight: 800; color:var(--brand-deep); }
  .card .label { color: var(--text-muted); font-size: 13px; margin-top: 2px; }
  section { margin-bottom: 28px; }
  section h2 { font-size: 18px; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: var(--radius); overflow: hidden; border:1px solid var(--border); box-shadow:var(--shadow-soft); }
  th, td { text-align: left; padding: 11px 14px; font-size: 13px; border-bottom: 1px solid var(--border); }
  th { color: var(--text-muted); font-weight: 600; text-transform:uppercase; font-size:11px; letter-spacing:.04em; background:#FAFBFD; }
  tr:last-child td { border-bottom: none; }
  .badge { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .badge.confirmada { background: #EAF7EF; color: #17633A; }
  .badge.cancelada { background: #FDECEC; color: #8E1F1F; }
  .empty { color: var(--text-muted); font-size: 13px; padding: 16px; background:#fff; border:1px dashed var(--border); border-radius:var(--radius); }
  .calok{color:#17633A;font-size:13px;font-weight:600} .calwarn{color:#A34E12;font-size:13px}
  #resetPhone{flex:1;padding:11px 14px;border-radius:999px;border:1px solid var(--border);font:inherit;background:#fff;color:var(--text-strong)}
</style>
</head>
<body>${brand.BG}
  <header class="topbar">
    <a href="/onboarding" style="text-decoration:none">${brand.logo('Panel demo')}</a>
    <nav>
      ${
        !calendar.isCalendarConnected()
          ? '<a href="/dashboard/calendar/connect">Conectar Google Calendar</a>'
          : calendar.isCalendarPersisted()
            ? '<span class="calok">✓ Google Calendar conectado</span>'
            : '<a href="/dashboard/calendar/connect" class="calwarn">⚠ Calendar sin guardar en Render (se perderá en el próximo deploy) · reconectar</a>'
      }
      <a href="/onboarding">Clínicas</a><a href="/panel/c/1">Conversaciones demo</a>
      <a href="/dashboard/logout">Cerrar sesión</a>
    </nav>
  </header>
  <main>
    <div class="hero"><img src="${brand.MASCOT_URL}" alt="" class="float"><div><span class="eyebrow live"><i></i>Bot comercial en marcha</span><h1>Panel de la <span class="text-gradient">demo</span></h1><p>Métricas del WhatsApp de CitaDental AI: mensajes, citas y leads.</p></div></div>
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
      <p style="color:var(--text-muted); font-size:13px; margin-bottom:12px;">
        Si un número se quedó "atascado" respondiendo como si fuera la clínica (o en cualquier otro modo raro),
        borra su historial aquí para que la próxima respuesta empiece de cero con el comportamiento actual del bot.
      </p>
      <div style="display:flex; gap:8px; max-width:420px;">
        <input id="resetPhone" type="text" placeholder="Número en formato 34600000000" />
        <button id="resetBtn" class="btn">Resetear</button>
      </div>
      <div id="resetMsg" style="margin-top:10px; font-size:13px;"></div>
    </section>
  </main>
  ${brand.FOOTER}
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
          <td>\${a.patient_name || '—'}<br><span style="color:var(--text-muted)">\${a.patient_phone}</span></td>
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
        msgEl.style.color = '#8E1F1F';
        msgEl.textContent = 'Escribe un número primero.';
        return;
      }
      msgEl.style.color = '#5B6B7A';
      msgEl.textContent = 'Reseteando...';
      const res = await fetch('/api/reset-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone }),
      });
      if (res.ok) {
        msgEl.style.color = '#17633A';
        msgEl.textContent = 'Listo. El próximo mensaje de ese número empezará de cero.';
        document.getElementById('resetPhone').value = '';
      } else {
        msgEl.style.color = '#8E1F1F';
        msgEl.textContent = 'Error al resetear. Inténtalo de nuevo.';
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Se muestra una sola vez tras conectar Calendar: el token hay que copiarlo a
// Render → Environment para que la conexión sobreviva a los deploys.
function calendarConnectedPage(refreshToken) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>CitaDental AI — Calendar conectado</title>
${brand.HEAD}
<style>${brand.CSS}
  main { max-width: 720px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 24px; color: #17633A; }
  code, textarea { font-family: ui-monospace, monospace; }
  textarea { width: 100%; height: 90px; background: #fff; color: var(--text-strong); border: 1px solid var(--border); border-radius: 12px; padding: 12px; }
</style>
</head>
<body>${brand.BG}
  <header class="topbar"><a href="/dashboard" style="text-decoration:none">${brand.logo()}</a></header>
  <main>
  <h1>✓ Google Calendar conectado</h1>
  <p class="warn">Paso obligatorio para que no se pierda en el próximo deploy: copia este valor en
  <b>Render → citadental-ai-bot → Environment</b> como variable <code>GOOGLE_CALENDAR_REFRESH_TOKEN</code> y guarda.
  Es una credencial: no la compartas con nadie.</p>
  <textarea id="t" readonly>${escapeHtml(refreshToken)}</textarea>
  <p><button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('t').value); this.textContent='Copiado ✓'">Copiar</button>
  &nbsp; <a href="/dashboard">Volver al dashboard</a></p>
  </main>
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
    res.redirect(auth.popNextUrl(req, res) || '/dashboard');
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

    // El onboarding de una clínica usa este mismo callback (es la URL que hay
    // registrada en Google) con el id de la clínica dentro del state: "xxx.c12".
    const clinicMatch = /\.c(\d+)$/.exec(req.query.state || '');
    const back = clinicMatch ? `/onboarding/${clinicMatch[1]}/calendario` : '/dashboard';

    if (!req.query.state || req.query.state !== expectedState) {
      return res.redirect(`${back}?error=${encodeURIComponent('La conexión con Google Calendar caducó. Inténtalo de nuevo.')}`);
    }
    if (req.query.error || !req.query.code) {
      return res.redirect(`${back}?error=${encodeURIComponent('No se dio permiso a Google Calendar.')}`);
    }

    if (clinicMatch) {
      const clinic = clinics.getClinicById(Number(clinicMatch[1]));
      if (!clinic || clinic.isDemo) return res.redirect('/onboarding');
      try {
        const token = await calendar.exchangeCodeForRefreshToken(req, req.query.code);
        clinics.updateClinic(clinic.id, { google_refresh_token: token });
        return res.redirect(`${back}?ok=1`);
      } catch (err) {
        console.error('Error conectando el Google Calendar de la clínica:', err);
        return res.redirect(`${back}?error=${encodeURIComponent(err.message)}`);
      }
    }

    const refreshToken = await calendar.exchangeCodeForRefreshToken(req, req.query.code);
    calendar.setSetting('google_calendar_refresh_token', refreshToken);

    res.send(calendarConnectedPage(refreshToken));
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
  db.prepare('DELETE FROM conversations WHERE clinic_id = ? AND phone = ?').run(db.DEMO_CLINIC_ID, phone);
  res.json({ ok: true });
});

module.exports = router;
