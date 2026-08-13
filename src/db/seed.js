// Genera huecos de agenda ficticios para los próximos 14 días (L-V, 9-14h y 16-19h, cada 30 min)
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
  for (let h = 9; h < 14; h++) {
    times.push(`${pad(h)}:00`);
    times.push(`${pad(h)}:30`);
  }
  for (let h = 16; h < 19; h++) {
    times.push(`${pad(h)}:00`);
    times.push(`${pad(h)}:30`);
  }
  return times;
}

const insert = db.prepare(
  'INSERT OR IGNORE INTO slots (date, time, treatment) VALUES (?, ?, ?)'
);

const days = nextDays(14);
let count = 0;
for (const date of days) {
  for (const time of timesForDay()) {
    const treatment = TREATMENTS[Math.floor(Math.random() * TREATMENTS.length)];
    insert.run(date, time, treatment);
    count++;
  }
}

console.log(`Sembrados ${count} huecos de agenda en ${days.length} días laborables.`);
