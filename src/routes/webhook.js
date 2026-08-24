const express = require('express');
const whatsapp = require('../services/whatsapp');
const { handleIncomingMessage, extractIncomingText, notifyLeadRepliedOnly } = require('../services/agent');
const db = require('../db/db');

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

// Recepción de mensajes entrantes
router.post('/webhook', async (req, res) => {
  // Responder rápido a Meta; procesar después.
  res.sendStatus(200);

  let from;
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return; // p.ej. eventos de "status" (entregado/leído), los ignoramos

    from = message.from; // número del paciente, formato E.164 sin '+'
    const contactName = value.contacts?.[0]?.profile?.name;

    db.prepare('INSERT INTO message_log (phone) VALUES (?)').run(from);

    // Algunos mensajes no llegan como type 'text' pero SÍ traen texto legible
    // (respuestas de botón/lista de WhatsApp, p. ej. si la clínica tiene su
    // propio bot de gestión de turnos contestando por botones). Los tratamos
    // como texto normal en vez de descartarlos con el fallback genérico.
    const userText = extractIncomingText(message);

    if (userText === null) {
      // Tipo sin texto legible (imagen, audio, ubicación, sticker...). Sigue
      // siendo una respuesta real del lead — se refleja en el CRM aunque el
      // bot no pueda procesar el contenido con el LLM.
      notifyLeadRepliedOnly(from, `[mensaje tipo ${message.type}]`);
      await whatsapp.sendText(
        from,
        'Por ahora solo puedo leer mensajes de texto 🙂 ¿Puedes escribirme lo que necesitas?'
      );
      return;
    }

    await whatsapp.markAsRead(message.id);

    const reply = await handleIncomingMessage(from, userText, contactName);

    if (reply) {
      await whatsapp.sendText(from, reply);
    }
  } catch (err) {
    console.error('Error procesando webhook de WhatsApp:', err);
    try {
      db.prepare('INSERT INTO error_log (phone, context, message) VALUES (?, ?, ?)').run(
        from || null,
        'webhook',
        String(err.message || err)
      );
    } catch (logErr) {
      console.error('Error guardando en error_log:', logErr);
    }
  }
});

module.exports = router;
