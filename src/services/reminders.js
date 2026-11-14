// Recordatorios de cita. Cada clínica elige en el onboarding cuántos (hasta 3)
// y cuántas horas antes de la cita (clinics.reminder_hours); por defecto 48 h
// y 24 h. WhatsApp solo permite texto libre si el paciente escribió en las
// últimas 24 h; si no, hay que usar la plantilla aprobada de la clínica
// (templates.js). Sin plantilla aprobada no se envía y queda en error_log.
const db = require('../db/db');
const whatsapp = require('./whatsapp');
const clinics = require('./clinics');
const templates = require('./templates');
const messages = require('./messages');
const { zonedToDate, DEFAULT_TZ } = require('./tz');

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // cada 15 minutos
// Margen de seguridad: se considera fuera de ventana a partir de 23 h.
const WINDOW_MS = 23 * 60 * 60 * 1000;

const DEFAULT_HOURS = [48, 24];
const MAX_REMINDERS = 3;
// Opciones que se ofrecen en el onboarding (horas antes de la cita).
const HOUR_OPTIONS = [1, 2, 3, 6, 12, 24, 48, 72, 168];

const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function hoursLabel(h) {
  if (h % 168 === 0) return h === 168 ? '1 semana antes' : `${h / 168} semanas antes`;
  if (h % 24 === 0) return h === 24 ? '1 día antes (24 h)' : `${h / 24} días antes (${h} h)`;
  return h === 1 ? '1 hora antes' : `${h} horas antes`;
}

// Horas antes de la cita en que se envía cada recordatorio, de mayor a menor.
function reminderHours(clinic) {
  try {
    const v = JSON.parse(clinic?.reminder_hours || 'null');
    if (Array.isArray(v)) {
      return [...new Set(v.map(Number).filter((h) => Number.isInteger(h) && h >= 1 && h <= 336))].sort((a, b) => b - a).slice(0, MAX_REMINDERS);
    }
  } catch {
    /* valor vacío o antiguo */
  }
  return DEFAULT_HOURS;
}

function slotDateTime(slot, tz = DEFAULT_TZ) {
  // date y time son hora local de la clínica; el servidor corre en UTC, así que
  // hay que convertir con la zona horaria (antes salía desplazado 1-2 h).
  return zonedToDate(slot.date, slot.time, tz);
}

// "martes 17 de noviembre a las 10:00 (Limpieza dental)"
function formatSlotForReminder(slot, clinic) {
  const [y, m, d] = slot.date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const t = clinic ? require('./agenda').findTreatment(clinic, slot.treatment) : null;
  return `${dias[weekday]} ${d} de ${meses[m - 1]} a las ${slot.time} (${t?.nombre || slot.treatment})`;
}

function getUpcomingAppointments() {
  return db
    .prepare(
      `SELECT a.id as appointment_id, a.clinic_id,
              p.phone, p.name as patient_name,
              s.date, s.time, s.treatment
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN slots s ON s.id = a.slot_id
       JOIN clinics c ON c.id = a.clinic_id
       WHERE a.status = 'confirmada' AND a.is_test = 0 AND c.status = 'activa'
         AND s.date >= date('now', '-1 day')`
    )
    .all();
}

function wasSent(appointmentId, hours) {
  return Boolean(db.prepare('SELECT 1 FROM reminders_sent WHERE appointment_id = ? AND hours = ?').get(appointmentId, hours));
}

function markReminderSent(appointmentId, hours) {
  db.prepare('INSERT OR IGNORE INTO reminders_sent (appointment_id, hours) VALUES (?, ?)').run(appointmentId, hours);
}

function templateValues(appt, clinic) {
  return {
    nombre: appt.patient_name || 'de nuevo',
    clinica: clinic?.info?.nombre || clinic?.name || '',
    cita: formatSlotForReminder(appt, clinic),
  };
}

// Texto libre (paciente dentro de la ventana de 24 h): el mismo texto que la
// plantilla de la clínica, con los huecos rellenos.
function reminderMessage(appt, clinic) {
  const v = templateValues(appt, clinic);
  if (!appt.patient_name) v.nombre = '';
  return templates.render(clinic, v).replace(/Hola\s+(?=[👋,!.])/u, 'Hola ').replace(/\s{2,}/g, ' ').trim();
}

// ¿El paciente escribió a esta clínica hace menos de 23 h?
function inServiceWindow(clinicId, phone, now = Date.now()) {
  const row = db
    .prepare('SELECT MAX(created_at) AS last FROM message_log WHERE clinic_id = ? AND phone = ?')
    .get(clinicId, phone);
  if (!row?.last) return false;
  const last = Date.parse(row.last.replace(' ', 'T') + 'Z'); // CURRENT_TIMESTAMP de SQLite es UTC
  return now - last < WINDOW_MS;
}

function logReminderError(appt, message) {
  db.prepare('INSERT INTO error_log (clinic_id, phone, context, message) VALUES (?, ?, ?, ?)').run(
    appt.clinic_id,
    appt.phone,
    'recordatorio',
    message
  );
}

// Envía un recordatorio por el canal que WhatsApp permite. Devuelve true si
// hay que darlo por gestionado (enviado, o imposible de enviar y registrado).
async function sendReminder(appt, horas, clinic, now) {
  if (inServiceWindow(appt.clinic_id, appt.phone, now)) {
    const text = reminderMessage(appt, clinic);
    const ok = await whatsapp.sendText(appt.phone, text, clinic);
    if (ok) messages.log(appt.clinic_id, appt.phone, 'out', 'bot', text);
    return ok;
  }
  if (templates.isApproved(clinic?.reminder_template_status) && clinic.reminder_template_name) {
    const values = templateValues(appt, clinic);
    try {
      await whatsapp.sendTemplate(
        appt.phone,
        {
          name: clinic.reminder_template_name,
          language: templates.LANGUAGE,
          bodyParams: templates.clinicParams(clinic).map((k) => values[k]),
        },
        clinic
      );
      messages.log(appt.clinic_id, appt.phone, 'out', 'bot', templates.render(clinic, values));
      return true;
    } catch (err) {
      logReminderError(appt, `No se pudo enviar el recordatorio con plantilla: ${err.message}`);
      return false; // se reintenta en la siguiente vuelta
    }
  }
  // Sin plantilla aprobada WhatsApp lo rechazaría: se registra una sola vez.
  logReminderError(
    appt,
    `Recordatorio de ${horas} h no enviado: el paciente no ha escrito en las últimas 24 h y la clínica no tiene la plantilla de recordatorio aprobada (estado: ${clinic?.reminder_template_status || 'sin crear'}).`
  );
  return true;
}

// Cada recordatorio tiene su tramo: el de 48 h se envía entre 48 h y 24 h
// antes (si el siguiente es el de 24 h); el último, desde sus horas hasta la
// cita. Si la cita se reserva tarde, solo sale el recordatorio del tramo en el
// que estemos (no varios de golpe).
function dueReminder(hoursList, hoursUntil) {
  for (let i = 0; i < hoursList.length; i++) {
    const upper = hoursList[i];
    const lower = hoursList[i + 1] ?? 0;
    if (hoursUntil <= upper && hoursUntil > lower) return upper;
  }
  return null;
}

async function checkAndSendReminders(now = Date.now()) {
  const appointments = getUpcomingAppointments();
  const cache = new Map();

  for (const appt of appointments) {
    if (!cache.has(appt.clinic_id)) cache.set(appt.clinic_id, clinics.getClinicById(appt.clinic_id));
    const clinic = cache.get(appt.clinic_id);
    const apptTime = slotDateTime(appt, clinic?.schedule?.timezone || DEFAULT_TZ).getTime();
    const hoursUntil = (apptTime - now) / (1000 * 60 * 60);
    const due = dueReminder(reminderHours(clinic), hoursUntil);
    if (due === null || wasSent(appt.appointment_id, due)) continue;

    try {
      if (await sendReminder(appt, due, clinic, now)) markReminderSent(appt.appointment_id, due);
    } catch (err) {
      console.error(`Error enviando recordatorio para la cita ${appt.appointment_id}:`, err);
    }
  }
}

// Recordatorio de prueba (onboarding): cita ficticia mañana a las 10:00, por el
// mismo camino que uno real (texto libre si el número escribió en las últimas
// 24 h; si no, la plantilla aprobada). No marca nada como enviado.
async function sendTestReminder(clinic, phone) {
  const to = String(phone || '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(to)) return { ok: false, error: 'Número no válido. Escríbelo con prefijo, p. ej. 34600111222.' };
  const tz = clinic?.schedule?.timezone || DEFAULT_TZ;
  const { todayIn, addDays } = require('./tz');
  const date = addDays(todayIn(tz), 1);
  const treatment = require('./agenda').treatmentsOf(clinic)?.[0]?.key || 'limpieza';
  const patient = db.prepare('SELECT name FROM patients WHERE clinic_id = ? AND phone = ?').get(clinic.id, to);
  const appt = { clinic_id: clinic.id, phone: to, patient_name: patient?.name || null, date, time: '10:00', treatment };
  if (inServiceWindow(clinic.id, to)) {
    const text = reminderMessage(appt, clinic);
    const ok = await whatsapp.sendText(to, text, clinic);
    if (ok) messages.log(clinic.id, to, 'out', 'bot', `[Recordatorio de prueba] ${text}`);
    return ok ? { ok: true, via: 'texto', text } : { ok: false, error: 'WhatsApp no aceptó el mensaje.' };
  }
  if (templates.isApproved(clinic?.reminder_template_status) && clinic.reminder_template_name) {
    const values = templateValues(appt, clinic);
    try {
      await whatsapp.sendTemplate(
        to,
        { name: clinic.reminder_template_name, language: templates.LANGUAGE, bodyParams: templates.clinicParams(clinic).map((k) => values[k]) },
        clinic
      );
      const text = templates.render(clinic, values);
      messages.log(clinic.id, to, 'out', 'bot', `[Recordatorio de prueba] ${text}`);
      return { ok: true, via: 'plantilla', text };
    } catch (err) {
      return { ok: false, error: `Meta rechazó la plantilla: ${err.message}` };
    }
  }
  return {
    ok: false,
    error: `Ese número no ha escrito a la clínica en las últimas 24 h y la plantilla aún no está aprobada (${clinic?.reminder_template_status || 'sin enviar'}). Escribe primero «hola» al número de la clínica desde ese móvil y vuelve a probar.`,
  };
}

function startReminderScheduler() {
  checkAndSendReminders().catch((err) => console.error('Error en comprobación inicial de recordatorios:', err));
  setInterval(() => {
    checkAndSendReminders().catch((err) => console.error('Error en comprobación de recordatorios:', err));
  }, CHECK_INTERVAL_MS);
}

module.exports = {
  startReminderScheduler,
  checkAndSendReminders,
  inServiceWindow,
  formatSlotForReminder,
  reminderHours,
  dueReminder,
  hoursLabel,
  reminderMessage,
  sendTestReminder,
  DEFAULT_HOURS,
  HOUR_OPTIONS,
  MAX_REMINDERS,
};
