// Arranque de un servidor nuevo copiando la base de datos de otro (p. ej. al
// mover el bot de región en Render). Se ejecuta ANTES de abrir la BD.
//
//   MIGRATE_FROM=https://citadental-ai-bot.onrender.com   (servidor de origen)
//   MIGRATION_TOKEN=<secreto compartido, mínimo 32 caracteres, igual en ambos>
//   MIGRATE_FORCE=<cualquier valor>  → vuelve a copiar cada vez que cambie
//
// Sin MIGRATE_FROM no hace nada. Si la BD ya existe solo copia cuando
// MIGRATE_FORCE cambia de valor (para la resincronización justo antes del
// cambio de dominio).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

async function run() {
  const from = (process.env.MIGRATE_FROM || '').replace(/\/+$/, '');
  const token = process.env.MIGRATION_TOKEN || '';
  if (!from) return;
  if (token.length < 32) throw new Error('MIGRATE_FROM sin MIGRATION_TOKEN válido (mínimo 32 caracteres)');
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'citadental.sqlite');
  const marker = `${dbPath}.migrated`;
  const force = process.env.MIGRATE_FORCE || '';
  const done = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : null;
  if (fs.existsSync(dbPath) && done !== null && done === force) return;
  if (fs.existsSync(dbPath) && done === null && !force) return; // BD propia: no se pisa

  console.log(`[migración] Copiando la base de datos desde ${from}…`);
  const res = await fetch(`${from}/internal/backup`, { headers: { 'X-Migration-Token': token } });
  if (!res.ok) throw new Error(`[migración] El origen respondió ${res.status}`);
  const sqlite = zlib.gunzipSync(Buffer.from(await res.arrayBuffer()));
  if (sqlite.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error('[migración] La copia recibida no es una base de datos SQLite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
  fs.writeFileSync(dbPath, sqlite);
  fs.writeFileSync(marker, force);
  console.log(`[migración] Base de datos copiada (${(sqlite.length / 1024).toFixed(0)} KB).`);
}

module.exports = { run };
