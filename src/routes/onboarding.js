// Onboarding de clínicas: asistente paso a paso para dar de alta una clínica
// nueva (pensado para usarse desde el ordenador de la propia clínica).
// Solo accesible con la cuenta de Google autorizada (auth.requireDashboardAuth).
const crypto = require('crypto');
const express = require('express');
const auth = require('../services/auth');
const db = require('../db/db');
const clinics = require('../services/clinics');
const brand = require('../services/brand');
const agenda = require('../services/agenda');
const calendar = require('../services/calendar');
const gcal = require('../services/googleCalendar');
const { INFO_FIELDS, extractClinicInfo } = require('../services/siteExtractor');
const { handleIncomingMessage } = require('../services/agent');
const ycloud = require('../services/ycloud');
const reminders = require('../services/reminders');
const health = require('../services/health');
const backup = require('../services/backup');
const mailer = require('../services/mailer');
const templates = require('../services/templates');

const router = express.Router();
const form = express.urlencoded({ extended: false, limit: '200kb' });

const STEPS = [
  { key: 'web', title: 'Web de la clínica' },
  { key: 'datos', title: 'Datos de la clínica' },
  { key: 'agenda', title: 'Agenda y horario' },
  { key: 'calendario', title: 'Conectar calendario' },
  { key: 'whatsapp', title: 'Conectar WhatsApp' },
  { key: 'recepcion', title: 'Avisos a recepción' },
  { key: 'prueba', title: 'Probar el asistente' },
  { key: 'activar', title: 'Activar' },
];
const DAYS = [
  { n: 1, name: 'Lunes' },
  { n: 2, name: 'Martes' },
  { n: 3, name: 'Miércoles' },
  { n: 4, name: 'Jueves' },
  { n: 5, name: 'Viernes' },
  { n: 6, name: 'Sábado' },
  { n: 0, name: 'Domingo' },
];
const PROVIDERS = [
  { key: 'google', name: 'Google Calendar', desc: 'La clínica ya usa Google Calendar como agenda.' },
  { key: 'gesden', name: 'Gesden', desc: 'Gesden no permite conexión directa. Se usa un Google Calendar dedicado a las citas del asistente.' },
  { key: 'cliniccloud', name: 'Clinic Cloud', desc: 'Sin conexión directa por ahora. Se usa un Google Calendar dedicado a las citas del asistente.' },
  { key: 'doctoralia', name: 'Doctoralia', desc: 'Próximamente (pendiente de alta como integrador en Docplanner).', disabled: true },
];

// ---------------------------------------------------------------------------
// Utilidades de presentación
// ---------------------------------------------------------------------------
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const CSS = brand.CSS + `
.wrap{max-width:1160px;margin:0 auto;padding:28px 24px;display:grid;grid-template-columns:250px 1fr;gap:24px}
.wrap.single{grid-template-columns:1fr}
@media (max-width:820px){.wrap{grid-template-columns:1fr;padding:16px}}
nav.steps{background:#fff;border-radius:var(--radius);padding:14px;height:fit-content;border:1px solid var(--border);box-shadow:var(--shadow-soft);position:sticky;top:84px}
nav.steps .clinic{padding:6px 10px 14px;font-family:"Plus Jakarta Sans",sans-serif;font-weight:700;border-bottom:1px solid var(--border);margin-bottom:8px}
nav.steps a{display:flex;gap:10px;align-items:center;padding:9px 10px;border-radius:12px;color:var(--text-muted);text-decoration:none;font-size:14px;font-weight:500}
nav.steps a.cur{background:var(--brand-soft);color:var(--brand-deep);font-weight:600} nav.steps a:hover{background:var(--surface);color:var(--brand-deep)}
nav.steps .n{width:26px;height:26px;border-radius:50%;background:var(--surface);border:1px solid var(--border);display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex:none}
nav.steps a.done .n{background:var(--whatsapp);border-color:var(--whatsapp);color:#fff}
nav.steps a.cur .n{background:linear-gradient(135deg,var(--brand-deep),var(--brand-light));border-color:transparent;color:#fff}
main.card{background:#fff;border-radius:var(--radius);padding:32px;border:1px solid var(--border);box-shadow:var(--shadow-soft);min-width:0}
@media (max-width:640px){main.card{padding:20px}}
h1{font-size:26px;font-weight:800;margin:0 0 6px} h2{font-size:18px;font-weight:700;margin:28px 0 8px} p.sub{color:var(--text-muted);margin:0 0 22px}
label{display:block;font-weight:600;font-size:14px;margin:14px 0 6px} .hint{font-weight:400;color:var(--text-muted);font-size:13px}
input[type=text],input[type=url],input[type=email],input[type=tel],input[type=password],input[type=number],input[type=time],textarea,select{width:100%;padding:11px 14px;border:1px solid var(--border);border-radius:12px;font:inherit;background:#fff;color:var(--text-strong)}
textarea{min-height:80px;resize:vertical} input[type=time]{width:auto;min-width:118px;display:inline-block} td.range{white-space:nowrap}
input:focus,textarea:focus,select:focus{outline:3px solid #D3E2FA;border-color:var(--brand-mid)}
.actions{display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:26px;flex-wrap:wrap}
table{width:100%;border-collapse:collapse;font-size:14px} th,td{text-align:left;padding:12px 10px;border-bottom:1px solid var(--border);vertical-align:middle}
tbody tr:hover td{background:#FAFBFD}
th{color:var(--text-muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.badge{display:inline-block;padding:3px 11px;border-radius:999px;font-size:12px;font-weight:600}
.b-onboarding{background:var(--alert-soft);color:#A34E12} .b-activa{background:#EAF7EF;color:#17633A} .b-pausada{background:var(--surface);color:var(--text-muted);border:1px solid var(--border)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px} @media (max-width:640px){.grid2{grid-template-columns:1fr}}
.provider{border:1px solid var(--border);border-radius:14px;padding:13px 15px;margin:8px 0;display:flex;gap:12px;align-items:flex-start;cursor:pointer;font-weight:400;transition:border-color .15s,background .15s}
.provider:hover{border-color:var(--brand-light)} .provider:has(input:checked){border-color:var(--brand-mid);background:var(--brand-soft)}
.provider input{margin-top:4px;accent-color:var(--brand-deep)} .provider.dis{opacity:.55;cursor:not-allowed}
.check{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border)}
.check .i{flex:none;width:22px;text-align:center}
ol.guide{padding-left:22px} ol.guide li{margin:8px 0} ol.guide li::marker{color:var(--brand-mid);font-weight:700}
#chat{border:1px solid var(--border);border-radius:var(--radius);background:#EFEAE2;height:430px;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px}
.msg{max-width:78%;padding:8px 12px;border-radius:12px;white-space:pre-wrap;font-size:14px;box-shadow:0 1px 1px rgba(0,0,0,.06)}
.msg.me{align-self:flex-end;background:#D9FDD3} .msg.bot{align-self:flex-start;background:#fff} .msg.sys{align-self:center;background:#FFF7CD;font-size:12px}
.chatbar{display:flex;gap:8px;margin-top:10px} .chatbar input{flex:1}
small.mono{font-family:ui-monospace,monospace;color:var(--text-muted)}
.hello{display:flex;align-items:center;gap:18px;margin-bottom:8px} .hello img{width:84px;height:auto;filter:drop-shadow(0 12px 20px rgba(31,78,168,.25))}
`;

function page(req, { title, clinic, step, body }) {
  const nav = clinic
    ? `<nav class="steps">
        <div class="clinic">${esc(clinic.name)}<br><span class="badge b-${esc(clinic.status)}">${esc(clinic.status)}</span></div>
        ${STEPS.map((s, i) => {
          const done = stepDone(clinic, s.key);
          return `<a href="/onboarding/${clinic.id}/${s.key}" class="${s.key === step ? 'cur' : ''} ${done ? 'done' : ''}"><span class="n">${done ? '✓' : i + 1}</span>${esc(s.title)}</a>`;
        }).join('')}
        <a href="/onboarding" style="margin-top:8px">← Todas las clínicas</a>
      </nav>`
    : '';
  const flash = [
    req.query.ok ? `<div class="ok">${esc(req.query.ok === '1' ? 'Guardado correctamente.' : req.query.ok)}</div>` : '',
    req.query.error ? `<div class="err">${esc(req.query.error)}</div>` : '',
  ].join('');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · CitaDental AI</title>${brand.HEAD}<style>${CSS}</style></head><body>${brand.BG}
<header class="topbar"><a href="/onboarding" class="logo-link" style="text-decoration:none">${brand.logo('Alta de clínicas')}</a><nav><span class="who">${esc(req.dashboardEmail || '')}</span><a href="/onboarding">Clínicas</a><a href="/onboarding/salud">${healthNavLabel()}</a><a href="/panel/c/1">Conversaciones demo</a><a href="/dashboard">Panel demo</a><a href="/dashboard/logout">Cerrar sesión</a></nav></header>
<div class="wrap ${clinic ? '' : 'single'}">${nav}<main class="card">${flash}${body}</main></div>${brand.FOOTER}
<script>document.querySelectorAll('form[data-busy]').forEach(f=>f.addEventListener('submit',()=>{const b=f.querySelector('button[type=submit]');if(b){b.disabled=true;b.textContent=f.dataset.busy;}}));</script>
</body></html>`;
}

function stepDone(clinic, key) {
  switch (key) {
    case 'web':
      return Boolean(clinic.website);
    case 'datos':
      return Boolean(clinic.info?.direccion && clinic.info?.horario);
    case 'agenda':
      return Boolean(clinic.calendar_provider && clinic.schedule?.hours);
    case 'calendario':
      return Boolean(clinic.google_refresh_token);
    case 'whatsapp':
      return Boolean(clinic.whatsapp_phone || clinic.whatsapp_phone_number_id);
    case 'recepcion':
      return Boolean(clinic.reception_phone || clinic.reception_email);
    case 'prueba':
      return Boolean(db.prepare("SELECT 1 FROM conversations WHERE clinic_id = ? AND phone LIKE 'prueba-%'").get(clinic.id));
    case 'activar':
      return clinic.status === 'activa';
    default:
      return false;
  }
}

function nextStep(key) {
  const i = STEPS.findIndex((s) => s.key === key);
  return STEPS[i + 1]?.key || 'activar';
}

function go(res, clinic, step, params = {}) {
  const q = new URLSearchParams(params).toString();
  res.redirect(`/onboarding/${clinic.id}/${step}${q ? '?' + q : ''}`);
}

function stepActions(clinic, step, { submit = 'Guardar y continuar', back = true } = {}) {
  const i = STEPS.findIndex((s) => s.key === step);
  const prev = STEPS[i - 1];
  return `<div class="actions">${back && prev ? `<a class="btn sec" href="/onboarding/${clinic.id}/${prev.key}">← ${esc(prev.title)}</a>` : '<span></span>'}
    <button class="btn" type="submit">${esc(submit)}</button></div>`;
}

// Carga la clínica de la URL (nunca la demo) o 404.
function loadClinic(req, res, next) {
  // Solo ids numéricos: /onboarding/demo/... y /onboarding/nueva son otras rutas.
  if (!/^\d+$/.test(req.params.id)) return next('route');
  const clinic = clinics.getClinicById(Number(req.params.id));
  if (!clinic || clinic.isDemo) return res.status(404).send(page(req, { title: 'No encontrada', body: '<h1>Clínica no encontrada</h1><p><a href="/onboarding">Volver</a></p>' }));
  req.clinic = clinic;
  next();
}

router.use('/onboarding', auth.requireDashboardAuth);

// ---------------------------------------------------------------------------
// Listado de clínicas
// ---------------------------------------------------------------------------
router.get('/onboarding', (req, res) => {
  const list = clinics.listClinics().filter((c) => !c.isDemo);
  const monthCount = db.prepare("SELECT COUNT(*) n FROM message_log WHERE clinic_id = ? AND created_at >= date('now','start of month')");
  const rows = list
    .map((c) => {
      const pending = STEPS.find((s) => !stepDone(c, s.key));
      return `<tr>
        <td><strong>${esc(c.name)}</strong><br><small class="mono">${esc(c.website || '')}</small></td>
        <td><span class="badge b-${esc(c.status)}">${esc(c.status)}</span></td>
        <td>${esc(c.whatsapp_display_phone || '—')}</td>
        <td>${monthCount.get(c.id).n}</td>
        <td>${pending ? `Pendiente: ${esc(pending.title)}` : !realMessageReceived(c) ? '<span style="color:#A34E12;font-weight:600">⚠️ No ha llegado ningún mensaje al número</span>' : '✓ Completo'}</td>
        <td style="text-align:right;white-space:nowrap"><a class="btn sec" href="/panel/c/${c.id}">Conversaciones</a> <a class="btn sec" href="/onboarding/${c.id}/${pending ? pending.key : 'activar'}">${c.status === 'activa' ? 'Gestionar' : 'Continuar'}</a>
          ${deleteForm(c, { compact: true })}</td>
      </tr>`;
    })
    .join('');
  res.send(
    page(req, {
      title: 'Clínicas',
      body: `${healthBanner()}<div class="actions" style="margin-top:0"><div class="hello"><img src="${brand.MASCOT_URL}" alt="" class="float"><div><span class="eyebrow"><i></i>Panel de CitaDental AI</span><h1 style="margin-top:8px">Tus <span class="text-gradient">clínicas</span></h1><p class="sub" style="margin:0">${list.length ? `${list.length} clínica${list.length === 1 ? '' : 's'} · ${list.filter((c) => c.status === 'activa').length} activa${list.filter((c) => c.status === 'activa').length === 1 ? '' : 's'}. Da de alta una nueva o continúa un alta a medias.` : 'Da de alta tu primera clínica.'}</p></div></div>
        <span><a class="btn sec" href="/panel/c/1">Conversaciones demo</a> <a class="btn sec" href="/onboarding/demo/whatsapp">WhatsApp de la demo</a> <a class="btn" href="/onboarding/nueva">+ Nueva clínica</a></span></div>
        ${list.length ? `<div style="overflow-x:auto;margin-top:18px"><table><thead><tr><th>Clínica</th><th>Estado</th><th>WhatsApp</th><th>Mensajes este mes</th><th>Progreso</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div style="padding:30px 0">${brand.mascot('Todavía no hay clínicas. Pulsa <b>«+ Nueva clínica»</b> y te guío paso a paso.', { size: 120 })}</div>`}`,
    })
  );
});

// ---------------------------------------------------------------------------
// Estado del servicio: vigilancia, avisos por email y copias de seguridad
// ---------------------------------------------------------------------------
const LEVEL_ICON = { red: '🔴', yellow: '🟡', green: '🟢' };

function healthSummary() {
  const st = health.lastState();
  if (!st) return null;
  const all = [...(st.global || []), ...Object.values(st.clinics || {}).flatMap((c) => c.issues)];
  return { st, reds: all.filter((i) => i.level === 'red').length, yellows: all.filter((i) => i.level === 'yellow').length };
}

function healthNavLabel() {
  const h = healthSummary();
  if (!h) return 'Estado';
  return h.reds ? `🔴 Estado (${h.reds})` : h.yellows ? 'Estado 🟡' : 'Estado 🟢';
}

function healthBanner() {
  const h = healthSummary();
  if (!h || !h.reds) return '';
  return `<div class="err" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><span><strong>🔴 Hay ${h.reds} problema(s) importante(s)</strong> en el servicio.</span><a class="btn sec" href="/onboarding/salud">Ver estado</a></div>`;
}

router.get('/onboarding/salud', (req, res) => {
  const st = health.lastState();
  const issueList = (issues) =>
    issues.length
      ? issues.map((i) => `<div class="check"><span class="i">${LEVEL_ICON[i.level]}</span><span style="flex:1">${esc(i.text)}</span></div>`).join('')
      : '<div class="check"><span class="i">🟢</span><span>Todo bien.</span></div>';
  const clinicsHtml = st
    ? Object.entries(st.clinics || {})
        .map(([id, c]) => `<h2 style="display:flex;align-items:center;gap:8px">${LEVEL_ICON[c.level]} ${esc(c.name)} <a class="hint" href="${c.demo ? '/onboarding/demo/whatsapp' : `/onboarding/${id}/activar`}" style="font-size:13px;font-weight:500">gestionar</a></h2>${issueList(c.issues)}`)
        .join('') || '<p class="hint">No hay clínicas activas.</p>'
    : '';
  const last = backup.lastBackup();
  const files = backup.listBackups();
  res.send(
    page(req, {
      title: 'Estado',
      body: `<span class="eyebrow ${st && !healthSummary().reds ? 'live' : ''}"><i></i>Vigilancia automática cada hora</span>
        <h1 style="margin-top:8px">Estado del <span class="text-gradient">servicio</span></h1>
        <p class="sub">Cada hora se revisa cada clínica activa: que su número esté conectado y reciba mensajes, que WhatsApp acepte las respuestas, Google Calendar, la plantilla de recordatorio y la IA. Si aparece un problema nuevo (o se resuelve), te llega un email a <strong>${esc(mailer.recipient())}</strong>.</p>
        <div class="actions" style="margin-top:0">
          <span class="hint">${st ? `Última revisión: ${esc(new Date(st.checkedAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }))}` : 'Todavía no se ha hecho ninguna revisión.'}</span>
          <form method="post" action="/onboarding/salud/revisar" data-busy="Revisando…"><button class="btn" type="submit">Revisar ahora</button></form>
        </div>
        <h2>General</h2>
        ${st ? issueList(st.global || []) : ''}
        ${clinicsHtml}
        <h2>Avisos por email</h2>
        ${
          mailer.isConfigured()
            ? `<div class="ok">Activados: se envían desde <strong>${esc(mailer.sender())}</strong> a <strong>${esc(mailer.recipient())}</strong>.</div>
               <form method="post" action="/onboarding/salud/email-prueba" data-busy="Enviando…"><button class="btn sec" type="submit">Enviar email de prueba</button></form>`
            : `<div class="warn"><strong>Desactivados.</strong> Para activarlos, en Render → <em>citadental-ai-bot → Environment</em> añade la variable <code>SMTP_PASS</code> con la contraseña del buzón <strong>${esc(mailer.sender())}</strong> (la de Hostinger) y guarda. No hace falta nada más.</div>`
        }
        <h2>Copias de seguridad</h2>
        <p class="hint">Cada día se hace una copia de la base de datos (clínicas, conversaciones, configuración), se guardan las últimas 14 en el servidor y se envía por email para tenerla fuera de Render. Además, Render guarda una instantánea diaria del disco.</p>
        <div class="${last ? 'ok' : 'info'}">${last ? `Última copia: <strong>${esc(new Date(last.at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }))}</strong> · ${(last.size / 1024).toFixed(0)} KB · ${last.emailed ? 'enviada por email ✅' : 'no enviada por email (avisos desactivados)'}` : 'Todavía no hay copias.'}</div>
        ${files.length ? `<p class="hint">En el servidor: ${files.map((f) => esc(f.name)).join(' · ')}</p>` : ''}
        <div class="actions" style="justify-content:flex-start">
          <a class="btn sec" href="/onboarding/salud/descargar">Descargar copia ahora</a>
          <form method="post" action="/onboarding/salud/copia" data-busy="Haciendo copia…"><button class="btn sec" type="submit">Hacer copia y enviarla por email</button></form>
        </div>`,
    })
  );
});

router.post('/onboarding/salud/revisar', async (req, res) => {
  try {
    await health.runChecks();
    res.redirect('/onboarding/salud?ok=' + encodeURIComponent('Revisión hecha.'));
  } catch (err) {
    res.redirect('/onboarding/salud?error=' + encodeURIComponent(`No se pudo revisar: ${err.message}`));
  }
});

router.post('/onboarding/salud/email-prueba', async (req, res) => {
  const ok = await mailer.send({ subject: '✅ Prueba de avisos de CitaDental AI', text: 'Si lees esto, los avisos por email funcionan.' });
  res.redirect('/onboarding/salud?' + (ok ? 'ok=' + encodeURIComponent(`Email de prueba enviado a ${mailer.recipient()}.`) : 'error=' + encodeURIComponent('No se pudo enviar. Revisa SMTP_PASS en Render.')));
});

router.post('/onboarding/salud/copia', async (req, res) => {
  const r = await backup.runDailyBackup({ force: true });
  res.redirect('/onboarding/salud?' + (r.ok ? 'ok=' + encodeURIComponent(`Copia hecha (${(r.size / 1024).toFixed(0)} KB)${r.emailed ? ' y enviada por email' : ''}.`) : 'error=' + encodeURIComponent(`Error en la copia: ${r.error}`)));
});

router.get('/onboarding/salud/descargar', (req, res) => {
  try {
    const buf = backup.freshBackupBuffer();
    const day = new Date().toISOString().slice(0, 10);
    res.set({ 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="citadental-${day}.sqlite.gz"`, 'Cache-Control': 'no-store' });
    res.send(buf);
  } catch (err) {
    res.redirect('/onboarding/salud?error=' + encodeURIComponent(`No se pudo hacer la copia: ${err.message}`));
  }
});

// ---------------------------------------------------------------------------
// Paso 1: web de la clínica (crea la clínica y extrae datos con IA)
// ---------------------------------------------------------------------------
function webForm(req, clinic) {
  const action = clinic ? `/onboarding/${clinic.id}/web` : '/onboarding/nueva';
  return page(req, {
    title: 'Web de la clínica',
    clinic,
    step: 'web',
    body: `<h1>1. Web de la clínica</h1>
      <p class="sub">Leeremos la web y rellenaremos automáticamente dirección, horario, tratamientos, precios y mutuas. En el siguiente paso podrás revisarlo todo.</p>
      <form method="post" action="${action}" data-busy="Leyendo la web… (puede tardar un minuto)">
        <label>Nombre de la clínica</label>
        <input type="text" name="name" required value="${esc(clinic?.name || '')}" placeholder="Clínica Dental Sonrisa">
        <label>Web de la clínica <span class="hint">(opcional: si no tiene, rellenarás los datos a mano)</span></label>
        <input type="text" name="website" value="${esc(clinic?.website || '')}" placeholder="www.clinicasonrisa.es">
        ${clinic ? '<div class="info" style="margin-top:14px">Volver a leer la web sustituirá los datos del paso 2 por los nuevos.</div>' : ''}
        <div class="actions"><a class="btn sec" href="/onboarding">Cancelar</a><button class="btn" type="submit">${clinic ? 'Volver a leer la web' : 'Crear clínica y leer la web'}</button></div>
      </form>`,
  });
}

async function runExtraction(clinic, website) {
  if (!website) return { ok: 'Clínica creada. Rellena sus datos.' };
  try {
    const { info, pagesRead } = await extractClinicInfo(website);
    if (!info.nombre) info.nombre = clinic.name;
    clinics.updateClinic(clinic.id, { info_json: info });
    const filled = INFO_FIELDS.filter((f) => info[f.key]).length;
    return { ok: `He leído ${pagesRead.length} página(s) y rellenado ${filled} de ${INFO_FIELDS.length} campos. Revisa que todo sea correcto.` };
  } catch (err) {
    console.error('Error leyendo la web de la clínica:', err);
    return { error: `No he podido leer la web (${err.message}). Rellena los datos a mano.` };
  }
}

router.get('/onboarding/nueva', (req, res) => res.send(webForm(req, null)));

router.post('/onboarding/nueva', form, async (req, res) => {
  let clinic;
  try {
    clinic = clinics.createClinic({ name: req.body.name, website: (req.body.website || '').trim() || null });
  } catch (err) {
    return res.redirect(`/onboarding/nueva?error=${encodeURIComponent(err.message)}`);
  }
  clinics.updateClinic(clinic.id, { onboarding_step: 'datos', info_json: { nombre: clinic.name } });
  const result = await runExtraction(clinic, clinic.website);
  go(res, clinic, 'datos', result);
});

router.get('/onboarding/:id/web', loadClinic, (req, res) => res.send(webForm(req, req.clinic)));

router.post('/onboarding/:id/web', loadClinic, form, async (req, res) => {
  const website = (req.body.website || '').trim() || null;
  const clinic = clinics.updateClinic(req.clinic.id, { name: (req.body.name || req.clinic.name).trim(), website });
  const result = await runExtraction(clinic, website);
  go(res, clinic, 'datos', result);
});

// ---------------------------------------------------------------------------
// Paso 2: datos de la clínica
// ---------------------------------------------------------------------------
router.get('/onboarding/:id/datos', loadClinic, (req, res) => {
  const { clinic } = req;
  const fields = INFO_FIELDS.map(
    (f) => `<label>${esc(f.label)}</label>${
      f.multiline
        ? `<textarea name="${f.key}">${esc(clinic.info[f.key] || '')}</textarea>`
        : `<input type="text" name="${f.key}" value="${esc(clinic.info[f.key] || '')}">`
    }`
  ).join('');
  res.send(
    page(req, {
      title: 'Datos de la clínica',
      clinic,
      step: 'datos',
      body: `<h1>2. Datos de la clínica</h1>
        <p class="sub">El asistente responderá a los pacientes <strong>solo</strong> con esta información y nunca inventará nada. Lo que no esté aquí, lo derivará al equipo.</p>
        <form method="post">${fields}${stepActions(clinic, 'datos')}</form>`,
    })
  );
});

router.post('/onboarding/:id/datos', loadClinic, form, (req, res) => {
  const info = {};
  for (const f of INFO_FIELDS) info[f.key] = String(req.body[f.key] || '').trim();
  const clinic = clinics.updateClinic(req.clinic.id, {
    info_json: info,
    name: info.nombre || req.clinic.name,
    onboarding_step: 'agenda',
  });
  go(res, clinic, nextStep('datos'), { ok: 1 });
});

// ---------------------------------------------------------------------------
// Paso 3: agenda (programa de gestión, horario y tratamientos)
// ---------------------------------------------------------------------------
router.get('/onboarding/:id/agenda', loadClinic, (req, res) => {
  const { clinic } = req;
  const sch = agenda.scheduleOf(clinic);
  const provider = clinic.calendar_provider || 'google';
  const hoursRows = DAYS.map(({ n, name }) => {
    const r = sch.hours[n] || sch.hours[String(n)] || [];
    const [m, t] = [r[0] || ['', ''], r[1] || ['', '']];
    return `<tr><td><strong>${name}</strong></td>
      <td class="range"><input type="time" name="h${n}_1a" value="${esc(m[0])}"> – <input type="time" name="h${n}_1b" value="${esc(m[1])}"></td>
      <td class="range"><input type="time" name="h${n}_2a" value="${esc(t[0])}"> – <input type="time" name="h${n}_2b" value="${esc(t[1])}"></td></tr>`;
  }).join('');
  const treatments = [...sch.treatments, ...Array.from({ length: 4 }, () => ({ key: '', nombre: '', duracion: '' }))];
  const tRows = treatments
    .map(
      (t, i) => `<tr><td><input type="text" name="t${i}_nombre" value="${esc(t.nombre)}" placeholder="p. ej. Blanqueamiento"></td>
      <td style="width:140px"><input type="number" min="10" max="240" step="5" name="t${i}_dur" value="${esc(t.duracion)}" placeholder="min"></td>
      <input type="hidden" name="t${i}_key" value="${esc(t.key)}"></tr>`
    )
    .join('');
  res.send(
    page(req, {
      title: 'Agenda',
      clinic,
      step: 'agenda',
      body: `<h1>3. Agenda y horario</h1>
        <p class="sub">Con esto el asistente sabe qué huecos puede ofrecer. Las citas se crean en el Google Calendar de la clínica y los huecos ocupados de ese calendario nunca se ofrecen.</p>
        <form method="post">
          <h2>¿Qué programa usa la clínica para la agenda?</h2>
          ${PROVIDERS.map(
            (p) => `<label class="provider ${p.disabled ? 'dis' : ''}"><input type="radio" name="provider" value="${p.key}" ${p.key === provider ? 'checked' : ''} ${p.disabled ? 'disabled' : ''}>
              <span><strong>${esc(p.name)}</strong><br><span class="hint">${esc(p.desc)}</span></span></label>`
          ).join('')}
          <h2>Horario de citas</h2>
          <p class="hint">Deja en blanco los días o tramos sin citas. Para bloquear vacaciones o festivos basta con crear un evento de día completo en el calendario.</p>
          <table><thead><tr><th>Día</th><th>Mañana</th><th>Tarde</th></tr></thead><tbody>${hoursRows}</tbody></table>
          <h2>Tratamientos que se pueden reservar</h2>
          <p class="hint">Duración de la cita en minutos. Deja el nombre vacío para quitar un tratamiento.</p>
          <table><thead><tr><th>Tratamiento</th><th>Duración</th></tr></thead><tbody>${tRows}</tbody></table>
          <div class="grid2">
            <div><label>Antelación mínima <span class="hint">(horas)</span></label><input type="number" min="0" max="72" name="min_notice_hours" value="${esc(sch.min_notice_hours)}"></div>
            <div><label>Reservar con hasta <span class="hint">(días vista)</span></label><input type="number" min="1" max="90" name="horizon_days" value="${esc(sch.horizon_days)}"></div>
            <div><label>Intervalo entre citas <span class="hint">(minutos)</span></label>
              <select name="slot_step_min">${[10, 15, 20, 30, 45, 60].map((m) => `<option ${Number(sch.slot_step_min) === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
          </div>
          ${stepActions(clinic, 'agenda')}
        </form>`,
    })
  );
});

router.post('/onboarding/:id/agenda', loadClinic, form, (req, res) => {
  const b = req.body;
  const valid = (t) => /^\d{2}:\d{2}$/.test(t || '');
  const hours = {};
  for (const { n } of DAYS) {
    hours[n] = [];
    for (const k of ['1', '2']) {
      const a = b[`h${n}_${k}a`];
      const z = b[`h${n}_${k}b`];
      if (valid(a) && valid(z) && a < z) hours[n].push([a, z]);
    }
  }
  const treatments = [];
  const usedKeys = new Set();
  for (let i = 0; b[`t${i}_nombre`] !== undefined; i++) {
    const nombre = String(b[`t${i}_nombre`] || '').trim();
    if (!nombre) continue;
    let key = String(b[`t${i}_key`] || '').trim() || clinics.slugify(nombre).replace(/-/g, '_').slice(0, 30);
    while (usedKeys.has(key)) key += '_2';
    usedKeys.add(key);
    treatments.push({ key, nombre, duracion: Math.min(240, Math.max(10, Number(b[`t${i}_dur`]) || 30)) });
  }
  if (!treatments.length) return go(res, req.clinic, 'agenda', { error: 'Añade al menos un tratamiento.' });
  if (!Object.values(hours).some((r) => r.length)) return go(res, req.clinic, 'agenda', { error: 'Indica al menos un día con horario de citas.' });
  const provider = PROVIDERS.find((p) => p.key === b.provider && !p.disabled)?.key || 'google';
  const clinic = clinics.updateClinic(req.clinic.id, {
    calendar_provider: provider,
    onboarding_step: 'calendario',
    schedule_json: {
      timezone: 'Europe/Madrid',
      hours,
      treatments,
      min_notice_hours: Math.min(72, Math.max(0, Number(b.min_notice_hours) || 0)),
      horizon_days: Math.min(90, Math.max(1, Number(b.horizon_days) || 21)),
      slot_step_min: [10, 15, 20, 30, 45, 60].includes(Number(b.slot_step_min)) ? Number(b.slot_step_min) : 30,
    },
  });
  go(res, clinic, nextStep('agenda'), { ok: 1 });
});

// ---------------------------------------------------------------------------
// Paso 4: conectar el Google Calendar de la clínica
// ---------------------------------------------------------------------------
router.get('/onboarding/:id/calendario', loadClinic, async (req, res) => {
  const { clinic } = req;
  const dedicated = ['gesden', 'cliniccloud'].includes(clinic.calendar_provider);
  let status = '';
  if (clinic.google_refresh_token) {
    try {
      await gcal.ping(clinic);
      const free = await agenda.computeFreeSlots(clinic, { limit: 3 });
      status = `<div class="ok">✓ Google Calendar conectado y funcionando.${
        free.length ? ` Próximos huecos libres: ${free.map((f) => `${f.date} ${f.time}`).join(', ')}.` : ' No hay huecos libres en el horario configurado (revisa el paso 3).'
      }</div>`;
    } catch (err) {
      status = `<div class="err">La conexión con Google Calendar no funciona: ${esc(err.message)}. Vuelve a conectarlo.</div>`;
    }
  }
  res.send(
    page(req, {
      title: 'Calendario',
      clinic,
      step: 'calendario',
      body: `<h1>4. Conectar el calendario</h1>
        ${status}
        ${
          dedicated
            ? `<div class="info"><strong>La clínica usa ${esc(PROVIDERS.find((p) => p.key === clinic.calendar_provider).name)}.</strong> Como no permite conexión directa, las citas del asistente irán a un <strong>Google Calendar dedicado</strong>. Recomendado: crear una cuenta de Google solo para esto (p. ej. <em>citas.nombreclinica@gmail.com</em>) y que recepción la tenga abierta para pasar las citas a su programa. Para bloquear horas, recepción crea eventos en ese calendario.</div>`
            : '<p class="sub">Inicia sesión con la cuenta de Google <strong>de la clínica</strong> (la de su agenda). Se usará su calendario principal: el asistente lo consultará para ver los huecos libres y creará ahí las citas.</p>'
        }
        <ol class="guide">
          <li>Pulsa el botón y elige la cuenta de Google de la clínica.</li>
          <li>Si aparece «Google no ha verificado esta aplicación», pulsa <em>Configuración avanzada → Ir a citadentalai.site</em>.</li>
          <li>Acepta el permiso para ver y editar eventos del calendario.</li>
        </ol>
        <div class="actions">
          <a class="btn sec" href="/onboarding/${clinic.id}/agenda">← Agenda y horario</a>
          <span>
            ${clinic.google_refresh_token ? `<form method="post" action="/onboarding/${clinic.id}/calendario/desconectar" style="display:inline"><button class="btn sec" type="submit">Desconectar</button></form> ` : ''}
            <a class="btn ${clinic.google_refresh_token ? 'sec' : ''}" href="/onboarding/${clinic.id}/calendario/conectar">${clinic.google_refresh_token ? 'Conectar otra cuenta' : 'Conectar Google Calendar'}</a>
            ${clinic.google_refresh_token ? `<a class="btn" href="/onboarding/${clinic.id}/whatsapp">Continuar →</a>` : ''}
          </span>
        </div>`,
    })
  );
});

router.get('/onboarding/:id/calendario/conectar', loadClinic, (req, res) => {
  const state = `${crypto.randomBytes(16).toString('hex')}.c${req.clinic.id}`;
  res.append('Set-Cookie', `citadental_calendar_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  res.redirect(calendar.buildCalendarAuthUrl(req, state, { selectAccount: true }));
});

router.post('/onboarding/:id/calendario/desconectar', loadClinic, (req, res) => {
  const clinic = clinics.updateClinic(req.clinic.id, { google_refresh_token: null });
  go(res, clinic, 'calendario', { ok: 'Calendario desconectado.' });
});

// ---------------------------------------------------------------------------
// Paso 5: WhatsApp (a través de YCloud, en coexistencia con la app)
// ---------------------------------------------------------------------------
const YCLOUD_EVENTS = ['whatsapp.inbound_message.received', 'whatsapp.smb.message.echoes', 'whatsapp.template.reviewed'];

function publicBaseUrl(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// Se asegura de que la cuenta de YCloud manda los mensajes a este bot. El
// secreto de firma solo lo da YCloud al crear el endpoint: se guarda en la BD
// (disco del servidor) y nunca se muestra.
async function ensureYCloudWebhook(req) {
  const url = `${publicBaseUrl(req)}/webhook/ycloud`;
  const haveSecret =
    process.env.YCLOUD_WEBHOOK_SECRET || db.prepare("SELECT value FROM settings WHERE key = 'ycloud_webhook_secret'").get()?.value;
  const list = await ycloud.listWebhookEndpoints();
  const existing = (list?.items || []).find((e) => e.url === url);
  if (existing && haveSecret) return 'ya configurado';
  if (existing && !haveSecret) {
    throw new Error(
      `Ya existe un webhook de YCloud hacia ${url} pero no tengo su secreto. Bórralo en YCloud (Developers → Webhooks) y vuelve a pulsar «Comprobar y conectar».`
    );
  }
  const created = await ycloud.createWebhookEndpoint({ url, enabledEvents: YCLOUD_EVENTS, description: 'CitaDental AI bot' });
  if (!created?.secret) throw new Error('YCloud no devolvió el secreto del webhook');
  db.prepare("INSERT INTO settings (key, value) VALUES ('ycloud_webhook_secret', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    created.secret
  );
  return 'creado';
}

// Paso 5 (con número conectado): recordatorios y texto de la plantilla.
function reminderSection(clinic) {
  const tplStatus = clinic.reminder_template_status;
  const hours = reminders.reminderHours(clinic);
  const select = (i) => {
    const cur = hours[i];
    const opts = [`<option value="">${i === 0 ? 'Sin recordatorios' : 'No enviar'}</option>`]
      .concat(reminders.HOUR_OPTIONS.map((h) => `<option value="${h}"${h === cur ? ' selected' : ''}>${esc(reminders.hoursLabel(h))}</option>`))
      .join('');
    return `<div><label style="margin-top:8px">Recordatorio ${i + 1}</label><select name="h${i}">${opts}</select></div>`;
  };
  const text = templates.clinicText(clinic);
  const tokens = Object.entries(templates.TOKENS)
    .map(([k, t]) => `<button type="button" class="btn sec tok" data-tok="{${k}}" style="padding:5px 12px;font-size:13px">{${k}} <span class="hint">${esc(t.label)}</span></button>`)
    .join(' ');
  const examples = JSON.stringify(Object.fromEntries(Object.entries(templates.TOKENS).map(([k, t]) => [k, t.example]))).replace(/</g, '\\u003c');
  const sentText = clinic.reminder_template_name ? clinic.reminder_template_text || templates.DEFAULT_TEXT : null;
  return `<h2>Recordatorios de cita</h2>
    <p class="hint">Elige cuántos recordatorios recibe cada paciente y cuánto antes de su cita (máximo ${reminders.MAX_REMINDERS}).</p>
    <form method="post" action="/onboarding/${clinic.id}/recordatorios">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 14px">${[0, 1, 2].map(select).join('')}</div>
      <div class="actions" style="margin-top:12px"><span class="hint">Ahora: ${hours.length ? esc(hours.map(reminders.hoursLabel).join(' · ')) : 'sin recordatorios'}</span><button class="btn sec" type="submit">Guardar recordatorios</button></div>
    </form>
    <h2>Texto del recordatorio</h2>
    <p class="hint">Para escribir a un paciente que no ha hablado con la clínica en las últimas 24 h, WhatsApp exige una plantilla <strong>aprobada por Meta</strong>. Revisa el texto y envíalo a aprobación. Usa los huecos (pulsa para insertarlos); se rellenan solos en cada recordatorio.</p>
    ${
      clinic.reminder_template_name
        ? `<div class="${templates.isApproved(tplStatus) ? 'ok' : tplStatus === 'REJECTED' ? 'err' : 'info'}">Plantilla enviada (<small class="mono">${esc(clinic.reminder_template_name)}</small>): <strong>${esc(TEMPLATE_LABEL[tplStatus] || tplStatus || 'sin estado')}</strong>
           ${tplStatus === 'REJECTED' ? '<br>Meta la ha rechazado: cambia el texto y vuelve a enviarla (mira el motivo en YCloud → Templates).' : ''}
           <form method="post" action="/onboarding/${clinic.id}/whatsapp/plantilla" style="display:inline;margin-left:8px"><button class="btn sec" type="submit" style="padding:5px 12px;font-size:13px">Actualizar estado</button></form></div>`
        : '<div class="info">Todavía no se ha enviado a Meta.</div>'
    }
    <form method="post" action="/onboarding/${clinic.id}/whatsapp/plantilla/enviar" data-busy="Enviando a Meta…" ${clinic.reminder_template_name ? `onsubmit="return document.getElementById('tpltext').value.trim()===${esc(JSON.stringify(sentText || ''))}.trim() ? (alert('Es el mismo texto que ya se envió. Cámbialo o pulsa «Actualizar estado».'), false) : confirm('Se enviará como plantilla nueva. Mientras Meta la revisa, los recordatorios solo llegarán a quien escribió en las últimas 24 h. ¿Continuar?')"` : ''}>
      <div style="margin:6px 0">${tokens}</div>
      <textarea id="tpltext" name="text" maxlength="${templates.MAX_LEN}" style="min-height:110px">${esc(text)}</textarea>
      <label>Vista previa</label>
      <div id="tplprev" class="msg bot" style="max-width:100%;background:#fff;border:1px solid var(--border);border-radius:12px;padding:12px 14px;white-space:pre-wrap"></div>
      <div class="actions"><button type="button" class="btn sec" onclick="document.getElementById('tpltext').value=${esc(JSON.stringify(templates.DEFAULT_TEXT))};upd()">Restaurar texto por defecto</button><button class="btn" type="submit">Enviar a Meta para aprobación</button></div>
    </form>
    <script>(function(){const ex=${examples};const ta=document.getElementById('tpltext');const pv=document.getElementById('tplprev');
      window.upd=function(){pv.textContent=ta.value.replace(/\\{([a-z]+)\\}/g,(m,k)=>ex[k]||m);};ta.addEventListener('input',upd);upd();
      document.querySelectorAll('.tok').forEach(b=>b.addEventListener('click',()=>{const t=b.dataset.tok,s=ta.selectionStart,e=ta.selectionEnd;ta.value=ta.value.slice(0,s)+t+ta.value.slice(e);ta.focus();ta.selectionStart=ta.selectionEnd=s+t.length;upd();}));})();</script>
    <h2>Probar un recordatorio</h2>
    <p class="hint">Envía a un móvil un recordatorio de una cita ficticia (mañana a las 10:00) para ver cómo llega. Si ese móvil escribió a la clínica en las últimas 24 h sale como mensaje normal; si no, hace falta la plantilla aprobada.</p>
    <form method="post" action="/onboarding/${clinic.id}/recordatorio-prueba" data-busy="Enviando…" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <label style="margin:0 0 4px;width:100%">Móvil al que enviarlo <span class="hint">(con prefijo, sin + ni espacios)</span></label><input type="tel" name="phone" required placeholder="Ej.: 34662270093" value="${esc(clinic.reception_phone || '')}" style="max-width:260px">
      <button class="btn sec" type="submit">Enviar recordatorio de prueba</button>
    </form>
    <div class="actions" style="border-top:1px solid var(--border);padding-top:18px">
      <span class="hint">${clinic.reminder_template_name ? 'Puedes seguir mientras Meta revisa la plantilla.' : 'Puedes enviar la plantilla ahora o más tarde.'}</span>
      <a class="btn green" href="/onboarding/${clinic.id}/recepcion">Continuar: avisos a recepción →</a></div>`;
}

const TEMPLATE_LABEL = {
  APPROVED: '✅ Aprobada',
  PENDING: '⏳ En revisión por Meta (suele tardar de minutos a unas horas)',
  REJECTED: '❌ Rechazada',
  IN_APPEAL: '⏳ En apelación',
  PAUSED: '⚠️ Pausada por Meta',
  DISABLED: '❌ Desactivada por Meta',
};

router.get('/onboarding/:id/whatsapp', loadClinic, (req, res) => {
  const { clinic } = req;
  const connected = clinic.whatsapp_provider === 'ycloud' && clinic.whatsapp_phone;
  const tplStatus = clinic.reminder_template_status;
  res.send(
    page(req, {
      title: 'WhatsApp',
      clinic,
      step: 'whatsapp',
      body: `<h1>5. Conectar WhatsApp</h1>
        <p class="sub">El número de la clínica se conecta a través de <strong>YCloud</strong> y el asistente responde por ese mismo número. Si la clínica solo usa la app de WhatsApp Business, se hace en <strong>coexistencia</strong> (sigue usando su app); si ya está en otro programa, se <strong>migra</strong>.</p>
        ${connected ? `<div class="ok">✓ Número conectado: <strong>${esc(clinic.whatsapp_display_phone || clinic.whatsapp_phone)}</strong></div>` : ''}
        ${
          connected
            ? reminderSection(clinic)
            : ''
        }
        <h2>${connected ? 'Cambiar de número' : 'Cómo conectarlo'}</h2>
        <label>¿Este número ya está conectado a otro programa o chatbot de WhatsApp? <span class="hint">(Wati, Twilio, 360dialog, ManyChat, su CRM, otro proveedor…)</span></label>
        <label class="provider"><input type="radio" name="ya_conectado" value="no" checked onchange="toggleGuide()"><span><strong>No</strong><br><span class="hint">Solo usan la app de WhatsApp Business en el móvil (lo habitual).</span></span></label>
        <label class="provider"><input type="radio" name="ya_conectado" value="si" onchange="toggleGuide()"><span><strong>Sí</strong><br><span class="hint">Hay otro programa respondiendo o conectado a ese número.</span></span></label>
        <div class="info"><strong>Antes de empezar: acceso al Facebook de la clínica.</strong> Para conectar el número hace falta un Facebook que administre el negocio de la clínica en Meta. <strong>Nunca pidas su contraseña.</strong> Lo mejor es que la clínica te añada como administrador (puede hacerlo antes de la cita, desde cualquier ordenador):
          <ol class="guide" style="margin:8px 0 4px">
            <li>La clínica entra en <a href="https://business.facebook.com/latest/settings/business_users" target="_blank" rel="noopener">business.facebook.com → Configuración → Usuarios → Personas</a>.</li>
            <li>Pulsa <strong>«Agregar»</strong> (o «Invitar personas»), escribe tu email <strong>${esc(req.dashboardEmail || 'diegoezequiel02@gmail.com')}</strong> y elige <strong>Control total</strong> (administrador).</li>
            <li>En el siguiente paso, que te asigne la <strong>cuenta de WhatsApp</strong> de la clínica con <strong>control total</strong>, y pulsa <strong>«Enviar invitación»</strong>.</li>
            <li>Te llega un email de Meta: <strong>acepta la invitación</strong>. Desde ese momento haces todo con tu propio Facebook.</li>
          </ol>
          Si el día de la instalación no lo han hecho, vale también que el responsable de la clínica escriba <strong>él mismo</strong> su usuario y contraseña cuando se abra la ventana de Meta. Al terminar, la clínica puede quitarte el acceso o dejártelo para soporte.</div>
        <div id="guide-coex">
          <ol class="guide">
            <li>Ten a mano el <strong>móvil de la clínica</strong> con la app de <strong>WhatsApp Business</strong> (versión 2.24.17 o superior).</li>
            <li>Abre <a href="https://www.ycloud.com/console/" target="_blank" rel="noopener">YCloud</a> con la cuenta de CitaDental AI (<em>hola@citadentalai.site</em>). En el menú: <em>WhatsApp Manager → WhatsApp accounts</em> → botón <strong>«Create Channel»</strong> (arriba a la derecha).</li>
            <li>En la ventana que sale, elige <strong>«WhatsApp Business APP Coexistence» → «Get started»</strong>. Acepta el aviso y pulsa <strong>«I'm ready to start»</strong>: se abre una ventana de Meta.</li>
            <li>En la ventana de Meta: inicia sesión con el <strong>Facebook de la clínica</strong> (o uno que administre su negocio) → <strong>«Continuar»</strong>. Pon el <strong>nombre legal exacto</strong> de la empresa y su <strong>web real</strong> (nunca «no tengo web»).</li>
            <li>Cuando aparezca el QR, en el móvil de la clínica abre WhatsApp Business → <em>Ajustes → Dispositivos vinculados</em> (o el aviso que salga) y <strong>escanea el QR</strong>. Acepta compartir el historial si lo pregunta.</li>
            <li>En la pantalla final de Meta pulsa <strong>«Ir a la configuración de la función»</strong> y cierra la ventana.</li>
            <li>En YCloud, pestaña <strong>«WhatsApp Business APP»</strong>, espera a que el número salga como <strong>Connected</strong>. Si en 2 minutos no aparece, <strong>no repitas el alta</strong>: revisa antes.</li>
            <li>Escribe aquí abajo el número y pulsa <strong>«Comprobar y conectar»</strong>.</li>
          </ol>
        </div>
        <div id="guide-migr" style="display:none">
          <div class="info"><strong>Es una migración, no una coexistencia.</strong> La opción «Coexistence» de YCloud rechaza números que ya están en la API de WhatsApp.</div>
          <ol class="guide">
            <li><strong>Antes de la cita</strong>, la clínica debe avisar a su proveedor actual de que se van (o cancelar) y, si puede, desactivar la <strong>verificación en dos pasos (PIN)</strong> del número. Se hace en Meta → <em>Administrador de WhatsApp → Números de teléfono → ⚙ del número → Verificación en dos pasos → Desactivar</em> (llega un email para confirmar). Si esa opción no aparece, sigue: solo hará falta si Meta da error de PIN.</li>
            <li>Necesitas el <strong>Facebook que administra la cuenta de WhatsApp Business de la clínica</strong> (el suyo, o que te hayan añadido como administrador).</li>
            <li>Abre <a href="https://www.ycloud.com/console/" target="_blank" rel="noopener">YCloud</a> con la cuenta de CitaDental AI (<em>hola@citadentalai.site</em>). En el menú: <em>WhatsApp Manager → WhatsApp accounts</em> → botón <strong>«Create Channel»</strong> (arriba a la derecha).</li>
            <li>En la ventana que sale, elige <strong>«WhatsApp Business API» → «Get started»</strong>. <strong>No</strong> elijas «Coexistence».</li>
            <li>YCloud pregunta <em>«How would you like to connect your number?»</em>. Elige la segunda opción: <strong>«Connect an existing WhatsApp business platform account»</strong> (<em>Move a phone number connected to another BSP to YCloud</em>). <strong>No</strong> elijas «Create and connect a new…».</li>
            <li>Pulsa <strong>«I'm ready to start»</strong>: se abre una ventana de Meta. Pulsa <strong>«Continuar»</strong>.</li>
            <li>En <em>«Agrega tu número de teléfono de WhatsApp»</em>, abre el desplegable y elige <strong>el número de la clínica que aparece como «Registrado»</strong>. Ojo: pueden salir números de otras empresas a las que tenga acceso ese Facebook; elige solo el de la clínica. Pulsa <strong>«Siguiente»</strong>.</li>
            <li>En <em>«Activos comerciales»</em> el portfolio y la cuenta de WhatsApp se rellenan solos: comprueba que son los de la clínica y pulsa <strong>«Siguiente»</strong> hasta el final. En la última pantalla pulsa <strong>«Ir a la configuración de la función»</strong>.</li>
            <li><strong>Muy importante:</strong> en Meta → <em>Configuración del negocio → Cuentas de mensajes</em> → la cuenta de la clínica → pestaña <strong>«Socios»</strong>: debe quedar <strong>solo YCloud</strong>. Si aparece el proveedor antiguo, <em>Administrar → Eliminar acceso</em>. Si se queda, el asistente no podrá responder (error «another app is controlling this thread»).</li>
            <li>En YCloud, pestaña <strong>«WhatsApp Business API»</strong>, espera a que el número salga como <strong>Connected</strong>. Escríbelo aquí abajo y pulsa <strong>«Comprobar y conectar»</strong>.</li>
          </ol>
          <div class="info">Si además usaban la app de WhatsApp Business en coexistencia con el proveedor antiguo, confirma con YCloud antes que la app del móvil seguirá funcionando tras la migración.</div>
        </div>
        <script>function toggleGuide(){ const si=document.querySelector('input[name=ya_conectado][value=si]').checked; document.getElementById('guide-coex').style.display=si?'none':''; document.getElementById('guide-migr').style.display=si?'':'none'; }</script>
        <form method="post" data-busy="Comprobando con YCloud…">
          <label>Número de WhatsApp de la clínica <span class="hint">(con prefijo, p. ej. +34 600 11 22 33)</span></label>
          <input type="tel" name="phone" required value="${esc(clinic.whatsapp_phone || '')}" placeholder="+34 600 11 22 33">
          ${stepActions(clinic, 'whatsapp', { submit: 'Comprobar y conectar' })}
        </form>`,
    })
  );
});

// Conecta una clínica (o la demo) a su número en YCloud. Devuelve
// { ok: mensaje } o { error: mensaje }.
async function connectYCloud(req, clinic, rawPhone, extra = {}, { autoTemplate = false } = {}) {
  const phone = clinics.toE164(rawPhone);
  if (!phone || phone.length < 10) return { error: 'Escribe el número completo con prefijo (p. ej. +34 600 11 22 33).' };
  const other = clinics.getClinicByWhatsappPhone(phone);
  if (other && other.id !== clinic.id) return { error: `Ese número ya está asignado a «${other.name}».` };

  let number;
  try {
    number = await ycloud.findPhoneNumber(phone);
  } catch (err) {
    return { error: `No he podido consultar YCloud: ${err.message}` };
  }
  if (!number) return { error: `El número ${phone} no aparece en la cuenta de YCloud. Conéctalo primero en la consola de YCloud.` };
  if (number.status !== 'CONNECTED') {
    return { error: `YCloud muestra el número ${phone} con estado «${number.status}». Debe estar «CONNECTED» antes de continuar.` };
  }

  try {
    await ensureYCloudWebhook(req);
  } catch (err) {
    return { error: `Número correcto, pero no se pudo enlazar YCloud con el asistente: ${err.message}` };
  }

  const display = `${number.displayPhoneNumber || phone}${number.verifiedName ? ` (${number.verifiedName})` : ''}`;
  const updated = clinics.updateClinic(clinic.id, {
    whatsapp_provider: 'ycloud',
    whatsapp_phone: phone,
    whatsapp_waba_id: number.wabaId,
    whatsapp_display_phone: display,
    ...extra,
  });

  let tplMsg = autoTemplate ? '' : ' Revisa abajo los recordatorios y el texto de la plantilla y envíalo a Meta.';
  if (autoTemplate) try {
    const t = await templates.ensureReminderTemplate(updated);
    tplMsg = templates.isApproved(t.status) ? ' Plantilla de recordatorio aprobada.' : ' Plantilla de recordatorio enviada a Meta para su aprobación.';
  } catch (err) {
    tplMsg = ` Aviso: no se pudo crear la plantilla de recordatorio (${err.message}). Puedes reintentarlo.`;
  }
  return { ok: `Número ${display} conectado por YCloud.${tplMsg}` };
}

router.post('/onboarding/:id/whatsapp', loadClinic, form, async (req, res) => {
  const r = await connectYCloud(req, req.clinic, req.body.phone, { onboarding_step: 'whatsapp' });
  if (r.error) return go(res, req.clinic, 'whatsapp', { error: r.error });
  go(res, req.clinic, nextStep('whatsapp'), { ok: r.ok });
});

// Pasar el número de la DEMO (bot comercial) de Meta directo a YCloud. Se
// hace cuando su número ya está conectado en YCloud; a partir de ahí las
// copias que sigan llegando por Meta se ignoran (nunca contesta dos veces).
router.get('/onboarding/demo/whatsapp', (req, res) => {
  const demo = clinics.getDemoClinic();
  const viaYCloud = demo.whatsapp_provider === 'ycloud';
  res.send(
    page(req, {
      title: 'WhatsApp de la demo',
      body: `<h1>WhatsApp del bot comercial (demo)</h1>
        <div class="${viaYCloud ? 'ok' : 'info'}">Ahora mismo responde por: <strong>${viaYCloud ? `YCloud (${esc(demo.whatsapp_display_phone || demo.whatsapp_phone)})` : 'Meta directo'}</strong>
        · Plantilla de recordatorio: <strong>${esc(TEMPLATE_LABEL[demo.reminder_template_status] || demo.reminder_template_status || 'sin crear')}</strong></div>
        <p class="sub">Conecta primero el número de la demo en la consola de YCloud (coexistencia, escaneando el QR con el móvil de ese número). Después escríbelo aquí.</p>
        <form method="post" data-busy="Comprobando con YCloud…">
          <label>Número de la demo</label>
          <input type="tel" name="phone" required value="${esc(demo.whatsapp_phone || '+34 602 131 819')}">
          <div class="actions"><a class="btn sec" href="/onboarding">← Clínicas</a><button class="btn" type="submit">Pasar la demo a YCloud</button></div>
        </form>
        <h2>Probar un recordatorio</h2>
    <p class="hint">Envía a un móvil un recordatorio de una cita ficticia (mañana a las 10:00) para ver cómo llega. Si ese móvil escribió a la clínica en las últimas 24 h sale como mensaje normal; si no, hace falta la plantilla aprobada.</p>
    <form method="post" action="/onboarding/demo/recordatorio-prueba" data-busy="Enviando…" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <label style="margin:0 0 4px;width:100%">Móvil al que enviarlo <span class="hint">(con prefijo, sin + ni espacios)</span></label><input type="tel" name="phone" required placeholder="Ej.: 34662270093" value="" style="max-width:260px">
      <button class="btn sec" type="submit">Enviar recordatorio de prueba</button>
    </form>
        <h2>Panel de conversaciones (para enseñar a clínicas)</h2>
        <p class="hint">Enlace privado al panel de la demo, igual al que recibe la recepción de una clínica. Quien lo tenga ve los chats de la demo.</p>
        ${demo.panel_token ? `<input type="text" readonly value="${esc(`${publicBaseUrl(req)}/panel/${demo.panel_token}`)}" onclick="this.select()">` : ''}
        <form method="post" action="/onboarding/demo/panel-token"${demo.panel_token ? ` onsubmit="return confirm('El enlace actual dejará de funcionar. ¿Crear uno nuevo?')"` : ''}>
          <div class="actions" style="margin-top:10px"><a class="btn sec" href="/panel/c/${demo.id}" target="_blank">Ver conversaciones</a><button class="btn ${demo.panel_token ? 'sec' : ''}" type="submit">${demo.panel_token ? 'Crear enlace nuevo' : 'Crear enlace del panel'}</button></div>
        </form>`,
    })
  );
});

router.post('/onboarding/demo/panel-token', (req, res) => {
  clinics.updateClinic(clinics.getDemoClinic().id, { panel_token: require('./panel').newPanelToken(clinics.getDemoClinic()) });
  res.redirect('/onboarding/demo/whatsapp?ok=' + encodeURIComponent('Enlace del panel creado.'));
});

router.post('/onboarding/demo/whatsapp', form, async (req, res) => {
  const r = await connectYCloud(req, clinics.getDemoClinic(), req.body.phone, {}, { autoTemplate: true });
  const q = new URLSearchParams(r.error ? { error: r.error } : { ok: r.ok }).toString();
  res.redirect(`/onboarding/demo/whatsapp?${q}`);
});

router.post('/onboarding/:id/whatsapp/plantilla/enviar', loadClinic, form, async (req, res) => {
  try {
    const t = await templates.submitReminderTemplate(req.clinic, req.body.text);
    go(res, req.clinic, 'whatsapp', { ok: `Plantilla enviada a Meta (${t.name}): ${TEMPLATE_LABEL[t.status] || t.status}` });
  } catch (err) {
    go(res, req.clinic, 'whatsapp', { error: `No se pudo enviar la plantilla: ${err.message}` });
  }
});

async function testReminderResult(clinic, phone) {
  const r = await reminders.sendTestReminder(clinic, phone);
  return r.ok ? { ok: `Recordatorio de prueba enviado (${r.via === 'plantilla' ? 'con la plantilla aprobada' : 'como mensaje normal'}): «${r.text}»` } : { error: r.error };
}

router.post('/onboarding/:id/recordatorio-prueba', loadClinic, form, async (req, res) => {
  go(res, req.clinic, 'whatsapp', await testReminderResult(req.clinic, req.body.phone));
});

router.post('/onboarding/demo/recordatorio-prueba', form, async (req, res) => {
  const q = new URLSearchParams(await testReminderResult(clinics.getDemoClinic(), req.body.phone)).toString();
  res.redirect(`/onboarding/demo/whatsapp?${q}`);
});

router.post('/onboarding/:id/recordatorios', loadClinic, form, (req, res) => {
  const hours = [req.body.h0, req.body.h1, req.body.h2].map(Number).filter((h) => reminders.HOUR_OPTIONS.includes(h));
  const unique = [...new Set(hours)].sort((a, b) => b - a);
  clinics.updateClinic(req.clinic.id, { reminder_hours: JSON.stringify(unique) });
  go(res, req.clinic, 'whatsapp', {
    ok: unique.length ? `Recordatorios guardados: ${unique.map(reminders.hoursLabel).join(' · ')}.` : 'Recordatorios desactivados: no se enviará ninguno.',
  });
});

router.post('/onboarding/:id/whatsapp/plantilla', loadClinic, async (req, res) => {
  try {
    if (!req.clinic.reminder_template_name) return go(res, req.clinic, 'whatsapp', { error: 'Primero envía el texto de la plantilla a Meta.' });
    const t = { status: await templates.refreshStatus(req.clinic) };
    go(res, req.clinic, 'whatsapp', { ok: `Plantilla de recordatorio: ${TEMPLATE_LABEL[t.status] || t.status}` });
  } catch (err) {
    go(res, req.clinic, 'whatsapp', { error: `Plantilla de recordatorio: ${err.message}` });
  }
});

// ---------------------------------------------------------------------------
// Paso 6: avisos a recepción
// ---------------------------------------------------------------------------
router.get('/onboarding/:id/recepcion', loadClinic, (req, res) => {
  const { clinic } = req;
  res.send(
    page(req, {
      title: 'Recepción',
      clinic,
      step: 'recepcion',
      body: `<h1>6. Avisos a recepción</h1>
        <p class="sub">Cuando un paciente pida hablar con una persona, tenga una reclamación o una duda que el asistente no puede resolver, el asistente deja de responder en ese chat y avisa a recepción.</p>
        <form method="post">
          <label>WhatsApp de recepción <span class="hint">(con prefijo, p. ej. 34600111222)</span></label>
          <input type="tel" name="reception_phone" value="${esc(clinic.reception_phone || '')}" placeholder="34600111222">
          <label>Email de recepción <span class="hint">(opcional)</span></label>
          <input type="email" name="reception_email" value="${esc(clinic.reception_email || '')}" placeholder="recepcion@clinica.es">
          <div class="info" style="margin-top:14px">Recepción puede seguir todas las conversaciones, pausar el asistente y responder desde el <strong>panel de conversaciones</strong> (enlace privado en el paso 8). Si la clínica conectó el número en coexistencia, también desde su app de WhatsApp Business.</div>
          ${stepActions(clinic, 'recepcion')}
        </form>`,
    })
  );
});

router.post('/onboarding/:id/recepcion', loadClinic, form, (req, res) => {
  const phone = String(req.body.reception_phone || '').replace(/\D/g, '');
  const email = String(req.body.reception_email || '').trim();
  if (!phone && !email) return go(res, req.clinic, 'recepcion', { error: 'Indica al menos un WhatsApp o un email de recepción.' });
  if (phone && phone.length < 9) return go(res, req.clinic, 'recepcion', { error: 'El WhatsApp de recepción no parece válido (incluye el prefijo 34).' });
  const clinic = clinics.updateClinic(req.clinic.id, { reception_phone: phone || null, reception_email: email || null, onboarding_step: 'prueba' });
  go(res, clinic, nextStep('recepcion'), { ok: 1 });
});

// ---------------------------------------------------------------------------
// Paso 7: probar el asistente (chat en el navegador, sin WhatsApp)
// ---------------------------------------------------------------------------
const testPhone = (clinic) => `prueba-${clinic.id}`;

router.get('/onboarding/:id/prueba', loadClinic, (req, res) => {
  const { clinic } = req;
  const warnCal = !agenda.usesGoogle(clinic)
    ? '<div class="err">El calendario no está conectado: el asistente no podrá ofrecer huecos. Conéctalo en el paso 4.</div>'
    : '<div class="info">Las citas que reserves aquí se crean de verdad en el calendario de la clínica, marcadas como <strong>[PRUEBA]</strong>. «Reiniciar prueba» las cancela y las borra del calendario.</div>';
  res.send(
    page(req, {
      title: 'Prueba',
      clinic,
      step: 'prueba',
      body: `<h1>7. Probar el asistente</h1>
        <p class="sub">Escribe como si fueras un paciente: pide cita, pregunta precios, cambia o cancela la cita… Así ves cómo responderá por WhatsApp.</p>
        ${warnCal}
        <div id="chat"><div class="msg sys">Conversación de prueba con el asistente de ${esc(clinic.name)}</div></div>
        <form id="chatform" class="chatbar"><input type="text" id="txt" placeholder="Escribe un mensaje…" autocomplete="off" required><button class="btn" type="submit">Enviar</button></form>
        <div class="actions">
          <a class="btn sec" href="/onboarding/${clinic.id}/recepcion">← Avisos a recepción</a>
          <span><button class="btn sec" id="reset" type="button">Reiniciar prueba</button> <a class="btn" href="/onboarding/${clinic.id}/activar">Continuar →</a></span>
        </div>
        <script>
          const chat=document.getElementById('chat'), f=document.getElementById('chatform'), txt=document.getElementById('txt');
          function add(cls, text){const d=document.createElement('div');d.className='msg '+cls;d.textContent=text;chat.appendChild(d);chat.scrollTop=chat.scrollHeight;return d;}
          f.addEventListener('submit', async (e)=>{e.preventDefault(); const t=txt.value.trim(); if(!t) return; add('me', t); txt.value=''; const w=add('bot','escribiendo…');
            try{ const r=await fetch('/onboarding/${clinic.id}/prueba/mensaje',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({text:t})});
              const j=await r.json(); w.textContent = j.reply || (j.paused ? '(La conversación se ha pasado a recepción: el asistente ya no responde en este chat. Pulsa «Reiniciar prueba».)' : (j.error||'Error'));
              if(j.paused) w.className='msg sys';
            }catch(err){ w.textContent='Error de conexión'; } });
          document.getElementById('reset').addEventListener('click', async ()=>{ const r=await fetch('/onboarding/${clinic.id}/prueba/reset',{method:'POST',credentials:'include'}); const j=await r.json();
            chat.innerHTML=''; add('sys', 'Prueba reiniciada'+(j.cancelled?(' · '+j.cancelled+' cita(s) de prueba cancelada(s)'):'')); });
        </script>`,
    })
  );
});

router.post('/onboarding/:id/prueba/mensaje', loadClinic, express.json(), async (req, res) => {
  const text = String(req.body?.text || '').slice(0, 1000);
  if (!text) return res.status(400).json({ error: 'Mensaje vacío' });
  try {
    const reply = await handleIncomingMessage(req.clinic, testPhone(req.clinic), text, 'Paciente de prueba', { isTest: true });
    if (reply === null) return res.json({ paused: true });
    res.json({ reply });
  } catch (err) {
    console.error('Error en el chat de prueba:', err);
    res.status(500).json({ error: `Error del asistente: ${err.message}` });
  }
});

router.post('/onboarding/:id/prueba/reset', loadClinic, async (req, res) => {
  let cancelled = 0;
  try {
    cancelled = await agenda.cancelTestAppointments(req.clinic);
  } catch (err) {
    console.error('Error cancelando citas de prueba:', err);
  }
  db.prepare('DELETE FROM conversations WHERE clinic_id = ? AND phone = ?').run(req.clinic.id, testPhone(req.clinic));
  // Se deja una marca para que el paso conste como hecho.
  db.prepare("INSERT OR IGNORE INTO conversations (clinic_id, phone, history, escalated) VALUES (?, ?, '[]', 0)").run(req.clinic.id, testPhone(req.clinic));
  res.json({ ok: true, cancelled });
});

// ---------------------------------------------------------------------------
// Paso 8: activar
// ---------------------------------------------------------------------------
router.get('/onboarding/:id/activar', loadClinic, async (req, res) => {
  const { clinic } = req;
  let calendarOk = false;
  let calendarMsg = 'Sin conectar';
  if (clinic.google_refresh_token) {
    try {
      await gcal.ping(clinic);
      calendarOk = true;
      calendarMsg = 'Conectado y funcionando';
    } catch (err) {
      calendarMsg = `Error: ${err.message}`;
    }
  }
  const pendingTests = db.prepare("SELECT COUNT(*) n FROM appointments WHERE clinic_id = ? AND is_test = 1 AND status = 'confirmada'").get(clinic.id).n;
  const inboundOk = realMessageReceived(clinic);
  const checks = [
    { ok: stepDone(clinic, 'datos'), label: 'Datos de la clínica (dirección y horario)', step: 'datos', required: true },
    { ok: stepDone(clinic, 'agenda'), label: 'Agenda y tratamientos configurados', step: 'agenda', required: true },
    { ok: calendarOk, label: `Google Calendar: ${calendarMsg}`, step: 'calendario', required: true },
    { ok: stepDone(clinic, 'whatsapp'), label: `WhatsApp: ${clinic.whatsapp_display_phone || 'sin conectar'}`, step: 'whatsapp', required: true },
    {
      ok: templates.isApproved(clinic.reminder_template_status),
      label: templates.isApproved(clinic.reminder_template_status)
        ? 'Plantilla de recordatorio aprobada'
        : `Plantilla de recordatorio: ${TEMPLATE_LABEL[clinic.reminder_template_status] || 'sin crear'} (sin ella solo llegan recordatorios a quien escribió en las últimas 24 h)`,
      step: 'whatsapp',
      required: false,
    },
    {
      ok: inboundOk,
      label: inboundOk
        ? 'Mensaje real recibido por WhatsApp (el número recibe bien los mensajes)'
        : `Falta comprobar que el número recibe mensajes: desde tu móvil escribe «hola» a ${clinic.whatsapp_display_phone || 'el número de la clínica'} y pulsa «Comprobar». Si no aparece en 1 minuto, el número no está recibiendo mensajes (revisa YCloud).`,
      step: 'activar',
      linkText: 'Comprobar',
      required: true,
    },
    { ok: stepDone(clinic, 'recepcion'), label: 'Avisos a recepción', step: 'recepcion', required: true },
    { ok: stepDone(clinic, 'prueba'), label: 'Asistente probado', step: 'prueba', required: false },
    { ok: pendingTests === 0, label: pendingTests ? `Quedan ${pendingTests} cita(s) de prueba en el calendario (reinicia la prueba para borrarlas)` : 'Sin citas de prueba pendientes', step: 'prueba', required: false },
  ];
  const ready = checks.filter((c) => c.required).every((c) => c.ok);
  const list = checks
    .map((c) => `<div class="check"><span class="i">${c.ok ? '✅' : c.required ? '❌' : '⚠️'}</span><span style="flex:1">${esc(c.label)}</span>${c.ok ? '' : `<a href="/onboarding/${clinic.id}/${c.step}">${c.linkText || 'Ir'}</a>`}</div>`)
    .join('');
  const statusBox =
    clinic.status === 'activa'
      ? `<div class="ok"><strong>El asistente está ACTIVO</strong> y atiende a los pacientes de ${esc(clinic.name)} por WhatsApp.</div>`
      : clinic.status === 'pausada'
        ? '<div class="info">El asistente está <strong>pausado</strong>: no responde a los pacientes.</div>'
        : '';
  res.send(
    page(req, {
      title: 'Activar',
      clinic,
      step: 'activar',
      body: `<h1>8. Activar el asistente</h1>
        ${statusBox}
        <p class="sub">Revisión final antes de que el asistente empiece a responder a los pacientes.</p>
        ${list}
        <form method="post" action="/onboarding/${clinic.id}/estado">
          <div class="actions">
            <a class="btn sec" href="/onboarding/${clinic.id}/prueba">← Probar el asistente</a>
            ${
              clinic.status === 'activa'
                ? '<button class="btn red" name="status" value="pausada" type="submit">Pausar asistente</button>'
                : `<button class="btn green" name="status" value="activa" type="submit" ${ready ? '' : 'disabled title="Completa los pasos marcados con ❌"'}>Activar asistente</button>`
            }
          </div>
        </form>
        <h2>Panel de la recepción</h2>
        <p class="hint">Enlace privado para que la recepción vea las conversaciones del asistente, lo pause o reactive en un chat y responda desde la web. Quien tenga el enlace puede entrar: compártelo solo con la clínica.</p>
        ${
          clinic.panel_token
            ? `<input type="text" readonly value="${esc(`${publicBaseUrl(req)}/panel/${clinic.panel_token}`)}" onclick="this.select()">
               <div class="actions" style="margin-top:10px"><a class="btn sec" href="/panel/c/${clinic.id}" target="_blank">Ver conversaciones</a>
               <form method="post" action="/onboarding/${clinic.id}/panel-token" onsubmit="return confirm('El enlace actual dejará de funcionar. ¿Crear uno nuevo?')"><button class="btn sec" type="submit">Crear enlace nuevo</button></form></div>`
            : `<div class="actions" style="margin-top:0"><a class="btn sec" href="/panel/c/${clinic.id}" target="_blank">Ver conversaciones</a>
               <form method="post" action="/onboarding/${clinic.id}/panel-token"><button class="btn" type="submit">Crear enlace para la recepción</button></form></div>`
        }
        <div style="margin-top:36px;border-top:1px solid var(--border);padding-top:16px">${deleteForm(clinic)} <span class="hint">Borra la clínica y todos sus datos del asistente (no toca su Google Calendar salvo las citas de prueba, ni su número en YCloud).</span></div>`,
    })
  );
});

// ¿Ha llegado algún mensaje real (no del chat de prueba) al número de la
// clínica? Prueba de que Meta → YCloud → bot entrega los mensajes: un número
// puede salir «Connected» y aun así no recibir nada.
function realMessageReceived(clinic) {
  return Boolean(
    db.prepare("SELECT 1 FROM messages WHERE clinic_id = ? AND direction = 'in' AND phone NOT LIKE 'prueba-%' LIMIT 1").get(clinic.id)
  );
}

router.post('/onboarding/:id/panel-token', loadClinic, (req, res) => {
  const clinic = clinics.updateClinic(req.clinic.id, { panel_token: require('./panel').newPanelToken(req.clinic) });
  go(res, clinic, 'activar', { ok: 'Enlace del panel creado. Cópialo y compártelo solo con la recepción de la clínica.' });
});

// Botón «Eliminar»: pide escribir ELIMINAR (las clínicas activas atienden a
// pacientes reales: que no se borre una por un clic despistado).
function deleteForm(clinic, { compact = false } = {}) {
  const name = esc(clinic.name).replace(/['"\\]/g, '');
  const warn = clinic.status === 'activa' ? 'ATENCIÓN: está ACTIVA y atendiendo pacientes. ' : '';
  return `<form method="post" action="/onboarding/${clinic.id}/eliminar" style="display:inline" onsubmit="const v=prompt('${warn}Vas a eliminar «${name}» y todos sus datos. No se puede deshacer. Escribe ELIMINAR para confirmar:'); if(v===null) return false; this.confirm.value=v; return true;"><input type="hidden" name="confirm"><button class="btn sec" type="submit" style="color:#B42318${compact ? ';padding:10px 14px' : ''}">${compact ? '🗑' : 'Eliminar clínica'}</button></form>`;
}

router.post('/onboarding/:id/eliminar', loadClinic, form, async (req, res) => {
  const { clinic } = req;
  if (String(req.body.confirm || '').trim().toUpperCase() !== 'ELIMINAR') {
    return res.redirect(`/onboarding?error=${encodeURIComponent('No se ha eliminado: hay que escribir ELIMINAR para confirmar.')}`);
  }
  try {
    await agenda.cancelTestAppointments(clinic);
  } catch (err) {
    console.error('Error cancelando citas de prueba al eliminar:', err);
  }
  db.transaction(() => {
    db.prepare('DELETE FROM reminders_sent WHERE appointment_id IN (SELECT id FROM appointments WHERE clinic_id = ?)').run(clinic.id);
    for (const t of ['appointments', 'slots', 'conversations', 'patients', 'message_log', 'error_log', 'demo_leads', 'messages']) {
      db.prepare(`DELETE FROM ${t} WHERE clinic_id = ?`).run(clinic.id);
    }
    db.prepare('DELETE FROM clinics WHERE id = ? AND mode = ?').run(clinic.id, 'clinica');
  })();
  res.redirect(`/onboarding?ok=${encodeURIComponent(`«${clinic.name}» eliminada.`)}`);
});

router.post('/onboarding/:id/estado', loadClinic, form, async (req, res) => {
  const status = req.body.status === 'activa' ? 'activa' : 'pausada';
  if (status === 'activa') {
    const c = req.clinic;
    if (!(stepDone(c, 'datos') && stepDone(c, 'agenda') && c.google_refresh_token && stepDone(c, 'whatsapp') && stepDone(c, 'recepcion'))) {
      return go(res, c, 'activar', { error: 'Faltan pasos obligatorios.' });
    }
    if (!realMessageReceived(c)) {
      return go(res, c, 'activar', { error: 'Antes de activar, escribe un mensaje al número de la clínica desde tu móvil y comprueba que llega.' });
    }
    try {
      await gcal.ping(c);
    } catch (err) {
      return go(res, c, 'activar', { error: `Google Calendar no funciona: ${err.message}` });
    }
  }
  const clinic = clinics.updateClinic(req.clinic.id, { status, onboarding_step: 'activar' });
  go(res, clinic, 'activar', { ok: status === 'activa' ? '¡Asistente activado! Ya responde a los pacientes por WhatsApp.' : 'Asistente pausado.' });
});

module.exports = router;
