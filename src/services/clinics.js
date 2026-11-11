// Registro de clínicas (multiclínica). Cada clínica tiene su número de
// WhatsApp, sus datos reales y su estado de onboarding.
const db = require('../db/db');

const UPDATABLE_FIELDS = [
  'name',
  'status',
  'onboarding_step',
  'website',
  'info_json',
  'whatsapp_phone_number_id',
  'whatsapp_display_phone',
  'whatsapp_token',
  'reception_phone',
  'reception_email',
  'calendar_provider',
  'google_refresh_token',
  'google_calendar_id',
];

function parse(row) {
  if (!row) return null;
  let info = {};
  try {
    info = JSON.parse(row.info_json || '{}');
  } catch {
    info = {};
  }
  return { ...row, info, isDemo: row.mode === 'demo' };
}

function getClinicById(id) {
  return parse(db.prepare('SELECT * FROM clinics WHERE id = ?').get(id));
}

function getDemoClinic() {
  return getClinicById(db.DEMO_CLINIC_ID);
}

function getClinicByPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null;
  return parse(db.prepare('SELECT * FROM clinics WHERE whatsapp_phone_number_id = ?').get(String(phoneNumberId)));
}

function listClinics() {
  return db.prepare('SELECT * FROM clinics ORDER BY created_at DESC').all().map(parse);
}

function slugify(name) {
  return (
    String(name)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'clinica'
  );
}

function createClinic({ name, website }) {
  if (!name || !String(name).trim()) throw new Error('Falta el nombre de la clínica');
  const base = slugify(name);
  let slug = base;
  for (let i = 2; db.prepare('SELECT 1 FROM clinics WHERE slug = ?').get(slug); i++) slug = `${base}-${i}`;
  const info = db
    .prepare("INSERT INTO clinics (slug, name, mode, status, website) VALUES (?, ?, 'clinica', 'onboarding', ?)")
    .run(slug, String(name).trim(), website || null);
  return getClinicById(info.lastInsertRowid);
}

function updateClinic(id, fields) {
  const entries = Object.entries(fields).filter(([k]) => UPDATABLE_FIELDS.includes(k));
  if (!entries.length) return getClinicById(id);
  const values = entries.map(([k, v]) => (k === 'info_json' && typeof v !== 'string' ? JSON.stringify(v) : v));
  db.prepare(
    `UPDATE clinics SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(...values, id);
  return getClinicById(id);
}

// Una clínica solo atiende pacientes si está activa (la demo siempre lo está).
function isServing(clinic) {
  return Boolean(clinic) && clinic.status === 'activa';
}

module.exports = {
  getClinicById,
  getDemoClinic,
  getClinicByPhoneNumberId,
  listClinics,
  createClinic,
  updateClinic,
  isServing,
  slugify,
};
