// Envío de emails (alertas y copias de seguridad) desde el buzón de
// CitaDental AI en Hostinger. Solo hace falta SMTP_PASS en Render; el resto
// tiene valores por defecto.
const nodemailer = require('nodemailer');

const CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || 'hola@citadentalai.site',
  pass: process.env.SMTP_PASS || '',
  to: process.env.ALERT_EMAIL || process.env.ALLOWED_DASHBOARD_EMAIL || 'diegoezequiel02@gmail.com',
};

let transport = null;

const isConfigured = () => Boolean(CONFIG.pass);

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: CONFIG.host,
      port: CONFIG.port,
      secure: CONFIG.port === 465,
      auth: { user: CONFIG.user, pass: CONFIG.pass },
    });
  }
  return transport;
}

// Devuelve true si se envió. Nunca lanza: un fallo de email no debe tumbar nada.
async function send({ subject, text, html, attachments }) {
  if (!isConfigured()) {
    console.warn(`[email sin configurar] ${subject}`);
    return false;
  }
  try {
    await getTransport().sendMail({
      from: `"CitaDental AI" <${CONFIG.user}>`,
      to: CONFIG.to,
      subject,
      text,
      html,
      attachments,
    });
    return true;
  } catch (err) {
    console.error('Error enviando email:', err.message);
    return false;
  }
}

module.exports = { send, isConfigured, recipient: () => CONFIG.to, sender: () => CONFIG.user };
