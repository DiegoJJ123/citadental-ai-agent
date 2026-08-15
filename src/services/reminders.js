const db = require('../db/db');
const whatsapp = require('./whatsapp');

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // cada 15 minutos

const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function slotDateTime(slot) {
  // date y time son hora local de la clínica (Europe/Madrid); se guardan como texto naive.
  return new Date(`${slot.date}T${slot.time}:00`);
}

function formatSlotForReminder(slot) {
  const d = new Date(`${slot.date}T00:00:00`);
  return `${dias[d.getDay()]} ${slot.date} a las ${slot.time} (${slot.treatment})`;
}

function getPendingAppointments() {
  return db
    .prepare(
      `SELECT a.id as appointment_id, a.reminder_48h_sent, a.reminder_24h_sent,
              p.phone, p.name as patient_name,
              s.date, s.time, s.treatment
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN slots s ON s.id = a.slot_id
       WHERE a.status = 'confirmada'
         AND s.date >= date('now', '-1 day')
         AND (a.reminder_48h_sent = 0 OR a.reminder_24h_sent = 0)`
    )
    .all();
}

function markReminderSent(appointmentId, column) {
  db.prepare(`UPDATE appointments SET ${column} = 1 WHERE id = ?`).run(appointmentId);
}

function reminderMessage(appt, horas) {
  const saludo = appt.patient_name ? `Hola ${appt.patient_name}` : 'Hola';
  const cuando = horas === 48 ? 'en 2 días' : 'mañana';
  return `${saludo} 👋 Te recordamos tu cita de ${appt.treatment} el ${formatSlotForReminder(appt)} (${cuando}). Si necesitas cambiarla o cancelarla, escríbenos por aquí mismo.`;
}

async function checkAndSendReminders() {
  const now = Date.now();
  const appointments = getPendingAppointments();

  for (const appt of appointments) {
    const apptTime = slotDateTime(appt).getTime();
    const hoursUntil = (apptTime - now) / (1000 * 60 * 60);

    try {
      if (!appt.reminder_48h_sent && hoursUntil <= 48 && hoursUntil > 24) {
        const ok = await whatsapp.sendText(appt.phone, reminderMessage(appt, 48));
        if (ok) markReminderSent(appt.appointment_id, 'reminder_48h_sent');
      }

      if (!appt.reminder_24h_sent && hoursUntil <= 24 && hoursUntil > 0) {
        const ok = await whatsapp.sendText(appt.phone, reminderMessage(appt, 24));
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
