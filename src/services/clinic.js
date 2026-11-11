// Agenda y pacientes. Todas las operaciones van acotadas a una clínica
// (clinicId): dos clínicas pueden tener al mismo paciente y huecos a la misma hora.
const db = require('../db/db');

function getOrCreatePatient(clinicId, phone, name) {
  let patient = db.prepare('SELECT * FROM patients WHERE clinic_id = ? AND phone = ?').get(clinicId, phone);
  if (!patient) {
    db.prepare('INSERT INTO patients (clinic_id, phone, name) VALUES (?, ?, ?)').run(clinicId, phone, name || null);
    patient = db.prepare('SELECT * FROM patients WHERE clinic_id = ? AND phone = ?').get(clinicId, phone);
  } else if (name && !patient.name) {
    db.prepare('UPDATE patients SET name = ? WHERE id = ?').run(name, patient.id);
  }
  return patient;
}

function listAvailableSlots(clinicId, { date, treatment, limit = 8 }) {
  let query = 'SELECT * FROM slots WHERE clinic_id = ? AND is_booked = 0';
  const params = [clinicId];
  if (date) {
    query += ' AND date = ?';
    params.push(date);
  } else {
    query += " AND date >= date('now')";
  }
  if (treatment) {
    query += ' AND treatment = ?';
    params.push(treatment);
  }
  query += ' ORDER BY date ASC, time ASC LIMIT ?';
  params.push(limit);
  return db.prepare(query).all(...params);
}

function bookAppointment(clinicId, { phone, name, slotId }) {
  const slot = db.prepare('SELECT * FROM slots WHERE id = ? AND clinic_id = ?').get(slotId, clinicId);
  if (!slot) return { ok: false, error: 'Ese hueco ya no existe.' };
  if (slot.is_booked) return { ok: false, error: 'Ese hueco ya no está disponible.' };

  const patient = getOrCreatePatient(clinicId, phone, name);

  const result = db.transaction(() => {
    db.prepare('UPDATE slots SET is_booked = 1 WHERE id = ?').run(slotId);
    const info = db
      .prepare('INSERT INTO appointments (clinic_id, patient_id, slot_id, status) VALUES (?, ?, ?, ?)')
      .run(clinicId, patient.id, slotId, 'confirmada');
    return info.lastInsertRowid;
  })();

  return { ok: true, appointmentId: result, slot };
}

function getUpcomingAppointment(clinicId, phone) {
  const patient = db.prepare('SELECT * FROM patients WHERE clinic_id = ? AND phone = ?').get(clinicId, phone);
  if (!patient) return null;
  return db
    .prepare(
      `SELECT a.id as appointment_id, s.* FROM appointments a
       JOIN slots s ON s.id = a.slot_id
       WHERE a.clinic_id = ? AND a.patient_id = ? AND a.status = 'confirmada' AND s.date >= date('now')
       ORDER BY s.date ASC, s.time ASC LIMIT 1`
    )
    .get(clinicId, patient.id);
}

function cancelAppointment(clinicId, phone) {
  const appt = getUpcomingAppointment(clinicId, phone);
  if (!appt) return { ok: false, error: 'No encuentro ninguna cita activa para este número.' };

  db.transaction(() => {
    db.prepare("UPDATE appointments SET status = 'cancelada' WHERE id = ?").run(appt.appointment_id);
    db.prepare('UPDATE slots SET is_booked = 0 WHERE id = ?').run(appt.id);
  })();

  return { ok: true, freedSlot: appt };
}

function rescheduleAppointment(clinicId, { phone, newSlotId }) {
  const cancelResult = cancelAppointment(clinicId, phone);
  if (!cancelResult.ok) return cancelResult;

  const bookResult = bookAppointment(clinicId, { phone, slotId: newSlotId });
  if (!bookResult.ok) {
    // revertir: rehacer la cita anterior si el nuevo hueco falla
    bookAppointment(clinicId, { phone, slotId: cancelResult.freedSlot.id });
    return bookResult;
  }
  return bookResult;
}

module.exports = {
  getOrCreatePatient,
  listAvailableSlots,
  bookAppointment,
  getUpcomingAppointment,
  cancelAppointment,
  rescheduleAppointment,
};
