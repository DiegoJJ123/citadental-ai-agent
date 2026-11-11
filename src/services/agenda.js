// Motor de agenda. Para la demo usa los huecos ficticios de la BD (clinic.js).
// Para una clínica real con Google Calendar conectado, los huecos libres se
// calculan en vivo: horario de la clínica − eventos de su calendario. Reservar
// crea un evento en su calendario; cancelar lo borra.
const db = require('../db/db');
const local = require('./clinic');
const gcal = require('./googleCalendar');
const { DEFAULT_TZ, zonedToDate, dateToZoned, addDays, weekdayOf, todayIn } = require('./tz');

const DEFAULT_TREATMENTS = [
  { key: 'revision', nombre: 'Revisión', duracion: 30 },
  { key: 'limpieza', nombre: 'Limpieza dental', duracion: 45 },
  { key: 'urgencia', nombre: 'Urgencia', duracion: 30 },
  { key: 'ortodoncia', nombre: 'Primera visita de ortodoncia', duracion: 30 },
  { key: 'implante', nombre: 'Primera visita de implantes', duracion: 45 },
  { key: 'estetica', nombre: 'Primera visita de estética dental', duracion: 30 },
];

const DEFAULT_SCHEDULE = {
  timezone: DEFAULT_TZ,
  slot_step_min: 30,
  min_notice_hours: 2,
  horizon_days: 21,
  // 0 = domingo … 6 = sábado. Tramos [inicio, fin) en hora local.
  hours: {
    0: [],
    1: [['09:00', '14:00'], ['16:00', '20:00']],
    2: [['09:00', '14:00'], ['16:00', '20:00']],
    3: [['09:00', '14:00'], ['16:00', '20:00']],
    4: [['09:00', '14:00'], ['16:00', '20:00']],
    5: [['09:00', '14:00']],
    6: [],
  },
  treatments: DEFAULT_TREATMENTS,
};

function scheduleOf(clinic) {
  const s = clinic.schedule || {};
  return {
    ...DEFAULT_SCHEDULE,
    ...s,
    hours: s.hours && Object.keys(s.hours).length ? s.hours : DEFAULT_SCHEDULE.hours,
    treatments: Array.isArray(s.treatments) && s.treatments.length ? s.treatments : DEFAULT_TREATMENTS,
  };
}

function treatmentsOf(clinic) {
  return clinic.isDemo ? DEFAULT_TREATMENTS : scheduleOf(clinic).treatments;
}

// Gesden / Clinic Cloud también usan, de momento, un Google Calendar dedicado.
function usesGoogle(clinic) {
  return !clinic.isDemo && Boolean(clinic.google_refresh_token);
}

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function findTreatment(clinic, key) {
  const list = treatmentsOf(clinic);
  return list.find((t) => t.key === key) || null;
}

const overlaps = (aStart, aEnd, busy) => busy.some((b) => aStart < b.end && b.start < aEnd);

// Huecos libres calculados (sin guardar): [{ date, time, start, end }]
async function computeFreeSlots(clinic, { date, treatmentKey, limit = 8, now = new Date() }) {
  const sch = scheduleOf(clinic);
  const tz = sch.timezone || DEFAULT_TZ;
  const treatment = findTreatment(clinic, treatmentKey) || sch.treatments[0];
  const duration = Number(treatment?.duracion) || 30;
  const step = Number(sch.slot_step_min) || 30;
  const earliest = now.getTime() + (Number(sch.min_notice_hours) || 0) * 3600 * 1000;

  const today = todayIn(tz);
  const lastDay = addDays(today, Number(sch.horizon_days) || 21);
  const firstDay = date && date >= today ? date : today;
  const endDay = date ? date : lastDay;
  if (firstDay > lastDay || firstDay > endDay) return [];

  const from = zonedToDate(firstDay, '00:00', tz);
  const to = zonedToDate(addDays(endDay, 1), '00:00', tz);
  const busy = await gcal.listBusy(clinic, from, to, tz);

  const out = [];
  const perDayMax = date ? limit : 3; // sin fecha concreta, repartir entre varios días
  for (let day = firstDay; day <= endDay && out.length < limit; day = addDays(day, 1)) {
    const ranges = sch.hours[weekdayOf(day)] || sch.hours[String(weekdayOf(day))] || [];
    let inDay = 0;
    for (const [open, close] of ranges) {
      for (let m = toMin(open); m + duration <= toMin(close); m += step) {
        const start = zonedToDate(day, toHHMM(m), tz).getTime();
        const end = start + duration * 60000;
        if (start < earliest || overlaps(start, end, busy)) continue;
        out.push({ date: day, time: toHHMM(m), start, end, duration, treatment: treatment.key });
        inDay++;
        if (inDay >= perDayMax || out.length >= limit) break;
      }
      if (inDay >= perDayMax || out.length >= limit) break;
    }
  }
  return out;
}

// Guarda los huecos ofrecidos en `slots` para que tengan id (la IA reserva por id).
function upsertOfferedSlots(clinicId, free) {
  const up = db.prepare(
    `INSERT INTO slots (clinic_id, date, time, treatment, duration_min, is_booked) VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(clinic_id, date, time) DO UPDATE SET treatment = excluded.treatment, duration_min = excluded.duration_min
     WHERE slots.is_booked = 0`
  );
  const get = db.prepare('SELECT * FROM slots WHERE clinic_id = ? AND date = ? AND time = ?');
  return free
    .map((f) => {
      up.run(clinicId, f.date, f.time, f.treatment, f.duration);
      return get.get(clinicId, f.date, f.time);
    })
    .filter((s) => s && !s.is_booked);
}

async function listAvailable(clinic, { date, treatment, limit = 8 }) {
  if (!usesGoogle(clinic)) return local.listAvailableSlots(clinic.id, { date, treatment, limit });
  const free = await computeFreeSlots(clinic, { date, treatmentKey: treatment, limit });
  return upsertOfferedSlots(clinic.id, free);
}

function slotTimes(clinic, slot) {
  const tz = scheduleOf(clinic).timezone || DEFAULT_TZ;
  const start = zonedToDate(slot.date, slot.time, tz);
  const end = new Date(start.getTime() + (slot.duration_min || 30) * 60000);
  const endLocal = dateToZoned(end, tz);
  return {
    tz,
    start,
    end,
    startLocal: `${slot.date}T${slot.time}:00`,
    endLocal: `${endLocal.date}T${endLocal.time}:00`,
  };
}

async function book(clinic, { phone, name, slotId, isTest = false }) {
  if (!usesGoogle(clinic)) return local.bookAppointment(clinic.id, { phone, name, slotId });

  const slot = db.prepare('SELECT * FROM slots WHERE id = ? AND clinic_id = ?').get(slotId, clinic.id);
  if (!slot) return { ok: false, error: 'Ese hueco ya no existe. Consulta la disponibilidad de nuevo.' };
  if (slot.is_booked) return { ok: false, error: 'Ese hueco ya no está disponible.' };

  const t = slotTimes(clinic, slot);
  if (t.start.getTime() < Date.now()) return { ok: false, error: 'Ese hueco ya ha pasado.' };

  // Volver a mirar el calendario justo antes de reservar: recepción puede haber
  // metido una cita a mano desde que se ofreció el hueco.
  const busy = await gcal.listBusy(clinic, t.start, t.end, t.tz);
  if (overlaps(t.start.getTime(), t.end.getTime(), busy)) {
    return { ok: false, error: 'Ese hueco se acaba de ocupar. Consulta la disponibilidad de nuevo.' };
  }

  const patient = local.getOrCreatePatient(clinic.id, phone, name);
  const treatment = findTreatment(clinic, slot.treatment);
  const patientName = name || patient.name || 'Paciente';
  const eventId = await gcal.createEvent(clinic, {
    summary: `${isTest ? '[PRUEBA] ' : ''}🦷 ${treatment?.nombre || slot.treatment} — ${patientName}`,
    description: [
      `Paciente: ${patientName}`,
      `WhatsApp: +${phone}`,
      `Tratamiento: ${treatment?.nombre || slot.treatment}`,
      '',
      isTest ? 'CITA DE PRUEBA creada desde el onboarding de CitaDental AI.' : 'Reservada por WhatsApp con el asistente de CitaDental AI.',
    ].join('\n'),
    start: t.startLocal,
    end: t.endLocal,
    tz: t.tz,
  });

  try {
    const appointmentId = db.transaction(() => {
      db.prepare('UPDATE slots SET is_booked = 1 WHERE id = ?').run(slot.id);
      return db
        .prepare(
          "INSERT INTO appointments (clinic_id, patient_id, slot_id, status, google_event_id, is_test) VALUES (?, ?, ?, 'confirmada', ?, ?)"
        )
        .run(clinic.id, patient.id, slot.id, eventId, isTest ? 1 : 0).lastInsertRowid;
    })();
    return { ok: true, appointmentId, slot };
  } catch (err) {
    await gcal.deleteEvent(clinic, eventId).catch(() => {});
    throw err;
  }
}

function upcomingRow(clinic, phone) {
  return db
    .prepare(
      `SELECT a.id AS appointment_id, a.google_event_id, s.* FROM appointments a
       JOIN slots s ON s.id = a.slot_id
       JOIN patients p ON p.id = a.patient_id
       WHERE a.clinic_id = ? AND p.phone = ? AND a.status = 'confirmada' AND s.date >= ?
       ORDER BY s.date ASC, s.time ASC LIMIT 1`
    )
    .get(clinic.id, phone, todayIn(scheduleOf(clinic).timezone));
}

function upcoming(clinic, phone) {
  if (!usesGoogle(clinic)) return local.getUpcomingAppointment(clinic.id, phone);
  return upcomingRow(clinic, phone) || null;
}

async function cancelAppointmentRow(clinic, appt) {
  await gcal.deleteEvent(clinic, appt.google_event_id);
  db.transaction(() => {
    db.prepare("UPDATE appointments SET status = 'cancelada' WHERE id = ?").run(appt.appointment_id);
    db.prepare('UPDATE slots SET is_booked = 0 WHERE id = ?').run(appt.id);
  })();
}

async function cancel(clinic, phone) {
  if (!usesGoogle(clinic)) return local.cancelAppointment(clinic.id, phone);
  const appt = upcomingRow(clinic, phone);
  if (!appt) return { ok: false, error: 'No encuentro ninguna cita activa para este número.' };
  await cancelAppointmentRow(clinic, appt);
  return { ok: true, freedSlot: appt };
}

async function reschedule(clinic, { phone, newSlotId }) {
  if (!usesGoogle(clinic)) return local.rescheduleAppointment(clinic.id, { phone, newSlotId });
  const old = upcomingRow(clinic, phone);
  if (!old) return { ok: false, error: 'No encuentro ninguna cita activa para este número.' };
  // Primero se reserva la nueva; solo si sale bien se cancela la antigua.
  const isTest = Boolean(db.prepare('SELECT is_test FROM appointments WHERE id = ?').get(old.appointment_id)?.is_test);
  const r = await book(clinic, { phone, slotId: newSlotId, isTest });
  if (!r.ok) return r;
  await cancelAppointmentRow(clinic, old);
  return r;
}

// Cancela las citas de prueba del onboarding (y borra sus eventos).
async function cancelTestAppointments(clinic) {
  const rows = db
    .prepare(
      `SELECT a.id AS appointment_id, a.google_event_id, s.* FROM appointments a JOIN slots s ON s.id = a.slot_id
       WHERE a.clinic_id = ? AND a.is_test = 1 AND a.status = 'confirmada'`
    )
    .all(clinic.id);
  for (const appt of rows) {
    if (appt.google_event_id && clinic.google_refresh_token) await cancelAppointmentRow(clinic, appt);
    else {
      db.prepare("UPDATE appointments SET status = 'cancelada' WHERE id = ?").run(appt.appointment_id);
      db.prepare('UPDATE slots SET is_booked = 0 WHERE id = ?').run(appt.id);
    }
  }
  return rows.length;
}

module.exports = {
  DEFAULT_SCHEDULE,
  DEFAULT_TREATMENTS,
  scheduleOf,
  treatmentsOf,
  findTreatment,
  usesGoogle,
  computeFreeSlots,
  listAvailable,
  book,
  upcoming,
  cancel,
  reschedule,
  cancelTestAppointments,
};
