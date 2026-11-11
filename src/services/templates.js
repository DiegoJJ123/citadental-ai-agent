// Plantilla de recordatorio de cita. WhatsApp solo deja escribir primero a un
// paciente (fuera de las 24 h desde su último mensaje) con una plantilla
// aprobada por Meta. Se crea en la cuenta de WhatsApp de cada clínica al
// conectarla en el onboarding (paso 5).
const db = require('../db/db');
const ycloud = require('./ycloud');

const NAME = 'recordatorio_cita_v1';
const LANGUAGE = 'es';
const BODY = 'Hola {{1}} 👋 Te recordamos tu cita en {{2}} el {{3}}. Si necesitas cambiarla o cancelarla, respóndenos por aquí.';
const EXAMPLE = ['Laura', 'Clínica Dental Sonrisa', 'lunes 17 de noviembre a las 10:00'];

// Estados de Meta/YCloud que significan "se puede enviar".
const isApproved = (status) => String(status || '').toUpperCase() === 'APPROVED';

async function ensureReminderTemplate(clinic) {
  if (!clinic.whatsapp_waba_id) throw new Error('Falta el WhatsApp Business Account ID de la clínica');
  if (clinic.whatsapp_provider !== 'ycloud') throw new Error('Las plantillas automáticas solo están disponibles con YCloud');
  let status;
  try {
    const existing = await ycloud.getTemplate(clinic.whatsapp_waba_id, NAME, LANGUAGE);
    status = existing?.status;
  } catch (err) {
    if (err.status !== 404) throw err;
    const created = await ycloud.createTemplate({
      wabaId: clinic.whatsapp_waba_id,
      name: NAME,
      language: LANGUAGE,
      category: 'UTILITY',
      components: [{ type: 'BODY', text: BODY, example: { body_text: [EXAMPLE] } }],
    });
    status = created?.status || 'PENDING';
  }
  db.prepare('UPDATE clinics SET reminder_template_name = ?, reminder_template_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    NAME,
    status,
    clinic.id
  );
  return { name: NAME, status };
}

// Refresca el estado consultando a YCloud (por si se perdió el webhook).
async function refreshStatus(clinic) {
  if (!clinic.whatsapp_waba_id || clinic.whatsapp_provider !== 'ycloud' || !clinic.reminder_template_name) return clinic.reminder_template_status;
  const t = await ycloud.getTemplate(clinic.whatsapp_waba_id, clinic.reminder_template_name, LANGUAGE);
  db.prepare('UPDATE clinics SET reminder_template_status = ? WHERE id = ?').run(t?.status || null, clinic.id);
  return t?.status || null;
}

// Webhook whatsapp.template.reviewed
function recordReview({ wabaId, name, language, status }) {
  if (!wabaId || !name || (language && language !== LANGUAGE)) return;
  db.prepare('UPDATE clinics SET reminder_template_status = ?, updated_at = CURRENT_TIMESTAMP WHERE whatsapp_waba_id = ? AND reminder_template_name = ?').run(
    status,
    wabaId,
    name
  );
}

module.exports = { NAME, LANGUAGE, BODY, isApproved, ensureReminderTemplate, refreshStatus, recordReview };
