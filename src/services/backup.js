// Copias de seguridad de la base de datos (SQLite).
// - Cada día: copia consistente con VACUUM INTO en <carpeta de la BD>/backups
//   (se guardan las últimas 14) y se envía comprimida por email (fuera de
//   Render). Render ya hace instantáneas del disco, pero avisa de que con una
//   base de datos en uso pueden salir corruptas; estas copias no.
// - Descarga manual desde el dashboard (/onboarding/salud).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('../db/db');
const mailer = require('./mailer');

const DB_FILE = process.env.DB_PATH || path.join(__dirname, '..', 'db', 'citadental.sqlite');
const DIR = path.join(path.dirname(DB_FILE), 'backups');
const KEEP = 14;
const MAX_EMAIL_BYTES = 18 * 1024 * 1024; // límite práctico de adjuntos

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || null;
}

// Copia consistente en un fichero nuevo. Devuelve la ruta.
function snapshot(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) fs.unlinkSync(target);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
}

function prune() {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => /^citadental-\d{4}-\d{2}-\d{2}\.sqlite\.gz$/.test(f))
    .sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.unlinkSync(path.join(DIR, f));
}

function listBackups() {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.sqlite.gz'))
    .sort()
    .reverse()
    .map((f) => ({ name: f, size: fs.statSync(path.join(DIR, f)).size }));
}

// Copia del día: la guarda comprimida y la envía por email.
async function runDailyBackup({ force = false } = {}) {
  const day = new Date().toISOString().slice(0, 10);
  if (!force && getSetting('backup_last_day') === day) return { skipped: true };
  const tmp = path.join(DIR, `tmp-${Date.now()}.sqlite`);
  const gzName = `citadental-${day}.sqlite.gz`;
  const gzPath = path.join(DIR, gzName);
  try {
    snapshot(tmp);
    const gz = zlib.gzipSync(fs.readFileSync(tmp));
    fs.writeFileSync(gzPath, gz);
    prune();
    const emailed =
      gz.length <= MAX_EMAIL_BYTES &&
      (await mailer.send({
        subject: `Copia de seguridad CitaDental AI · ${day}`,
        text: `Copia diaria de la base de datos (${(gz.length / 1024).toFixed(0)} KB comprimida).\n\nGuárdala: si algún día hiciera falta restaurar, descomprímela (citadental.sqlite) y súbela al disco de Render como ${DB_FILE}.`,
        attachments: [{ filename: gzName, content: gz }],
      }));
    setSetting('backup_last_day', day);
    setSetting('backup_last', JSON.stringify({ at: new Date().toISOString(), file: gzName, size: gz.length, emailed: Boolean(emailed) }));
    return { ok: true, file: gzName, size: gz.length, emailed: Boolean(emailed) };
  } catch (err) {
    setSetting('backup_last_error', JSON.stringify({ at: new Date().toISOString(), message: err.message }));
    console.error('Error en la copia de seguridad:', err);
    return { ok: false, error: err.message };
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

// Para la descarga manual: buffer comprimido de una copia recién hecha.
function freshBackupBuffer() {
  const tmp = path.join(DIR, `dl-${Date.now()}.sqlite`);
  try {
    snapshot(tmp);
    return zlib.gzipSync(fs.readFileSync(tmp));
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function lastBackup() {
  try {
    return JSON.parse(getSetting('backup_last') || 'null');
  } catch {
    return null;
  }
}

module.exports = { runDailyBackup, freshBackupBuffer, listBackups, lastBackup, DIR };
