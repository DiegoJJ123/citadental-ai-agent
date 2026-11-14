// Recordatorios de cita (48 h y 24 h antes). WhatsApp solo permite texto libre
// si el paciente escribió en las últimas 24 h; si no, hay que usar la plantilla
// aprobada de la clínica (templates.js). Sin plantilla aprobada no se envía y
// queda registrado en error_log.
const db = require('../db/db');
const whatsapp = require('./whatsapp');
const clinics = require('./clinics');
const templates = require('./templates');
const messages = require('./messages');
const { zonedToDate, DEFAULT_TZ } = require('./tz');

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // cada 15 minutos
// Margen de seguridad: se considera fuera de ventana a partir de 23 h.
const WINDOW_MS = 23 * 60 * 60 * 1000;

const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

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

function getPendingAppointments() {
  return db
    .prepare(
      `SELECT a.id as appointment_id, a.clinic_id, a.reminder_48h_sent, a.reminder_24h_sent,
              p.phone, p.name as patient_name,
              s.date, s.time, s.treatment
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN slots s ON s.id = a.slot_id
       JOIN clinics c ON c.id = a.clinic_id
       WHERE a.status = 'confirmada' AND a.is_test = 0 AND c.status = 'activa'
         AND s.date >= date('now', '-1 day')
         AND (a.reminder_48h_sent = 0 OR a.reminder_24h_sent = 0)`
    )
    .all();
}

function markReminderSent(appointmentId, column) {
  db.prepare(`UPDATE appointments SET ${column} = 1 WHERE id = ?`).run(appointmentId);
}

function reminderMessage(appt, horas, clinic) {
  const saludo = appt.patient_name ? `Hola ${appt.patient_name}` : 'Hola';
  const cuando = horas === 48 ? 'en 2 días' : 'mañana';
  return `${saludo} 👋 Te recordamos tu cita del ${formatSlotForReminder(appt, clinic)} (${cuando}). Si necesitas cambiarla o cancelarla, escríbenos por aquí mismo.`;
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
    const text = reminderMessage(appt, horas, clinic);
    const ok = await whatsapp.sendText(appt.phone, text, clinic);
    if (ok) messages.log(appt.clinic_id, appt.phone, 'out', 'bot', text);
    return ok;
  }
  if (templates.isApproved(clinic?.reminder_template_status) && clinic.reminder_template_name) {
    try {
      await whatsapp.sendTemplate(
        appt.phone,
        {
          name: clinic.reminder_template_name,
          language: templates.LANGUAGE,
          bodyParams: [appt.patient_name || 'de nuevo', clinic.info?.nombre || clinic.name, formatSlotForReminder(appt, clinic)],
        },
        clinic
      );
      messages.log(appt.clinic_id, appt.phone, 'out', 'bot', `Recordatorio de cita (plantilla): ${formatSlotForReminder(appt, clinic)}`);
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

async function checkAndSendReminders(now = Date.now()) {
  const appointments = getPendingAppointments();

  for (const appt of appointments) {
    const clinic = clinics.getClinicById(appt.clinic_id);
    const apptTime = slotDateTime(appt, clinic?.schedule?.timezone || DEFAULT_TZ).getTime();
    const hoursUntil = (apptTime - now) / (1000 * 60 * 60);

    try {
      if (!appt.reminder_48h_sent && hoursUntil <= 48 && hoursUntil > 24) {
        if (await sendReminder(appt, 48, clinic, now)) markReminderSent(appt.appointment_id, 'reminder_48h_sent');
      }

      if (!appt.reminder_24h_sent && hoursUntil <= 24 && hoursUntil > 0) {
        if (await sendReminder(appt, 24, clinic, now)) markReminderSent(appt.appointment_id, 'reminder_24h_sent');
      }
    } catch (err) {
      console.error(`Error enviando recordatorio para la cita ${appt.appointment_id}:`, err);
    }
  }
}

function startReminderScheduler() {
  checkAndSendReminders().catch((err) => console.error('Error en comprobación inicial de recordatorios:', err));
  setInterval(() => {
    checkAndSendReminders().catch((err) => console.error('Error en comprobación de recordatorios:', err));
  }, CHECK_INTERVAL_MS);
}

module.exports = { startReminderScheduler, checkAndSendReminders, inServiceWindow, formatSlotForReminder };
