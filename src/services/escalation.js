// Aviso por email a la recepción cuando el asistente pasa un chat a una
// persona (herramienta escalar_a_humano). Complementa al aviso por WhatsApp,
// que solo llega si la recepción escribió al número de la clínica en las
// últimas 24 h (norma de WhatsApp); el email llega siempre.
const db = require('../db/db');
const mailer = require('./mailer');
const business = require('./business');

const BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://dashboard.citadentalai.site').replace(/\/+$/, '');
const authorLabel = (t, a) => ({ patient: t.customer[0].toUpperCase() + t.customer.slice(1), bot: 'Asistente', human: 'Recepción' })[a] || a;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (sqlite) =>
  new Date(String(sqlite).replace(' ', 'T') + 'Z').toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function chatLink(clinic, phone) {
  return clinic.panel_token ? `${BASE_URL}/panel/${clinic.panel_token}/chat/${phone}` : null;
}

async function emailReception(clinic, phone, motivo) {
  if (!clinic?.reception_email) return false;
  const t = business.typeOf(clinic);
  const Cust = t.customer[0].toUpperCase() + t.customer.slice(1);
  const patient = db.prepare('SELECT name FROM patients WHERE clinic_id = ? AND phone = ?').get(clinic.id, phone);
  const lead = db.prepare('SELECT email FROM leads WHERE clinic_id = ? AND phone = ?').get(clinic.id, phone);
  const recent = db
    .prepare("SELECT author, body, created_at FROM messages WHERE clinic_id = ? AND phone = ? AND author != 'system' ORDER BY id DESC LIMIT 8")
    .all(clinic.id, phone)
    .reverse();
  const who = patient?.name ? `${patient.name} (+${phone})` : `+${phone}`;
  const link = chatLink(clinic, phone);
  const clinicName = clinic.info?.nombre || clinic.name;

  const text = [
    `Un ${t.customer} necesita que le atienda una persona.`,
    ``,
    `${Cust}: ${who}`,
    lead?.email ? `Email: ${lead.email}` : null,
    `Motivo: ${motivo || '—'}`,
    `El asistente ha dejado de responder en este chat hasta que lo reactivéis.`,
    ``,
    `Últimos mensajes:`,
    ...recent.map((m) => `[${fmt(m.created_at)}] ${authorLabel(t, m.author)}: ${m.body}`),
    ``,
    link ? `Responder desde el panel: ${link}` : `Respondedle desde el WhatsApp de ${t.placeThe} o desde vuestro panel de conversaciones.`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  const bubbles = recent
    .map((m) => {
      const mine = m.author !== 'patient';
      const bg = m.author === 'bot' ? '#DCE9FD' : m.author === 'human' ? '#D9FDD3' : '#FFFFFF';
      return `<tr><td align="${mine ? 'right' : 'left'}" style="padding:3px 0">
        <div style="display:inline-block;max-width:80%;text-align:left;background:${bg};border:1px solid #E3E8EF;border-radius:12px;padding:8px 12px;font-size:14px;color:#17324D">
          ${esc(m.body).replace(/\n/g, '<br>')}
          <div style="font-size:11px;color:#5B6B7A;margin-top:3px">${esc(authorLabel(t, m.author))} · ${esc(fmt(m.created_at))}</div>
        </div></td></tr>`;
    })
    .join('');

  const html = `<div style="font-family:Inter,Arial,sans-serif;background:#F4F6F8;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E3E8EF;border-radius:16px;padding:24px">
      <div style="font-size:18px;font-weight:700;color:#17324D">🙋 Un ${esc(t.customer)} necesita atención</div>
      <p style="color:#5B6B7A;font-size:14px;margin:6px 0 16px">El asistente de ${esc(clinicName)} ha pasado este chat a una persona y ha dejado de responder en él.</p>
      <table style="font-size:14px;color:#17324D;margin-bottom:14px">
        <tr><td style="color:#5B6B7A;padding-right:12px">${esc(Cust)}</td><td><strong>${esc(who)}</strong></td></tr>
        ${lead?.email ? `<tr><td style="color:#5B6B7A;padding-right:12px">Email</td><td>${esc(lead.email)}</td></tr>` : ''}
        <tr><td style="color:#5B6B7A;padding-right:12px">Motivo</td><td>${esc(motivo || '—')}</td></tr>
      </table>
      <div style="background:#EFEAE2;border-radius:12px;padding:12px"><table width="100%" cellspacing="0" cellpadding="0">${bubbles}</table></div>
      ${
        link
          ? `<p style="text-align:center;margin:20px 0 4px"><a href="${esc(link)}" style="background:#1F4EA8;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px;display:inline-block">Abrir el chat y responder</a></p>`
          : `<p style="font-size:14px;color:#17324D">Respondedle desde el WhatsApp de ${esc(t.placeThe)}.</p>`
      }
      <p style="font-size:12px;color:#5B6B7A;margin-top:18px">CitaDental AI · Este aviso contiene datos de un ${esc(t.customer)}: no lo reenviéis fuera de ${esc(t.placeThe)}.</p>
    </div></div>`;

  return mailer.send({ to: clinic.reception_email, subject: `🙋 ${clinicName}: un ${t.customer} necesita atención (${who})`, text, html });
}

async function notifyRequest(clinic, phone, nombre, detalle) {
  const t = business.typeOf(clinic);
  const clinicName = clinic.info?.nombre || clinic.name;
  const patient = db.prepare('SELECT name FROM patients WHERE clinic_id = ? AND phone = ?').get(clinic.id, phone);
  const who = nombre || patient?.name ? `${nombre || patient.name} (+${phone})` : `+${phone}`;
  const link = chatLink(clinic, phone);
  const sent = [];
  if (clinic.reception_phone) {
    const text = `📅 Nueva solicitud de ${t.booking} por WhatsApp\n${who}\n${detalle}\n\nApuntadla en vuestro sistema y confirmadle al ${t.customer}.${link ? `\nChat: ${link}` : ''}`;
    sent.push(require('./whatsapp').sendText(clinic.reception_phone, text, clinic).catch(() => false));
  }
  if (clinic.reception_email) {
    const html = `<div style="font-family:Inter,Arial,sans-serif;background:#F4F6F8;padding:24px">
      <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E3E8EF;border-radius:16px;padding:24px">
        <div style="font-size:18px;font-weight:700;color:#17324D">📅 Nueva solicitud de ${esc(t.booking)}</div>
        <p style="color:#5B6B7A;font-size:14px;margin:6px 0 16px">Ha llegado por WhatsApp a ${esc(clinicName)}. <strong>No está confirmada:</strong> apuntadla en vuestro sistema y confirmadle al ${esc(t.customer)}.</p>
        <table style="font-size:14px;color:#17324D;margin-bottom:14px">
          <tr><td style="color:#5B6B7A;padding-right:12px">${esc(t.customer[0].toUpperCase() + t.customer.slice(1))}</td><td><strong>${esc(who)}</strong></td></tr>
          <tr><td style="color:#5B6B7A;padding-right:12px;vertical-align:top">Solicitud</td><td>${esc(detalle).replace(/\n/g, '<br>')}</td></tr>
        </table>
        ${link ? `<p style="text-align:center;margin:20px 0 4px"><a href="${esc(link)}" style="background:#1F4EA8;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px;display:inline-block">Abrir el chat y confirmar</a></p>` : ''}
      </div></div>`;
    sent.push(
      mailer.send({
        to: clinic.reception_email,
        subject: `📅 ${clinicName}: nueva solicitud de ${t.booking} (${who})`,
        text: `Nueva solicitud de ${t.booking} por WhatsApp (no confirmada).\n\n${who}\n${detalle}\n${link ? `\nChat: ${link}` : ''}`,
        html,
      })
    );
  }
  return Promise.all(sent);
}

module.exports = { emailReception, notifyRequest, chatLink };
