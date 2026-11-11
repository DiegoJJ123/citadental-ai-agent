const express = require('express');
const whatsapp = require('../services/whatsapp');
const { handleIncomingMessage, extractIncomingText, notifyLeadRepliedOnly } = require('../services/agent');
const db = require('../db/db');
const clinics = require('../services/clinics');

const router = express.Router();

// Verificación del webhook (Meta hace un GET al configurar la suscripción)
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Mensaje que recibe el paciente si algo falla (p. ej. OpenAI sin saldo o caído):
// nunca debe quedarse sin respuesta.
const FALLBACK_REPLY =
  'Perdona, ahora mismo no puedo responderte. Un compañero del equipo te contestará lo antes posible 🙏';

// Identifica la clínica por el número de WhatsApp que recibió el mensaje
// (metadata.phone_number_id). Sin metadata se asume la demo, como antes de
// ser multiclínica.
function resolveClinic(value) {
  const phoneNumberId = value?.metadata?.phone_number_id;
  if (!phoneNumberId) return clinics.getDemoClinic();
  return clinics.getClinicByPhoneNumberId(phoneNumberId);
}

function logError(clinicId, phone, context, err) {
  try {
    db.prepare('INSERT INTO error_log (clinic_id, phone, context, message) VALUES (?, ?, ?, ?)').run(
      clinicId ?? null,
      phone || null,
      context,
      String(err?.message || err)
    );
  } catch (logErr) {
    console.error('Error guardando en error_log:', logErr);
  }
}

// Recepción de mensajes entrantes
router.post('/webhook', async (req, res) => {
  // Responder rápido a Meta; procesar después.
  res.sendStatus(200);

  let from;
  let clinic;
  let replied = false;
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return; // p.ej. eventos de "status" (entregado/leído), los ignoramos

    from = message.from; // número del paciente, formato E.164 sin '+'
    const contactName = value.contacts?.[0]?.profile?.name;

    clinic = resolveClinic(value);
    if (!clinic) {
      logError(null, from, 'webhook', `Mensaje a un número sin clínica asignada (phone_number_id ${value?.metadata?.phone_number_id})`);
      return;
    }
    if (!clinics.isServing(clinic)) return; // clínica en onboarding o pausada: el bot no responde

    db.prepare('INSERT INTO message_log (clinic_id, phone) VALUES (?, ?)').run(clinic.id, from);

    // Algunos mensajes no llegan como type 'text' pero SÍ traen texto legible
    // (respuestas de botón/lista de WhatsApp, p. ej. si la clínica tiene su
    // propio bot de gestión de turnos contestando por botones). Los tratamos
    // como texto normal en vez de descartarlos con el fallback genérico.
    const userText = extractIncomingText(message);

    if (userText === null) {
      // Tipo sin texto legible (imagen, audio, ubicación, sticker...). Sigue
      // siendo una respuesta real del lead — se refleja en el CRM aunque el
      // bot no pueda procesar el contenido con el LLM.
      if (clinic.isDemo) notifyLeadRepliedOnly(from, `[mensaje tipo ${message.type}]`);
      replied = true;
      await whatsapp.sendText(
        from,
        'Por ahora solo puedo leer mensajes de texto 🙂 ¿Puedes escribirme lo que necesitas?',
        clinic
      );
      return;
    }

    await whatsapp.markAsRead(message.id, clinic);

    const reply = await handleIncomingMessage(clinic, from, userText, contactName);

    if (reply) {
      replied = true;
      await whatsapp.sendText(from, reply, clinic);
    } else {
      replied = true; // conversación pausada (escalada): silencio intencionado
    }
  } catch (err) {
    console.error('Error procesando webhook de WhatsApp:', err);
    logError(clinic?.id, from, 'webhook', err);
    if (clinic && from && !replied) {
      whatsapp.sendText(from, FALLBACK_REPLY, clinic).catch(() => {});
    }
  }
});

module.exports = router;
