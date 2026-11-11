const express = require('express');
const whatsapp = require('../services/whatsapp');
const ycloud = require('../services/ycloud');
const { handleIncomingMessage, extractIncomingText, notifyLeadRepliedOnly } = require('../services/agent');
const db = require('../db/db');
const clinics = require('../services/clinics');
const templates = require('../services/templates');

const router = express.Router();

// Mensaje que recibe el paciente si algo falla (p. ej. OpenAI sin saldo o caído):
// nunca debe quedarse sin respuesta.
const FALLBACK_REPLY =
  'Perdona, ahora mismo no puedo responderte. Un compañero del equipo te contestará lo antes posible 🙏';

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

// Lógica común a los dos proveedores. `from` = teléfono del paciente solo con
// dígitos (como se guarda en la BD); `message` con la forma de WhatsApp
// ({ id, type, text: { body }, button, interactive }).
// Un mismo mensaje puede llegar por Meta directo y por YCloud (durante la
// migración de un número a YCloud, o si las dos suscripciones siguen vivas).
// Se procesa solo la primera copia, identificada por el id de WhatsApp (wamid).
function claimMessage(wamid) {
  if (!wamid) return true;
  const r = db.prepare('INSERT OR IGNORE INTO webhook_events (id) VALUES (?)').run(`msg:${wamid}`);
  return Number(r.changes) === 1;
}

// `channel`: proveedor por el que entró el mensaje ('meta' | 'ycloud'); la
// respuesta sale por ese mismo canal.
async function processIncoming({ clinic: clinicRec, from, message, contactName, context, channel, wamid }) {
  let replied = false;
  const clinic = channel ? { ...clinicRec, whatsapp_provider: channel } : clinicRec;
  try {
    if (!clinics.isServing(clinic)) return; // clínica en onboarding o pausada: el bot no responde
    if (!claimMessage(wamid)) return; // ya atendido por la otra vía

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
      await whatsapp.sendText(from, 'Por ahora solo puedo leer mensajes de texto 🙂 ¿Puedes escribirme lo que necesitas?', clinic);
      return;
    }

    await whatsapp.markAsRead(message.id, clinic);

    const reply = await handleIncomingMessage(clinic, from, userText, contactName);
    replied = true; // reply null = conversación pausada (escalada): silencio intencionado
    if (reply) await whatsapp.sendText(from, reply, clinic);
  } catch (err) {
    console.error(`Error procesando mensaje entrante (${context}):`, err);
    logError(clinic?.id, from, context, err);
    if (clinic && from && !replied) {
      whatsapp.sendText(from, FALLBACK_REPLY, clinic).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Meta Cloud API directa (legado: la demo hasta migrarla a YCloud)
// ---------------------------------------------------------------------------

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

// Identifica la clínica por el número de WhatsApp que recibió el mensaje
// (metadata.phone_number_id). Sin metadata se asume la demo, como antes de
// ser multiclínica.
function resolveMetaClinic(value) {
  const phoneNumberId = value?.metadata?.phone_number_id;
  if (!phoneNumberId) return clinics.getDemoClinic();
  return clinics.getClinicByPhoneNumberId(phoneNumberId);
}

router.post('/webhook', async (req, res) => {
  // Responder rápido a Meta; procesar después.
  res.sendStatus(200);

  const value = req.body?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  if (!message) return; // p.ej. eventos de "status" (entregado/leído), los ignoramos

  const from = message.from; // número del paciente, formato E.164 sin '+'
  const clinic = resolveMetaClinic(value);
  if (!clinic) {
    logError(null, from, 'webhook', `Mensaje a un número sin clínica asignada (phone_number_id ${value?.metadata?.phone_number_id})`);
    return;
  }
  await processIncoming({
    clinic,
    from,
    message,
    contactName: value.contacts?.[0]?.profile?.name,
    context: 'webhook',
    channel: 'meta',
    wamid: message.id,
  });
});

// ---------------------------------------------------------------------------
// YCloud
// ---------------------------------------------------------------------------

// Secreto de firma del endpoint de YCloud: variable de entorno o el guardado
// al crear el endpoint desde el onboarding.
function ycloudSecret() {
  if (process.env.YCLOUD_WEBHOOK_SECRET) return process.env.YCLOUD_WEBHOOK_SECRET;
  return db.prepare("SELECT value FROM settings WHERE key = 'ycloud_webhook_secret'").get()?.value || null;
}

// true si el evento ya se había procesado (YCloud reintenta los envíos).
function alreadyProcessed(eventId) {
  if (!eventId) return false;
  const r = db.prepare('INSERT OR IGNORE INTO webhook_events (id) VALUES (?)').run(eventId);
  return Number(r.changes) === 0;
}

const digits = (p) => String(p || '').replace(/\D/g, '');

router.post('/webhook/ycloud', async (req, res) => {
  const secret = ycloudSecret();
  if (!secret || !ycloud.verifySignature(req.get('YCloud-Signature'), req.rawBody, secret)) {
    logError(null, null, 'webhook:ycloud', 'Firma de YCloud inválida o sin secreto configurado');
    return res.sendStatus(401);
  }
  const event = req.body || {};
  if (alreadyProcessed(event.id)) return res.sendStatus(204);
  res.sendStatus(204);

  try {
    switch (event.type) {
      case 'whatsapp.inbound_message.received': {
        const m = event.whatsappInboundMessage || {};
        const from = digits(m.from);
        const clinic = clinics.getClinicByWhatsappPhone(m.to);
        if (!clinic) {
          logError(null, from, 'webhook:ycloud', `Mensaje a un número sin clínica asignada (${m.to})`);
          return;
        }
        // Mismo formato que Meta para reutilizar la lógica (id del mensaje de YCloud para "leído").
        const message = { ...m, id: m.id || m.wamid };
        await processIncoming({
          clinic,
          from,
          message,
          contactName: m.customerProfile?.name,
          context: 'webhook:ycloud',
          channel: 'ycloud',
          wamid: m.wamid,
        });
        return;
      }
      case 'whatsapp.smb.message.echoes': {
        // Recepción ha escrito al paciente desde la app de WhatsApp Business:
        // una persona ha tomado la conversación, así que el asistente se calla
        // en ese chat para no pisarla (se reactiva desde el panel).
        const m = event.whatsappMessage || {};
        const clinic = clinics.getClinicByWhatsappPhone(m.from);
        const patient = digits(m.to);
        if (clinic && patient) {
          db.prepare(
            `INSERT INTO conversations (clinic_id, phone, history, escalated) VALUES (?, ?, '[]', 1)
             ON CONFLICT(clinic_id, phone) DO UPDATE SET escalated = 1, updated_at = CURRENT_TIMESTAMP`
          ).run(clinic.id, patient);
        }
        return;
      }
      case 'whatsapp.template.reviewed': {
        const t = event.whatsappTemplate || {};
        templates.recordReview({ wabaId: t.wabaId, name: t.name, language: t.language, status: t.status || t.statusUpdateEvent, reason: t.reason });
        return;
      }
      default:
        return; // otros eventos (estados de entrega, etc.): no se usan
    }
  } catch (err) {
    console.error('Error procesando evento de YCloud:', err);
    logError(null, null, `webhook:ycloud:${event.type}`, err);
  }
});

module.exports = router;
module.exports.processIncoming = processIncoming;
