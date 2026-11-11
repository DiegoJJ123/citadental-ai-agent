// Envío por WhatsApp Cloud API. Cada clínica envía desde su propio número
// (clinic.whatsapp_phone_number_id) y, si tiene token propio, con él; si no,
// con el del entorno. Sin clínica se usa el número de la demo (entorno).
const API_VERSION = 'v21.0';

function credentials(clinic) {
  return {
    phoneNumberId: clinic?.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID,
    token: clinic?.whatsapp_token || process.env.WHATSAPP_TOKEN,
  };
}

async function sendText(to, body, clinic) {
  const { phoneNumberId, token } = credentials(clinic);
  const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body, preview_url: false },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Error enviando mensaje de WhatsApp (clínica ${clinic?.id ?? 'demo'}):`, res.status, errText);
  }
  return res.ok;
}

async function markAsRead(messageId, clinic) {
  const { phoneNumberId, token } = credentials(clinic);
  const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`;
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }),
  });
}

module.exports = { sendText, markAsRead };
