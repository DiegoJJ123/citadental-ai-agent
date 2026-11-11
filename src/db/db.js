const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

// En Render la BD vive en un disco persistente (DB_PATH=/var/data/citadental.sqlite).
// Sin DB_PATH se usa el fichero local de siempre (desarrollo).
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'citadental.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const raw = new DatabaseSync(DB_PATH);
raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Envuelve node:sqlite con la misma interfaz que usa el resto del código (estilo better-sqlite3).
const db = {
  exec(sql) {
    raw.exec(sql);
  },
  prepare(sql) {
    const stmt = raw.prepare(sql);
    return {
      run: (...params) => stmt.run(...params),
      get: (...params) => stmt.get(...params),
      all: (...params) => stmt.all(...params),
    };
  },
  transaction(fn) {
    return (...args) => {
      raw.exec('BEGIN');
      try {
        const result = fn(...args);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    };
  },
};

// ID fijo de la clínica demo (el bot comercial de CitaDental AI). Todo lo que
// existía antes de ser multiclínica pertenece a ella.
const DEMO_CLINIC_ID = 1;

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

// ---------------------------------------------------------------------------
// Esquema v0 (monoclínica). Se mantiene para que una BD antigua se pueda
// migrar con los mismos pasos que una nueva.
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  treatment TEXT NOT NULL,
  is_booked INTEGER DEFAULT 0,
  UNIQUE(date, time)
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  slot_id INTEGER NOT NULL,
  status TEXT DEFAULT 'confirmada',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reminder_48h_sent INTEGER DEFAULT 0,
  reminder_24h_sent INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversations (
  phone TEXT PRIMARY KEY,
  history TEXT DEFAULT '[]',
  escalated INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS demo_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  nombre TEXT,
  email TEXT,
  telefono_contacto TEXT,
  notas TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS message_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT,
  context TEXT,
  message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// Migraciones v0 antiguas (columnas añadidas con el tiempo).
if (!columns('demo_leads').includes('fecha_hora_iso')) db.exec('ALTER TABLE demo_leads ADD COLUMN fecha_hora_iso TEXT');
if (!columns('demo_leads').includes('calendar_event_link')) db.exec('ALTER TABLE demo_leads ADD COLUMN calendar_event_link TEXT');
if (!columns('appointments').includes('reminder_48h_sent')) db.exec('ALTER TABLE appointments ADD COLUMN reminder_48h_sent INTEGER DEFAULT 0');
if (!columns('appointments').includes('reminder_24h_sent')) db.exec('ALTER TABLE appointments ADD COLUMN reminder_24h_sent INTEGER DEFAULT 0');

// ---------------------------------------------------------------------------
// v1: multiclínica. Tabla `clinics` y `clinic_id` en todos los datos de
// pacientes. SQLite no permite cambiar UNIQUE/PRIMARY KEY con ALTER TABLE, así
// que las tablas afectadas se reconstruyen copiando los datos (que pasan a la
// clínica demo).
// ---------------------------------------------------------------------------
function migrateToV1() {
  raw.exec('PRAGMA foreign_keys = OFF;');
  db.transaction(() => {
    db.exec(`
    CREATE TABLE clinics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'clinica',          -- demo | clinica
      status TEXT NOT NULL DEFAULT 'onboarding',     -- onboarding | activa | pausada
      onboarding_step TEXT,
      website TEXT,
      info_json TEXT NOT NULL DEFAULT '{}',          -- datos reales: dirección, horario, precios, mutuas...
      whatsapp_phone_number_id TEXT UNIQUE,
      whatsapp_display_phone TEXT,
      whatsapp_token TEXT,                           -- NULL = usa WHATSAPP_TOKEN del entorno
      reception_phone TEXT,
      reception_email TEXT,
      calendar_provider TEXT,                        -- google | doctoralia | gesden | cliniccloud
      google_refresh_token TEXT,
      google_calendar_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clinics (id, slug, name, mode, status) VALUES (${DEMO_CLINIC_ID}, 'demo', 'CitaDental AI (demo)', 'demo', 'activa');

    CREATE TABLE patients_v1 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clinic_id INTEGER NOT NULL REFERENCES clinics(id),
      phone TEXT NOT NULL,
      name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(clinic_id, phone)
    );
    INSERT INTO patients_v1 (id, clinic_id, phone, name, created_at)
      SELECT id, ${DEMO_CLINIC_ID}, phone, name, created_at FROM patients;
    DROP TABLE patients;
    ALTER TABLE patients_v1 RENAME TO patients;

    CREATE TABLE slots_v1 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clinic_id INTEGER NOT NULL REFERENCES clinics(id),
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      treatment TEXT NOT NULL,
      is_booked INTEGER DEFAULT 0,
      UNIQUE(clinic_id, date, time)
    );
    INSERT INTO slots_v1 (id, clinic_id, date, time, treatment, is_booked)
      SELECT id, ${DEMO_CLINIC_ID}, date, time, treatment, is_booked FROM slots;
    DROP TABLE slots;
    ALTER TABLE slots_v1 RENAME TO slots;

    CREATE TABLE appointments_v1 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clinic_id INTEGER NOT NULL REFERENCES clinics(id),
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      slot_id INTEGER NOT NULL REFERENCES slots(id),
      status TEXT DEFAULT 'confirmada',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reminder_48h_sent INTEGER DEFAULT 0,
      reminder_24h_sent INTEGER DEFAULT 0
    );
    INSERT INTO appointments_v1 (id, clinic_id, patient_id, slot_id, status, created_at, reminder_48h_sent, reminder_24h_sent)
      SELECT id, ${DEMO_CLINIC_ID}, patient_id, slot_id, status, created_at, reminder_48h_sent, reminder_24h_sent FROM appointments;
    DROP TABLE appointments;
    ALTER TABLE appointments_v1 RENAME TO appointments;

    CREATE TABLE conversations_v1 (
      clinic_id INTEGER NOT NULL REFERENCES clinics(id),
      phone TEXT NOT NULL,
      history TEXT DEFAULT '[]',
      escalated INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (clinic_id, phone)
    );
    INSERT INTO conversations_v1 (clinic_id, phone, history, escalated, updated_at)
      SELECT ${DEMO_CLINIC_ID}, phone, history, escalated, updated_at FROM conversations;
    DROP TABLE conversations;
    ALTER TABLE conversations_v1 RENAME TO conversations;

    ALTER TABLE demo_leads ADD COLUMN clinic_id INTEGER NOT NULL DEFAULT ${DEMO_CLINIC_ID};
    ALTER TABLE message_log ADD COLUMN clinic_id INTEGER NOT NULL DEFAULT ${DEMO_CLINIC_ID};
    ALTER TABLE error_log ADD COLUMN clinic_id INTEGER;

    CREATE INDEX idx_slots_clinic_date ON slots(clinic_id, date, is_booked);
    CREATE INDEX idx_appointments_clinic ON appointments(clinic_id, status);
    CREATE INDEX idx_message_log_clinic ON message_log(clinic_id, created_at);
    `);
  })();
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA user_version = 1;');
}

if (db.prepare('PRAGMA user_version').get().user_version < 1) {
  migrateToV1();
}

// ---------------------------------------------------------------------------
// v2: agenda real por clínica (Google Calendar).
// - clinics.schedule_json: horario, duración de cada tratamiento, antelación.
// - slots.duration_min: duración del hueco (en la demo, 30).
// - appointments.google_event_id: evento creado en el calendario de la clínica.
// ---------------------------------------------------------------------------
if (db.prepare('PRAGMA user_version').get().user_version < 2) {
  db.transaction(() => {
    db.exec(`
    ALTER TABLE clinics ADD COLUMN schedule_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE slots ADD COLUMN duration_min INTEGER NOT NULL DEFAULT 30;
    ALTER TABLE appointments ADD COLUMN google_event_id TEXT;
    ALTER TABLE appointments ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE clinics ADD COLUMN whatsapp_waba_id TEXT;
    `);
  })();
  raw.exec('PRAGMA user_version = 2;');
}

// ---------------------------------------------------------------------------
// v3: WhatsApp a través de YCloud (coexistencia) y plantilla de recordatorio.
// - clinics.whatsapp_provider: 'meta' (Cloud API directa, como la demo hasta
//   ahora) o 'ycloud'.
// - clinics.whatsapp_phone: número de la clínica en E.164 con '+' (YCloud lo
//   usa como remitente y para saber a qué clínica llega cada mensaje).
// - clinics.reminder_template_*: plantilla de recordatorio en su cuenta de WA.
// - webhook_events: ids de eventos ya procesados (YCloud reintenta envíos).
// ---------------------------------------------------------------------------
if (db.prepare('PRAGMA user_version').get().user_version < 3) {
  db.transaction(() => {
    db.exec(`
    ALTER TABLE clinics ADD COLUMN whatsapp_provider TEXT NOT NULL DEFAULT 'meta';
    ALTER TABLE clinics ADD COLUMN whatsapp_phone TEXT;
    ALTER TABLE clinics ADD COLUMN reminder_template_name TEXT;
    ALTER TABLE clinics ADD COLUMN reminder_template_status TEXT;
    CREATE UNIQUE INDEX idx_clinics_whatsapp_phone ON clinics(whatsapp_phone) WHERE whatsapp_phone IS NOT NULL;
    CREATE TABLE webhook_events (
      id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    `);
  })();
  raw.exec('PRAGMA user_version = 3;');
}

// La clínica demo responde por el número del entorno (WHATSAPP_PHONE_NUMBER_ID).
if (process.env.WHATSAPP_PHONE_NUMBER_ID) {
  db.prepare('UPDATE clinics SET whatsapp_phone_number_id = ? WHERE id = ? AND whatsapp_phone_number_id IS NOT ?').run(
    process.env.WHATSAPP_PHONE_NUMBER_ID,
    DEMO_CLINIC_ID,
    process.env.WHATSAPP_PHONE_NUMBER_ID
  );
}

db.DEMO_CLINIC_ID = DEMO_CLINIC_ID;
db.DB_PATH = DB_PATH;

module.exports = db;
