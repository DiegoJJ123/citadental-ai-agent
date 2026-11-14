// Plantilla de recordatorio de cita. WhatsApp solo deja escribir primero a un
// paciente (fuera de las 24 h desde su último mensaje) con una plantilla
// aprobada por Meta.
//
// El texto lo revisa y edita quien hace el onboarding (paso 5) antes de
// enviarlo a Meta. Se escribe con huecos legibles —{nombre}, {clinica},
// {cita}— que aquí se traducen a los {{1}}, {{2}}… que exige Meta, guardando
// en qué orden van para rellenarlos al enviar (clinics.reminder_template_params).
const db = require('../db/db');
const ycloud = require('./ycloud');

const BASE_NAME = 'recordatorio_cita';
const NAME = `${BASE_NAME}_v1`; // la demo y las clínicas antiguas usan esta
const LANGUAGE = 'es';

const TOKENS = {
  nombre: { label: 'nombre del paciente', example: 'Laura' },
  clinica: { label: 'nombre de la clínica', example: 'Clínica Dental Sonrisa' },
  cita: { label: 'día, hora y tratamiento', example: 'martes 17 de noviembre a las 10:00 (Limpieza dental)' },
};
const DEFAULT_PARAMS = ['nombre', 'clinica', 'cita'];
const DEFAULT_TEXT = 'Hola {nombre} 👋 Te recordamos tu cita en {clinica} el {cita}. Si necesitas cambiarla o cancelarla, respóndenos por aquí.';
const MAX_LEN = 900;

// Estados de Meta/YCloud que significan "se puede enviar".
const isApproved = (status) => String(status || '').toUpperCase() === 'APPROVED';

function clinicText(clinic) {
  return clinic?.reminder_template_text || DEFAULT_TEXT;
}

function clinicParams(clinic) {
  try {
    const p = JSON.parse(clinic?.reminder_template_params || 'null');
    if (Array.isArray(p) && p.every((k) => TOKENS[k])) return p;
  } catch {
    /* valor antiguo o vacío */
  }
  return DEFAULT_PARAMS;
}

// Comprueba el texto con las reglas de Meta. Devuelve { error } o
// { text, body, params, example }.
function compile(rawText) {
  const text = String(rawText || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return { error: 'El texto está vacío.' };
  if (text.length > MAX_LEN) return { error: `El texto es demasiado largo (${text.length} caracteres, máximo ${MAX_LEN}).` };
  if (/\{\{|\}\}/.test(text)) return { error: 'Usa los huecos entre llaves simples: {nombre}, {clinica}, {cita}.' };
  const found = [...text.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1].trim().toLowerCase());
  const unknown = found.filter((k) => !TOKENS[k]);
  if (unknown.length) return { error: `Hueco no válido: {${unknown[0]}}. Solo se pueden usar {nombre}, {clinica} y {cita}.` };
  if (new Set(found).size !== found.length) return { error: 'Cada hueco ({nombre}, {clinica}, {cita}) solo puede aparecer una vez.' };
  if (!found.includes('cita')) return { error: 'El texto tiene que incluir {cita} (el día y la hora de la cita).' };
  if (/^\{[^{}]+\}/.test(text) || /\{[^{}]+\}$/.test(text)) {
    return { error: 'Meta no acepta que el texto empiece o termine con un hueco. Añade texto antes o después (por ejemplo, un punto o una frase final).' };
  }
  if (/\}\s*\{/.test(text)) return { error: 'Pon texto entre dos huecos seguidos (Meta no acepta {nombre}{cita}).' };
  let n = 0;
  const body = text.replace(/\{([^{}]*)\}/g, () => `{{${++n}}}`);
  return { text, body, params: found, example: found.map((k) => TOKENS[k].example) };
}

// Texto con los huecos rellenos (vista previa y recordatorios de texto libre).
function render(clinic, values) {
  return clinicText(clinic).replace(/\{([^{}]*)\}/g, (m, k) => (values[k.trim().toLowerCase()] ?? m));
}

async function templateExists(wabaId, name) {
  try {
    return await ycloud.getTemplate(wabaId, name, LANGUAGE);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

function saveTemplate(clinic, { name, status, text, params }) {
  db.prepare(
    `UPDATE clinics SET reminder_template_name = ?, reminder_template_status = ?, reminder_template_text = ?, reminder_template_params = ?,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(name, status, text, JSON.stringify(params), clinic.id);
}

function checkClinic(clinic) {
  if (!clinic.whatsapp_waba_id) throw new Error('Falta el WhatsApp Business Account ID de la clínica');
  if (clinic.whatsapp_provider !== 'ycloud') throw new Error('Las plantillas automáticas solo están disponibles con YCloud');
}

// Envía a Meta el texto revisado en el onboarding. Cada texto nuevo es una
// plantilla nueva (recordatorio_cita_v2, v3…): Meta no deja reutilizar nombres.
async function submitReminderTemplate(clinic, rawText) {
  checkClinic(clinic);
  const c = compile(rawText);
  if (c.error) throw new Error(c.error);
  let v = Number(/_v(\d+)$/.exec(clinic.reminder_template_name || '')?.[1] || 0) + 1;
  let name = `${BASE_NAME}_v${v}`;
  // Por si la cuenta ya tiene plantillas con ese nombre (números reutilizados).
  for (let i = 0; i < 20 && (await templateExists(clinic.whatsapp_waba_id, name)); i++) name = `${BASE_NAME}_v${++v}`;
  const created = await ycloud.createTemplate({
    wabaId: clinic.whatsapp_waba_id,
    name,
    language: LANGUAGE,
    category: 'UTILITY',
    components: [{ type: 'BODY', text: c.body, example: { body_text: [c.example] } }],
  });
  const status = created?.status || 'PENDING';
  saveTemplate(clinic, { name, status, text: c.text, params: c.params });
  return { name, status };
}

// Plantilla con el texto por defecto (la usa la demo al conectar su número).
async function ensureReminderTemplate(clinic) {
  checkClinic(clinic);
  const existing = await templateExists(clinic.whatsapp_waba_id, NAME);
  if (existing) {
    saveTemplate(clinic, { name: NAME, status: existing.status, text: DEFAULT_TEXT, params: DEFAULT_PARAMS });
    return { name: NAME, status: existing.status };
  }
  const c = compile(DEFAULT_TEXT);
  const created = await ycloud.createTemplate({
    wabaId: clinic.whatsapp_waba_id,
    name: NAME,
    language: LANGUAGE,
    category: 'UTILITY',
    components: [{ type: 'BODY', text: c.body, example: { body_text: [c.example] } }],
  });
  const status = created?.status || 'PENDING';
  saveTemplate(clinic, { name: NAME, status, text: c.text, params: c.params });
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

module.exports = {
  NAME,
  LANGUAGE,
  TOKENS,
  DEFAULT_TEXT,
  MAX_LEN,
  isApproved,
  compile,
  render,
  clinicText,
  clinicParams,
  submitReminderTemplate,
  ensureReminderTemplate,
  refreshStatus,
  recordReview,
};
