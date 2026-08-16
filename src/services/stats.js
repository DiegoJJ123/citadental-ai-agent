const db = require('../db/db');

function getDashboardStats() {
  const totalMessages = db.prepare('SELECT COUNT(*) AS n FROM message_log').get().n;
  const messagesToday = db
    .prepare("SELECT COUNT(*) AS n FROM message_log WHERE date(created_at) = date('now')")
    .get().n;
  const messagesLast24h = db
    .prepare("SELECT COUNT(*) AS n FROM message_log WHERE datetime(created_at) >= datetime('now', '-1 day')")
    .get().n;
  const recentErrorCount = db
    .prepare("SELECT COUNT(*) AS n FROM error_log WHERE datetime(created_at) >= datetime('now', '-1 day')")
    .get().n;

  const totalAppointments = db.prepare('SELECT COUNT(*) AS n FROM appointments').get().n;
  const confirmedAppointments = db
    .prepare("SELECT COUNT(*) AS n FROM appointments WHERE status = 'confirmada'")
    .get().n;

  const totalLeads = db.prepare('SELECT COUNT(*) AS n FROM demo_leads').get().n;

  const recentAppointments = db
    .prepare(
      `SELECT a.id, a.status, a.created_at, p.name AS patient_name, p.phone AS patient_phone,
              s.date AS slot_date, s.time AS slot_time, s.treatment
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN slots s ON s.id = a.slot_id
       ORDER BY a.created_at DESC
       LIMIT 10`
    )
    .all();

  const recentLeads = db
    .prepare(
      `SELECT id, phone, nombre, email, telefono_contacto, notas, created_at
       FROM demo_leads
       ORDER BY created_at DESC
       LIMIT 10`
    )
    .all();

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
