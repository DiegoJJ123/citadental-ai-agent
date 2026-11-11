const db = require('../db/db');
const whatsapp = require('./whatsapp');
const clinics = require('./clinics');
const { zonedToDate, DEFAULT_TZ } = require('./tz');

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // cada 15 minutos

const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function slotDateTime(slot, tz = DEFAULT_TZ) {
  // date y time son hora local de la clínica; el servidor corre en UTC, así que
  // hay que convertir con la zona horaria (antes salía desplazado 1-2 h).
  return zonedToDate(slot.date, slot.time, tz);
}

function formatSlotForReminder(slot, clinic) {
  const [y, m, d] = slot.date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const t = clinic ? require('./agenda').findTreatment(clinic, slot.treatment) : null;
  return `${dias[weekday]} ${slot.date} a las ${slot.time} (${t?.nombre || slot.treatment})`;
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

async function checkAndSendReminders() {
  const now = Date.now();
  const appointments = getPendingAppointments();

  for (const appt of appointments) {
    const clinic = clinics.getClinicById(appt.clinic_id);
    const apptTime = slotDateTime(appt, clinic?.schedule?.timezone || DEFAULT_TZ).getTime();
    const hoursUntil = (apptTime - now) / (1000 * 60 * 60);

    try {
      if (!appt.reminder_48h_sent && hoursUntil <= 48 && hoursUntil > 24) {
        const ok = await whatsapp.sendText(appt.phone, reminderMessage(appt, 48, clinic), clinic);
        if (ok) markReminderSent(appt.appointment_id, 'reminder_48h_sent');
      }

      if (!appt.reminder_24h_sent && hoursUntil <= 24 && hoursUntil > 0) {
        const ok = await whatsapp.sendText(appt.phone, reminderMessage(appt, 24, clinic), clinic);
        if (ok) markReminderSent(appt.appointment_id, 'reminder_24h_sent');
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

module.exports = { startReminderScheduler, checkAndSendReminders };
