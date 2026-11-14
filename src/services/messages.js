// Registro de mensajes y acciones del panel de conversaciones.
const db = require('../db/db');
const whatsapp = require('./whatsapp');

// WhatsApp solo deja escribir texto libre si el paciente escribió en las
// últimas 24 h (margen de seguridad: 23 h).
const WINDOW_MS = 23 * 60 * 60 * 1000;

function log(clinicId, phone, direction, author, body) {
  if (!clinicId || !phone || !body) return;
  try {
    db.prepare('INSERT INTO messages (clinic_id, phone, direction, author, body) VALUES (?, ?, ?, ?, ?)').run(
      clinicId,
      String(phone),
      direction,
      author,
      String(body).slice(0, 4000)
    );
  } catch (err) {
    console.error('No se pudo guardar el mensaje en el registro:', err.message);
  }
}

const toTs = (sqlite) => Date.parse(String(sqlite).replace(' ', 'T') + 'Z'); // CURRENT_TIMESTAMP de SQLite es UTC

// Lista de chats de una clínica, del más reciente al más antiguo.
function listChats(clinicId, { limit = 200 } = {}) {
  return db
    .prepare(
      `WITH chats AS (
         SELECT clinic_id, phone, MAX(id) AS last_id, MAX(created_at) AS last_at, COUNT(*) AS total,
                MAX(CASE WHEN direction = 'in' THEN created_at END) AS last_in_at
         FROM messages
         WHERE clinic_id = ? AND phone NOT LIKE 'prueba-%'
         GROUP BY phone
       )
       SELECT ch.phone, ch.last_id, ch.last_at, ch.last_in_at, ch.total,
              lm.body AS last_body, lm.author AS last_author,
              (SELECT name FROM patients p WHERE p.clinic_id = ch.clinic_id AND p.phone = ch.phone LIMIT 1) AS patient_name,
              COALESCE(c.escalated, 0) AS paused
       FROM chats ch
       JOIN messages lm ON lm.id = ch.last_id
       LEFT JOIN conversations c ON c.clinic_id = ch.clinic_id AND c.phone = ch.phone
       ORDER BY ch.last_id DESC
       LIMIT ?`
    )
    .all(clinicId, limit);
}

function getChat(clinicId, phone, { limit = 300 } = {}) {
  const rows = db
    .prepare('SELECT direction, author, body, created_at FROM messages WHERE clinic_id = ? AND phone = ? ORDER BY id DESC LIMIT ?')
    .all(clinicId, phone, limit)
    .reverse();
  const patient = db.prepare('SELECT name FROM patients WHERE clinic_id = ? AND phone = ?').get(clinicId, phone);
  const conv = db.prepare('SELECT escalated FROM conversations WHERE clinic_id = ? AND phone = ?').get(clinicId, phone);
  return { phone, name: patient?.name || null, paused: Boolean(conv?.escalated), messages: rows, canWrite: inWindow(clinicId, phone) };
}

function inWindow(clinicId, phone, now = Date.now()) {
  const row = db
    .prepare("SELECT MAX(created_at) AS last FROM messages WHERE clinic_id = ? AND phone = ? AND direction = 'in'")
    .get(clinicId, phone);
  return Boolean(row?.last) && now - toTs(row.last) < WINDOW_MS;
}

function setPaused(clinicId, phone, paused) {
  db.prepare(
    `INSERT INTO conversations (clinic_id, phone, history, escalated) VALUES (?, ?, '[]', ?)
     ON CONFLICT(clinic_id, phone) DO UPDATE SET escalated = ?, updated_at = CURRENT_TIMESTAMP`
  ).run(clinicId, phone, paused ? 1 : 0, paused ? 1 : 0);
  log(clinicId, phone, 'out', 'system', paused ? 'Asistente pausado en este chat' : 'Asistente reactivado en este chat');
}

// Mensaje escrito por recepción desde el panel. Pausa el asistente en ese chat
// para que no conteste por encima de la persona.
async function sendManual(clinic, phone, text) {
  const body = String(text || '').trim();
  if (!body) return { ok: false, error: 'El mensaje está vacío.' };
  if (!inWindow(clinic.id, phone)) {
    return { ok: false, error: 'Han pasado más de 24 h desde el último mensaje del paciente: WhatsApp no deja escribirle texto libre. Respóndele cuando vuelva a escribir.' };
  }
  const ok = await whatsapp.sendText(phone, body, clinic);
  if (!ok) return { ok: false, error: 'WhatsApp no aceptó el mensaje. Inténtalo de nuevo en unos segundos.' };
  log(clinic.id, phone, 'out', 'human', body);
  const conv = db.prepare('SELECT escalated FROM conversations WHERE clinic_id = ? AND phone = ?').get(clinic.id, phone);
  if (!conv?.escalated) setPaused(clinic.id, phone, true);
  return { ok: true };
}

function stats(clinicId) {
  return db
    .prepare(
      `SELECT COUNT(DISTINCT phone) AS chats,
              SUM(CASE WHEN direction = 'in' AND created_at >= date('now','start of month') THEN 1 ELSE 0 END) AS in_month
       FROM messages WHERE clinic_id = ? AND phone NOT LIKE 'prueba-%'`
    )
    .get(clinicId);
}

module.exports = { log, listChats, getChat, inWindow, setPaused, sendManual, stats, toTs };
