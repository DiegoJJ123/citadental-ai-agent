// Exportación legible de la base de datos a una hoja de cálculo (.xlsx, que
// Google Sheets importa directamente). Una pestaña por tema, columnas en
// español, fechas en hora de Madrid y SIN datos técnicos sensibles (permisos
// de Google, tokens, secretos, enlaces privados del panel).
const ExcelJS = require('exceljs');
const db = require('../db/db');

const TZ = 'Europe/Madrid';
const fmtTs = (sqlite) => {
  if (!sqlite) return '';
  const d = new Date(String(sqlite).replace(' ', 'T') + (String(sqlite).includes('Z') || String(sqlite).includes('+') ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? String(sqlite) : d.toLocaleString('es-ES', { timeZone: TZ });
};
const parse = (t) => {
  try {
    return JSON.parse(t || '{}');
  } catch {
    return {};
  }
};
const AUTHOR = { patient: 'Paciente', bot: 'Asistente', human: 'Recepción', system: 'Sistema' };

function sheets() {
  const clinicName = new Map(db.prepare('SELECT id, name FROM clinics').all().map((c) => [c.id, c.name]));
  const cname = (id) => clinicName.get(id) || (id == null ? '' : `#${id}`);

  const clinics = db.prepare('SELECT * FROM clinics ORDER BY id').all().map((c) => {
    const info = parse(c.info_json);
    let hours = '';
    try {
      hours = (JSON.parse(c.reminder_hours || 'null') || [48, 24]).map((h) => `${h} h`).join(', ');
    } catch {
      hours = '48 h, 24 h';
    }
    return {
      ID: c.id,
      Clínica: c.name,
      Tipo: c.mode === 'demo' ? 'Demo' : 'Clínica',
      Estado: c.status,
      Web: c.website || '',
      Dirección: info.direccion || '',
      Horario: info.horario || '',
      Teléfono: info.telefono || '',
      'WhatsApp del asistente': c.whatsapp_display_phone || c.whatsapp_phone || '',
      'WhatsApp recepción': c.reception_phone || '',
      'Email recepción': c.reception_email || '',
      Agenda: c.calendar_provider || '',
      'Google Calendar conectado': c.google_refresh_token ? 'Sí' : 'No',
      'Recordatorios (antes de la cita)': hours,
      'Plantilla recordatorio': c.reminder_template_name ? `${c.reminder_template_name} (${c.reminder_template_status || 'sin estado'})` : 'Sin enviar',
      'Texto recordatorio': c.reminder_template_text || '',
      'Panel recepción creado': c.panel_token ? 'Sí' : 'No',
      Alta: fmtTs(c.created_at),
    };
  });

  const patients = db.prepare('SELECT * FROM patients ORDER BY clinic_id, id').all().map((p) => ({
    Clínica: cname(p.clinic_id),
    Nombre: p.name || '',
    Teléfono: `+${String(p.phone).replace(/^\+/, '')}`,
    'Primer contacto': fmtTs(p.created_at),
  }));

  const appointments = db
    .prepare(
      `SELECT a.*, s.date, s.time, s.treatment, s.duration_min, p.name AS patient_name, p.phone AS patient_phone,
              (SELECT GROUP_CONCAT(hours || ' h', ', ') FROM reminders_sent r WHERE r.appointment_id = a.id) AS reminders
       FROM appointments a LEFT JOIN slots s ON s.id = a.slot_id LEFT JOIN patients p ON p.id = a.patient_id
       ORDER BY s.date DESC, s.time DESC`
    )
    .all()
    .map((a) => ({
      Clínica: cname(a.clinic_id),
      Fecha: a.date || '',
      Hora: a.time || '',
      Tratamiento: a.treatment || '',
      'Duración (min)': a.duration_min || '',
      Paciente: a.patient_name || '',
      Teléfono: a.patient_phone ? `+${String(a.patient_phone).replace(/^\+/, '')}` : '',
      Estado: a.status,
      Prueba: a.is_test ? 'Sí' : 'No',
      'Recordatorios enviados': a.reminders || [a.reminder_48h_sent ? '48 h' : '', a.reminder_24h_sent ? '24 h' : ''].filter(Boolean).join(', '),
      'Reservada el': fmtTs(a.created_at),
    }));

  const messages = db
    .prepare("SELECT * FROM messages WHERE phone NOT LIKE 'prueba-%' ORDER BY clinic_id, phone, id")
    .all()
    .map((m) => ({
      Clínica: cname(m.clinic_id),
      Teléfono: `+${String(m.phone).replace(/^\+/, '')}`,
      Cuándo: fmtTs(m.created_at),
      Quién: AUTHOR[m.author] || m.author,
      Mensaje: m.body,
    }));

  const chats = db
    .prepare(
      `SELECT clinic_id, phone, COUNT(*) n, MIN(created_at) first, MAX(created_at) last,
              SUM(direction = 'in') ins, SUM(author = 'bot') bots, SUM(author = 'human') humans
       FROM messages WHERE phone NOT LIKE 'prueba-%' GROUP BY clinic_id, phone ORDER BY last DESC`
    )
    .all()
    .map((c) => {
      const conv = db.prepare('SELECT escalated FROM conversations WHERE clinic_id = ? AND phone = ?').get(c.clinic_id, c.phone);
      const p = db.prepare('SELECT name FROM patients WHERE clinic_id = ? AND phone = ?').get(c.clinic_id, c.phone);
      return {
        Clínica: cname(c.clinic_id),
        Paciente: p?.name || '',
        Teléfono: `+${String(c.phone).replace(/^\+/, '')}`,
        Mensajes: c.n,
        'Del paciente': c.ins,
        'Del asistente': c.bots,
        'De recepción': c.humans,
        'Asistente pausado': conv?.escalated ? 'Sí' : 'No',
        'Primer mensaje': fmtTs(c.first),
        'Último mensaje': fmtTs(c.last),
      };
    });

  const leads = db.prepare('SELECT * FROM demo_leads ORDER BY id DESC').all().map((l) => ({
    Nombre: l.nombre || '',
    Email: l.email || '',
    'Teléfono contacto': l.telefono_contacto || '',
    WhatsApp: l.phone ? `+${String(l.phone).replace(/^\+/, '')}` : '',
    Notas: l.notas || '',
    'Demo agendada': l.fecha_hora_iso || '',
    Cuándo: fmtTs(l.created_at),
  }));

  const errors = db
    .prepare("SELECT * FROM error_log WHERE created_at >= datetime('now','-30 days') ORDER BY id DESC")
    .all()
    .map((e) => ({ Clínica: cname(e.clinic_id), Cuándo: fmtTs(e.created_at), Dónde: e.context, Teléfono: e.phone || '', Error: e.message }));

  return [
    ['Clínicas', clinics],
    ['Citas', appointments],
    ['Pacientes', patients],
    ['Chats', chats],
    ['Mensajes', messages],
    ['Leads demo', leads],
    ['Errores (30 días)', errors],
  ];
}

async function buildWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CitaDental AI';
  wb.created = new Date();
  for (const [name, rows] of sheets()) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = rows.length ? Object.keys(rows[0]) : ['(sin datos)'];
    ws.columns = cols.map((k) => ({
      header: k,
      key: k,
      width: Math.min(60, Math.max(12, k.length + 2, ...rows.slice(0, 200).map((r) => String(r[k] ?? '').length + 2))),
    }));
    rows.forEach((r) => ws.addRow(r));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4EA8' } };
    if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    ws.eachRow((row, i) => {
      if (i > 1) row.alignment = { vertical: 'top', wrapText: true };
    });
  }
  return wb.xlsx.writeBuffer();
}

module.exports = { buildWorkbook, sheets };
