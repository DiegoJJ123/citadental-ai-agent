// Envío por WhatsApp. Cada clínica envía desde su propio número y por su
// proveedor:
//  - 'ycloud': a través de YCloud (coexistencia con la app WhatsApp Business).
//    Es el proveedor de todas las clínicas nuevas.
//  - 'meta': Cloud API de Meta directa (legado; la demo hasta migrarla).
// Sin clínica se usa el número de la demo del entorno (Meta).
const ycloud = require('./ycloud');

const API_VERSION = 'v21.0';

const usesYCloud = (clinic) => clinic?.whatsapp_provider === 'ycloud';

function credentials(clinic) {
  return {
    phoneNumberId: clinic?.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID,
    token: clinic?.whatsapp_token || process.env.WHATSAPP_TOKEN,
  };
}

async function metaSend(clinic, payload) {
  const { phoneNumberId, token } = credentials(clinic);
  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`Error enviando WhatsApp por Meta (clínica ${clinic?.id ?? 'demo'}):`, res.status, errText);
    const err = new Error(`Meta ${res.status}: ${errText}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

// Devuelve true/false (compatibilidad con los llamantes existentes).
async function sendText(to, body, clinic) {
  try {
    if (usesYCloud(clinic)) {
      await ycloud.sendText(clinic.whatsapp_phone, to, body);
    } else {
      await metaSend(clinic, { to: String(to).replace(/\D/g, ''), type: 'text', text: { body, preview_url: false } });
    }
    return true;
  } catch (err) {
    console.error(`Error enviando mensaje de WhatsApp (clínica ${clinic?.id ?? 'demo'}):`, err.message);
    return false;
  }
}

// Plantilla aprobada (p. ej. recordatorio fuera de la ventana de 24 h).
// Lanza el error para que el llamante lo registre.
async function sendTemplate(to, { name, language, bodyParams }, clinic) {
  if (usesYCloud(clinic)) {
    return ycloud.sendTemplate(clinic.whatsapp_phone, to, { name, language, bodyParams });
  }
  return metaSend(clinic, {
    to: String(to).replace(/\D/g, ''),
    type: 'template',
    template: {
      name,
      language: { code: language },
      components: [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })) }],
    },
  });
}

// Marca el mensaje como leído (en YCloud además muestra "escribiendo…").
async function markAsRead(messageId, clinic) {
  try {
    if (usesYCloud(clinic)) {
      await ycloud.typing(messageId);
    } else {
      await metaSend(clinic, { status: 'read', message_id: messageId });
    }
  } catch (err) {
    console.error('No se pudo marcar como leído:', err.message);
  }
}

module.exports = { sendText, sendTemplate, markAsRead, usesYCloud };
