// Onboarding de clínicas: asistente paso a paso para dar de alta una clínica
// nueva (pensado para usarse desde el ordenador de la propia clínica).
// Solo accesible con la cuenta de Google autorizada (auth.requireDashboardAuth).
const crypto = require('crypto');
const express = require('express');
const auth = require('../services/auth');
const db = require('../db/db');
const clinics = require('../services/clinics');
const agenda = require('../services/agenda');
const calendar = require('../services/calendar');
const gcal = require('../services/googleCalendar');
const { INFO_FIELDS, extractClinicInfo } = require('../services/siteExtractor');
const { handleIncomingMessage } = require('../services/agent');

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
const GRAPH = 'https://graph.facebook.com/v21.0';

// ---------------------------------------------------------------------------
// Utilidades de presentación
// ---------------------------------------------------------------------------
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const CSS = `
*{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7fb;color:#1f2937;line-height:1.5}
a{color:#2563eb} header{background:#0f172a;color:#fff;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
header a{color:#cbd5e1;text-decoration:none;margin-left:16px;font-size:14px} header strong{font-size:17px}
.wrap{max-width:1100px;margin:0 auto;padding:24px;display:grid;grid-template-columns:240px 1fr;gap:24px}
.wrap.single{grid-template-columns:1fr}
@media (max-width:820px){.wrap{grid-template-columns:1fr}}
nav.steps{background:#fff;border-radius:12px;padding:12px;height:fit-content;border:1px solid #e5e7eb}
nav.steps a{display:flex;gap:10px;align-items:center;padding:9px 10px;border-radius:8px;color:#374151;text-decoration:none;font-size:14px}
nav.steps a.cur{background:#eef2ff;color:#3730a3;font-weight:600} nav.steps a:hover{background:#f3f4f6}
nav.steps .n{width:24px;height:24px;border-radius:50%;background:#e5e7eb;display:inline-flex;align-items:center;justify-content:center;font-size:12px;flex:none}
nav.steps a.done .n{background:#16a34a;color:#fff} nav.steps a.cur .n{background:#4f46e5;color:#fff}
main.card{background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb}
h1{font-size:22px;margin:0 0 6px} h2{font-size:17px;margin:24px 0 8px} p.sub{color:#6b7280;margin:0 0 20px}
label{display:block;font-weight:600;font-size:14px;margin:14px 0 6px} .hint{font-weight:400;color:#6b7280;font-size:13px}
input[type=text],input[type=url],input[type=email],input[type=tel],input[type=password],input[type=number],input[type=time],textarea,select{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font:inherit;background:#fff}
textarea{min-height:80px;resize:vertical} input[type=time]{width:auto;min-width:118px;display:inline-block} td.range{white-space:nowrap} input:focus,textarea:focus{outline:2px solid #c7d2fe;border-color:#6366f1}
.btn{display:inline-block;background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:11px 18px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
.btn:hover{background:#4338ca} .btn.sec{background:#fff;color:#374151;border:1px solid #d1d5db} .btn.sec:hover{background:#f9fafb}
.btn.green{background:#16a34a} .btn.red{background:#dc2626} .btn[disabled]{opacity:.6;cursor:wait}
.actions{display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:26px;flex-wrap:wrap}
.ok{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;padding:10px 14px;border-radius:8px;margin-bottom:16px}
.err{background:#fef2f2;color:#991b1b;border:1px solid #fecaca;padding:10px 14px;border-radius:8px;margin-bottom:16px}
.info{background:#eff6ff;color:#1e3a8a;border:1px solid #bfdbfe;padding:10px 14px;border-radius:8px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-size:14px} th,td{text-align:left;padding:8px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
th{color:#6b7280;font-weight:600;font-size:12px;text-transform:uppercase}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
.b-onboarding{background:#fef3c7;color:#92400e} .b-activa{background:#dcfce7;color:#166534} .b-pausada{background:#e5e7eb;color:#374151}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px} @media (max-width:640px){.grid2{grid-template-columns:1fr}}
.provider{border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin:8px 0;display:flex;gap:12px;align-items:flex-start;cursor:pointer}
.provider input{margin-top:4px} .provider.dis{opacity:.55;cursor:not-allowed}
.check{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #f1f5f9}
.check .i{flex:none;width:22px;text-align:center}
ol.guide li{margin:6px 0}
#chat{border:1px solid #e5e7eb;border-radius:12px;background:#efeae2;height:430px;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px}
.msg{max-width:78%;padding:8px 12px;border-radius:10px;white-space:pre-wrap;font-size:14px;box-shadow:0 1px 1px rgba(0,0,0,.06)}
.msg.me{align-self:flex-end;background:#d9fdd3} .msg.bot{align-self:flex-start;background:#fff} .msg.sys{align-self:center;background:#fff7cd;font-size:12px}
.chatbar{display:flex;gap:8px;margin-top:10px} .chatbar input{flex:1}
small.mono{font-family:ui-monospace,monospace;color:#6b7280}
`;

function page(req, { title, clinic, step, body }) {
  const nav = clinic
    ? `<nav class="steps">
        <div style="padding:6px 10px 12px;font-weight:700">${esc(clinic.name)}<br><span class="badge b-${esc(clinic.status)}">${esc(clinic.status)}</span></div>
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
<meta name="robots" content="noindex"><title>${esc(title)} · CitaDental AI</title><style>${CSS}</style></head><body>
<header><strong>🦷 CitaDental AI · Alta de clínicas</strong><div><span style="font-size:13px;color:#94a3b8">${esc(req.dashboardEmail || '')}</span><a href="/onboarding">Clínicas</a><a href="/dashboard">Panel demo</a><a href="/dashboard/logout">Cerrar sesión</a></div></header>
<div class="wrap ${clinic ? '' : 'single'}">${nav}<main class="card">${flash}${body}</main></div>
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
      return Boolean(clinic.whatsapp_phone_number_id);
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
        <td>${pending ? `Pendiente: ${esc(pending.title)}` : '✓ Completo'}</td>
        <td style="text-align:right"><a class="btn sec" href="/onboarding/${c.id}/${pending ? pending.key : 'activar'}">${c.status === 'activa' ? 'Gestionar' : 'Continuar'}</a></td>
      </tr>`;
    })
    .join('');
  res.send(
    page(req, {
      title: 'Clínicas',
      body: `<div class="actions" style="margin-top:0"><div><h1>Clínicas</h1><p class="sub">Da de alta una clínica nueva o continúa un alta a medias.</p></div>
        <a class="btn" href="/onboarding/nueva">+ Nueva clínica</a></div>
        ${list.length ? `<table><thead><tr><th>Clínica</th><th>Estado</th><th>WhatsApp</th><th>Mensajes este mes</th><th>Progreso</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="info">Todavía no hay clínicas. Pulsa «Nueva clínica» para empezar.</div>'}`,
    })
  );
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
// Paso 5: WhatsApp
// ---------------------------------------------------------------------------
async function graph(path, token, { method = 'GET', body } = {}) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Meta respondió ${res.status}`);
  return data;
}

router.get('/onboarding/:id/whatsapp', loadClinic, (req, res) => {
  const { clinic } = req;
  res.send(
    page(req, {
      title: 'WhatsApp',
      clinic,
      step: 'whatsapp',
      body: `<h1>5. Conectar WhatsApp</h1>
        <p class="sub">La clínica sigue usando su app de WhatsApp Business de siempre (modo coexistencia). El asistente responde por el mismo número.</p>
        ${clinic.whatsapp_display_phone ? `<div class="ok">✓ Número conectado: <strong>${esc(clinic.whatsapp_display_phone)}</strong></div>` : ''}
        <div class="info"><strong>Mientras Meta aprueba la conexión en un clic</strong>, el número se conecta desde Meta Business:</div>
        <ol class="guide">
          <li>Abre <a href="https://business.facebook.com/latest/whatsapp_manager/phone_numbers" target="_blank" rel="noopener">WhatsApp Manager en Meta Business</a> con la cuenta de la clínica y añade su número (opción «usar la app de WhatsApp Business que ya tienes»).</li>
          <li>Comparte la cuenta de WhatsApp de la clínica con el negocio de CitaDental AI (o crea un token de acceso para ella).</li>
          <li>Copia aquí el <strong>Phone number ID</strong> y el <strong>WhatsApp Business Account ID</strong> que aparecen en Meta.</li>
          <li>Pulsa «Comprobar y conectar»: verificaremos el número y lo suscribiremos al asistente.</li>
        </ol>
        <form method="post" data-busy="Comprobando con Meta…">
          <div class="grid2">
            <div><label>Phone number ID</label><input type="text" name="phone_number_id" required value="${esc(clinic.whatsapp_phone_number_id || '')}" placeholder="1052831911250342"></div>
            <div><label>WhatsApp Business Account ID</label><input type="text" name="waba_id" value="${esc(clinic.whatsapp_waba_id || '')}" placeholder="4944851238987440"></div>
          </div>
          <label>Token de acceso <span class="hint">(opcional: vacío = usar el token de CitaDental AI${clinic.whatsapp_token ? '; ya hay uno guardado, déjalo vacío para mantenerlo' : ''})</span></label>
          <input type="password" name="token" autocomplete="off" value="">
          ${stepActions(clinic, 'whatsapp', { submit: 'Comprobar y conectar' })}
        </form>`,
    })
  );
});

router.post('/onboarding/:id/whatsapp', loadClinic, form, async (req, res) => {
  const { clinic } = req;
  const phoneNumberId = String(req.body.phone_number_id || '').trim();
  const wabaId = String(req.body.waba_id || '').trim();
  const newToken = String(req.body.token || '').trim();
  if (!/^\d{6,30}$/.test(phoneNumberId)) return go(res, clinic, 'whatsapp', { error: 'El Phone number ID debe ser un número.' });
  const other = clinics.getClinicByPhoneNumberId(phoneNumberId);
  if (other && other.id !== clinic.id) return go(res, clinic, 'whatsapp', { error: `Ese número ya está asignado a «${other.name}».` });

  const token = newToken || clinic.whatsapp_token || process.env.WHATSAPP_TOKEN;
  let display;
  try {
    const info = await graph(`${phoneNumberId}?fields=display_phone_number,verified_name`, token);
    display = `${info.display_phone_number}${info.verified_name ? ` (${info.verified_name})` : ''}`;
  } catch (err) {
    return go(res, clinic, 'whatsapp', { error: `Meta no reconoce ese número con este token: ${err.message}` });
  }
  let subscribed = '';
  if (wabaId) {
    try {
      await graph(`${wabaId}/subscribed_apps`, token, { method: 'POST' });
      subscribed = ' y suscrito al asistente';
    } catch (err) {
      return go(res, clinic, 'whatsapp', { error: `Número verificado (${display}) pero no se pudo suscribir la cuenta al asistente: ${err.message}` });
    }
  }
  const updated = clinics.updateClinic(clinic.id, {
    whatsapp_phone_number_id: phoneNumberId,
    whatsapp_waba_id: wabaId || null,
    whatsapp_display_phone: display,
    ...(newToken ? { whatsapp_token: newToken } : {}),
    onboarding_step: 'recepcion',
  });
  go(res, updated, nextStep('whatsapp'), { ok: `Número ${display} verificado${subscribed}.` });
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
          <div class="info" style="margin-top:14px">Recepción también puede seguir la conversación directamente desde la app de WhatsApp Business de la clínica.</div>
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
  const checks = [
    { ok: stepDone(clinic, 'datos'), label: 'Datos de la clínica (dirección y horario)', step: 'datos', required: true },
    { ok: stepDone(clinic, 'agenda'), label: 'Agenda y tratamientos configurados', step: 'agenda', required: true },
    { ok: calendarOk, label: `Google Calendar: ${calendarMsg}`, step: 'calendario', required: true },
    { ok: stepDone(clinic, 'whatsapp'), label: `WhatsApp: ${clinic.whatsapp_display_phone || 'sin conectar'}`, step: 'whatsapp', required: true },
    { ok: stepDone(clinic, 'recepcion'), label: 'Avisos a recepción', step: 'recepcion', required: true },
    { ok: stepDone(clinic, 'prueba'), label: 'Asistente probado', step: 'prueba', required: false },
    { ok: pendingTests === 0, label: pendingTests ? `Quedan ${pendingTests} cita(s) de prueba en el calendario (reinicia la prueba para borrarlas)` : 'Sin citas de prueba pendientes', step: 'prueba', required: false },
  ];
  const ready = checks.filter((c) => c.required).every((c) => c.ok);
  const list = checks
    .map((c) => `<div class="check"><span class="i">${c.ok ? '✅' : c.required ? '❌' : '⚠️'}</span><span style="flex:1">${esc(c.label)}</span>${c.ok ? '' : `<a href="/onboarding/${clinic.id}/${c.step}">Ir</a>`}</div>`)
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
        ${clinic.status !== 'activa' ? `<form method="post" action="/onboarding/${clinic.id}/eliminar" onsubmit="return confirm('¿Eliminar ${esc(clinic.name).replace(/'/g, '')} y todos sus datos? No se puede deshacer.')" style="margin-top:36px;border-top:1px solid #f1f5f9;padding-top:16px">
          <button class="btn sec" type="submit" style="color:#b91c1c">Eliminar clínica</button> <span class="hint">Borra la clínica y todos sus datos (no toca su Google Calendar salvo las citas de prueba).</span></form>` : ''}`,
    })
  );
});

router.post('/onboarding/:id/eliminar', loadClinic, async (req, res) => {
  const { clinic } = req;
  if (clinic.status === 'activa') return go(res, clinic, 'activar', { error: 'Pausa el asistente antes de eliminar la clínica.' });
  try {
    await agenda.cancelTestAppointments(clinic);
  } catch (err) {
    console.error('Error cancelando citas de prueba al eliminar:', err);
  }
  db.transaction(() => {
    for (const t of ['appointments', 'slots', 'conversations', 'patients', 'message_log', 'error_log', 'demo_leads']) {
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
    if (!(stepDone(c, 'datos') && stepDone(c, 'agenda') && c.google_refresh_token && c.whatsapp_phone_number_id && stepDone(c, 'recepcion'))) {
      return go(res, c, 'activar', { error: 'Faltan pasos obligatorios.' });
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
