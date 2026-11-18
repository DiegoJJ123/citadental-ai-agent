// Planes y uso: conversaciones del mes por clínica.
// Una conversación = un paciente que escribe, durante 24 h desde su primer
// mensaje (el mismo criterio que usa WhatsApp). Los chats de prueba del
// onboarding no cuentan. Al llegar al 80 % y al 100 % del plan se avisa por
// email al administrador; el asistente nunca se corta.
const db = require('../db/db');
const clinics = require('./clinics');
const mailer = require('./mailer');
const { zonedToDate, dateToZoned, DEFAULT_TZ } = require('./tz');
const todayIn = (tz, now = new Date()) => dateToZoned(now, tz).date;

const PLANS = {
  clinica: { label: 'Plan Clínica', price: '149 €/mes', limit: 500 },
  clinica_plus: { label: 'Plan Clínica+', price: '249 €/mes', limit: null },
};
const planOf = (clinic) => PLANS[clinic?.plan] || PLANS.clinica;

const DAY_MS = 24 * 3600 * 1000;
const toTs = (sqlite) => Date.parse(String(sqlite).replace(' ', 'T') + 'Z');
const toSqlite = (d) => d.toISOString().replace('T', ' ').slice(0, 19);

// Inicio del mes actual en la zona de la clínica, como fecha UTC de SQLite.
function monthStart(tz = DEFAULT_TZ, now = new Date()) {
  const today = todayIn(tz, now);
  return toSqlite(zonedToDate(`${today.slice(0, 7)}-01`, '00:00', tz));
}

function conversationsThisMonth(clinic, now = new Date()) {
  const tz = clinic?.schedule?.timezone || DEFAULT_TZ;
  const rows = db
    .prepare(
      `SELECT phone, created_at FROM messages
       WHERE clinic_id = ? AND direction = 'in' AND phone NOT LIKE 'prueba-%' AND created_at >= ?
       ORDER BY phone, created_at`
    )
    .all(clinic.id, monthStart(tz, now));
  let count = 0;
  let phone = null;
  let windowStart = 0;
  for (const r of rows) {
    const t = toTs(r.created_at);
    if (r.phone !== phone || t - windowStart >= DAY_MS) {
      count += 1;
      phone = r.phone;
      windowStart = t;
    }
  }
  return count;
}

function usageOf(clinic, now = new Date()) {
  const plan = planOf(clinic);
  const used = conversationsThisMonth(clinic, now);
  const pct = plan.limit ? Math.round((used / plan.limit) * 100) : null;
  return { used, limit: plan.limit, pct, plan };
}

function usageLabel(u) {
  return u.limit ? `${u.used} / ${u.limit}` : `${u.used} (ilimitadas)`;
}

// Avisos al administrador al 80 % y al 100 % (una vez por umbral y mes).
async function checkUsageAlerts(now = new Date()) {
  for (const c of clinics.listClinics().filter((x) => x.status === 'activa' && !x.isDemo)) {
    const u = usageOf(c, now);
    if (!u.limit) continue;
    const month = todayIn(c.schedule?.timezone || DEFAULT_TZ, now).slice(0, 7);
    for (const threshold of [100, 80]) {
      if (u.pct < threshold) continue;
      const key = `usage_alert:${c.id}:${month}:${threshold}`;
      if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key)) break;
      const ok = await mailer.send({
        subject: `${threshold === 100 ? '🔴' : '🟡'} ${c.name}: ${u.used} de ${u.limit} conversaciones este mes (${u.pct} %)`,
        text: [
          `${c.name} (${u.plan.label}) lleva ${u.used} conversaciones este mes, de ${u.limit} incluidas.`,
          threshold === 100
            ? 'Ha llegado al límite del plan. El asistente sigue respondiendo con normalidad: valora pasarla al Plan Clínica+ (conversaciones ilimitadas).'
            : 'Está al 80 % del plan. El asistente sigue respondiendo con normalidad.',
          '',
          `Gestionar: https://dashboard.citadentalai.site/onboarding/${c.id}/activar`,
        ].join('\n'),
      });
      if (ok) db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, new Date().toISOString());
      break; // solo el umbral más alto alcanzado
    }
  }
}

module.exports = { PLANS, planOf, conversationsThisMonth, usageOf, usageLabel, checkUsageAlerts, monthStart };
