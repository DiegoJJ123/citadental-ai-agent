// Vigilancia automática: cada hora revisa cada clínica activa (y la demo) y
// avisa por email solo cuando aparece un problema nuevo o se resuelve uno
// (sin repetir el mismo aviso cada hora). El estado se ve en /onboarding/salud.
const db = require('../db/db');
const clinics = require('./clinics');
const ycloud = require('./ycloud');
const gcal = require('./googleCalendar');
const agenda = require('./agenda');
const templates = require('./templates');
const mailer = require('./mailer');
const backup = require('./backup');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const SILENCE_HOURS = 72;
const toTs = (sqlite) => Date.parse(String(sqlite).replace(' ', 'T') + 'Z');

function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || null;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

async function ycloudNumbers() {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const data = await ycloud.call('GET', '/whatsapp/phoneNumbers', { query: { page, limit: 100 } });
    const items = data?.items || [];
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
}

const digits = (p) => String(p || '').replace(/\D/g, '');

async function checkClinic(clinic, ctx) {
  const issues = [];
  const add = (level, code, text) => issues.push({ level, code, text });
  const id = clinic.id;

  // WhatsApp en YCloud
  if (clinic.whatsapp_provider === 'ycloud' && clinic.whatsapp_phone) {
    if (ctx.numbers) {
      const n = ctx.numbers.find((x) => digits(x.phoneNumber) === digits(clinic.whatsapp_phone));
      if (!n) add('red', 'wa_missing', `El número ${clinic.whatsapp_phone} ya no aparece en YCloud.`);
      else if (String(n.status || '').toUpperCase() !== 'CONNECTED') add('red', 'wa_status', `El número ${clinic.whatsapp_phone} está «${n.status}» en YCloud (no conectado).`);
    }
  } else if (!clinic.isDemo) {
    add('red', 'wa_none', 'La clínica no tiene WhatsApp conectado.');
  }

  // ¿Llegan mensajes?
  const lastIn = db
    .prepare("SELECT MAX(created_at) last FROM messages WHERE clinic_id = ? AND direction = 'in' AND phone NOT LIKE 'prueba-%'")
    .get(id)?.last;
  if (!lastIn) add('red', 'no_inbound', 'No ha llegado ningún mensaje al número: puede estar conectado pero sin recibir (revisa YCloud/Meta).');
  else if (Date.now() - toTs(lastIn) > SILENCE_HOURS * 3600e3) {
    add('yellow', 'silence', `Ningún paciente ha escrito en ${Math.round((Date.now() - toTs(lastIn)) / 86400e3)} días. Si es raro en esta clínica, comprueba que el número recibe mensajes.`);
  }

  // Envíos fallidos recientes
  const failed = db
    .prepare("SELECT COUNT(*) n FROM messages WHERE clinic_id = ? AND body LIKE '[no enviado]%' AND created_at >= datetime('now','-6 hours')")
    .get(id).n;
  if (failed) add('red', 'send_failed', `${failed} respuesta(s) del asistente no se pudieron enviar por WhatsApp en las últimas 6 h.`);

  // Google Calendar
  if (agenda.usesGoogle(clinic)) {
    try {
      await gcal.ping(clinic);
    } catch (err) {
      add('red', 'calendar', `Google Calendar no funciona: ${err.message}`);
    }
  }

  // Plantilla de recordatorio
  const ts = String(clinic.reminder_template_status || '').toUpperCase();
  if (['REJECTED', 'PAUSED', 'DISABLED'].includes(ts)) {
    add('yellow', 'template', `La plantilla de recordatorio está «${ts}» en Meta: los recordatorios solo llegan a quien escribió en las últimas 24 h.`);
  } else if (!clinic.isDemo && !clinic.reminder_template_name) {
    add('yellow', 'template_none', 'No se ha enviado la plantilla de recordatorio a Meta (paso 5).');
  }

  // Recordatorios que no se pudieron enviar
  const remErr = db
    .prepare("SELECT COUNT(*) n FROM error_log WHERE clinic_id = ? AND context = 'recordatorio' AND created_at >= datetime('now','-1 day')")
    .get(id).n;
  if (remErr) add('yellow', 'reminders', `${remErr} recordatorio(s) no se pudieron enviar en las últimas 24 h.`);

  return issues;
}

function globalIssues() {
  const issues = [];
  const ai = db
    .prepare(
      `SELECT message FROM error_log WHERE created_at >= datetime('now','-2 hours')
       AND (message LIKE '%429%' OR message LIKE '%quota%' OR message LIKE '%Incorrect API key%' OR message LIKE '%insufficient%')
       ORDER BY id DESC LIMIT 1`
    )
    .get();
  if (ai) issues.push({ level: 'red', code: 'openai', text: `La IA (OpenAI) está fallando; los pacientes reciben el mensaje de respaldo. Revisa saldo y clave. Error: ${ai.message.slice(0, 160)}` });
  const last = backup.lastBackup();
  if (last && Date.now() - Date.parse(last.at) > 36 * 3600e3) issues.push({ level: 'yellow', code: 'backup_old', text: 'La última copia de seguridad tiene más de 36 h.' });
  if (!mailer.isConfigured()) issues.push({ level: 'yellow', code: 'email_off', text: 'Los avisos por email están desactivados: falta SMTP_PASS en Render.' });
  return issues;
}

const levelOf = (issues) => (issues.some((i) => i.level === 'red') ? 'red' : issues.length ? 'yellow' : 'green');

async function runChecks({ notify = true } = {}) {
  const ctx = {};
  const globalList = globalIssues();
  try {
    ctx.numbers = await ycloudNumbers();
  } catch (err) {
    globalList.push({ level: 'yellow', code: 'ycloud_api', text: `No se pudo consultar YCloud: ${err.message}` });
  }
  const list = clinics.listClinics().filter((c) => c.status === 'activa');
  const result = { checkedAt: new Date().toISOString(), global: globalList, clinics: {} };
  for (const c of list) {
    let issues;
    try {
      issues = await checkClinic(c, ctx);
    } catch (err) {
      issues = [{ level: 'yellow', code: 'check_error', text: `No se pudo revisar: ${err.message}` }];
    }
    result.clinics[c.id] = { name: c.isDemo && !/demo/i.test(c.name) ? `${c.name} (demo)` : c.name, demo: c.isDemo, level: levelOf(issues), issues };
  }

  // Avisos solo de lo que cambia respecto a la revisión anterior.
  const prev = JSON.parse(getSetting('health_state') || 'null');
  const keys = (state) => {
    const m = new Map();
    if (!state) return m;
    for (const i of state.global || []) m.set(`g:${i.code}`, { who: 'General', ...i });
    for (const [id, c] of Object.entries(state.clinics || {})) for (const i of c.issues) m.set(`${id}:${i.code}`, { who: c.name, ...i });
    return m;
  };
  const before = keys(prev);
  const now = keys(result);
  const fresh = [...now].filter(([k, i]) => !before.has(k) && i.code !== 'email_off').map(([, i]) => i);
  const solved = [...before].filter(([k, i]) => !now.has(k) && i.code !== 'email_off').map(([, i]) => i);
  setSetting('health_state', JSON.stringify(result));

  if (notify && (fresh.length || solved.length)) {
    const reds = fresh.filter((i) => i.level === 'red').length;
    const subject = fresh.length
      ? `${reds ? '🔴' : '🟡'} CitaDental AI: ${fresh.length} problema(s) nuevo(s)${solved.length ? ` · ${solved.length} resuelto(s)` : ''}`
      : `✅ CitaDental AI: ${solved.length} problema(s) resuelto(s)`;
    const lines = [
      ...fresh.map((i) => `${i.level === 'red' ? '🔴' : '🟡'} ${i.who}: ${i.text}`),
      ...(solved.length ? ['', 'Resueltos:', ...solved.map((i) => `✅ ${i.who}: ${i.text}`)] : []),
      '',
      'Detalle: https://dashboard.citadentalai.site/onboarding/salud',
    ];
    await mailer.send({ subject, text: lines.join('\n') });
  }
  return result;
}

function lastState() {
  try {
    return JSON.parse(getSetting('health_state') || 'null');
  } catch {
    return null;
  }
}

function startHealthScheduler() {
  const tick = async () => {
    try {
      await runChecks();
    } catch (err) {
      console.error('Error en la vigilancia:', err);
    }
    try {
      await backup.runDailyBackup();
    } catch (err) {
      console.error('Error en la copia diaria:', err);
    }
  };
  setTimeout(tick, 60 * 1000); // un minuto después de arrancar
  setInterval(tick, CHECK_INTERVAL_MS);
}

module.exports = { runChecks, lastState, startHealthScheduler, levelOf };
