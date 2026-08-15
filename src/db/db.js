const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const raw = new DatabaseSync(path.join(__dirname, 'citadental.sqlite'));

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

db.exec(`
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,       -- YYYY-MM-DD
  time TEXT NOT NULL,       -- HH:MM
  treatment TEXT NOT NULL,  -- revision, limpieza, urgencia, ortodoncia, implante, estetica
  is_booked INTEGER DEFAULT 0,
  UNIQUE(date, time)
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  slot_id INTEGER NOT NULL,
  status TEXT DEFAULT 'confirmada', -- confirmada, cancelada
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reminder_48h_sent INTEGER DEFAULT 0,
  reminder_24h_sent INTEGER DEFAULT 0,
  FOREIGN KEY(patient_id) REFERENCES patients(id),
  FOREIGN KEY(slot_id) REFERENCES slots(id)
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
`);

// Migración simple: añade columnas nuevas a demo_leads si faltan (SQLite no soporta "ADD COLUMN IF NOT EXISTS").
const demoLeadsColumns = db.prepare("PRAGMA table_info(demo_leads)").all().map((c) => c.name);
if (!demoLeadsColumns.includes('fecha_hora_iso')) {
  db.exec('ALTER TABLE demo_leads ADD COLUMN fecha_hora_iso TEXT');
}
if (!demoLeadsColumns.includes('calendar_event_link')) {
  db.exec('ALTER TABLE demo_leads ADD COLUMN calendar_event_link TEXT');
}

// Migración simple: añade columnas de recordatorios a appointments si faltan.
const appointmentsColumns = db.prepare("PRAGMA table_info(appointments)").all().map((c) => c.name);
if (!appointmentsColumns.includes('reminder_48h_sent')) {
  db.exec('ALTER TABLE appointments ADD COLUMN reminder_48h_sent INTEGER DEFAULT 0');
}
if (!appointmentsColumns.includes('reminder_24h_sent')) {
  db.exec('ALTER TABLE appointments ADD COLUMN reminder_24h_sent INTEGER DEFAULT 0');
}

module.exports = db;
