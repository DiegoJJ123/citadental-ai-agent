const db = require('../db/db');

function getDashboardStats(clinicId = db.DEMO_CLINIC_ID) {
  const totalMessages = db.prepare('SELECT COUNT(*) AS n FROM message_log WHERE clinic_id = ?').get(clinicId).n;
  const messagesToday = db
    .prepare("SELECT COUNT(*) AS n FROM message_log WHERE clinic_id = ? AND date(created_at) = date('now')")
    .get(clinicId).n;
  const messagesLast24h = db
    .prepare("SELECT COUNT(*) AS n FROM message_log WHERE clinic_id = ? AND datetime(created_at) >= datetime('now', '-1 day')")
    .get(clinicId).n;
  const recentErrorCount = db
    .prepare("SELECT COUNT(*) AS n FROM error_log WHERE (clinic_id = ? OR clinic_id IS NULL) AND datetime(created_at) >= datetime('now', '-1 day')")
    .get(clinicId).n;

  const totalAppointments = db.prepare('SELECT COUNT(*) AS n FROM appointments WHERE clinic_id = ?').get(clinicId).n;
  const confirmedAppointments = db
    .prepare("SELECT COUNT(*) AS n FROM appointments WHERE clinic_id = ? AND status = 'confirmada'")
    .get(clinicId).n;

  const totalLeads = db.prepare('SELECT COUNT(*) AS n FROM demo_leads WHERE clinic_id = ?').get(clinicId).n;

  const recentAppointments = db
    .prepare(
      `SELECT a.id, a.status, a.created_at, p.name AS patient_name, p.phone AS patient_phone,
              s.date AS slot_date, s.time AS slot_time, s.treatment
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN slots s ON s.id = a.slot_id
       WHERE a.clinic_id = ?
       ORDER BY a.created_at DESC
       LIMIT 10`
    )
    .all(clinicId);

  const recentLeads = db
    .prepare(
      `SELECT id, phone, nombre, email, telefono_contacto, notas, created_at
       FROM demo_leads
       WHERE clinic_id = ?
       ORDER BY created_at DESC
       LIMIT 10`
    )
    .all(clinicId);

  return {
    totalMessages,
    messagesToday,
    messagesLast24h,
    recentErrorCount,
    totalAppointments,
    confirmedAppointments,
    totalLeads,
    recentAppointments,
    recentLeads,
  };
}

module.exports = { getDashboardStats };
