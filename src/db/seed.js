// Huecos de agenda ficticios de la clínica demo: próximos 14 días laborables,
// 9-14h y 16-19h cada 30 min. Con el disco persistente la BD ya no se borra en
// cada deploy, así que se rellena al arrancar y una vez al día para que la demo
// nunca se quede sin huecos (INSERT OR IGNORE: no toca los huecos existentes).
const db = require('./db');

const TREATMENTS = ['revision', 'limpieza', 'urgencia', 'ortodoncia', 'implante', 'estetica'];

function pad(n) {
  return String(n).padStart(2, '0');
}

function nextDays(n) {
  const days = [];
  const today = new Date();
  for (let i = 1; days.length < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    if (d.getDay() === 0 || d.getDay() === 6) continue; // sin fines de semana
    days.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return days;
}

function timesForDay() {
  const times = [];
  for (let h = 9; h < 14; h++) times.push(`${pad(h)}:00`, `${pad(h)}:30`);
  for (let h = 16; h < 19; h++) times.push(`${pad(h)}:00`, `${pad(h)}:30`);
  return times;
}

function ensureDemoSlots() {
  const insert = db.prepare('INSERT OR IGNORE INTO slots (clinic_id, date, time, treatment) VALUES (?, ?, ?, ?)');
  const days = nextDays(14);
  let added = 0;
  db.transaction(() => {
    for (const date of days) {
      for (const time of timesForDay()) {
        const treatment = TREATMENTS[Math.floor(Math.random() * TREATMENTS.length)];
        added += Number(insert.run(db.DEMO_CLINIC_ID, date, time, treatment).changes);
      }
    }
  })();
  return { added, days: days.length };
}

module.exports = { ensureDemoSlots };

if (require.main === module) {
  const { added, days } = ensureDemoSlots();
  console.log(`Añadidos ${added} huecos nuevos a la agenda demo (${days} días laborables).`);
}
