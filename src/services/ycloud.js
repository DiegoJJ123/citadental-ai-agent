// Cliente de la API de YCloud (BSP de WhatsApp con coexistencia).
// Docs: https://docs.ycloud.com/reference/introduction
// Una sola cuenta de YCloud (la de CitaDental AI) aloja los números de todas
// las clínicas; la API key va en YCLOUD_API_KEY.
const crypto = require('crypto');

const BASE = 'https://api.ycloud.com/v2';

function apiKey() {
  const key = process.env.YCLOUD_API_KEY;
  if (!key) throw new Error('Falta YCLOUD_API_KEY en el entorno');
  return key;
}

async function call(method, path, { body, query } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: { 'X-API-Key': apiKey(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error?.whatsappApiError?.message || text || `HTTP ${res.status}`;
    const err = new Error(`YCloud ${method} ${path}: ${res.status} ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const e164 = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits ? `+${digits}` : null;
};

// Envío inmediato (sendDirectly): las respuestas del bot son conversacionales
// y deben salir ya, no en cola.
async function sendText(from, to, body) {
  return call('POST', '/whatsapp/messages/sendDirectly', {
    body: { from: e164(from), to: e164(to), type: 'text', text: { body } },
  });
}

async function sendTemplate(from, to, { name, language, bodyParams }) {
  return call('POST', '/whatsapp/messages/sendDirectly', {
    body: {
      from: e164(from),
      to: e164(to),
      type: 'template',
      template: {
        name,
        language: { code: language },
        components: [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })) }],
      },
    },
  });
}

// Marca como leído y muestra "escribiendo…" (desaparece al responder o a los 25 s).
async function typing(inboundMessageId) {
  return call('POST', `/whatsapp/inboundMessages/${encodeURIComponent(inboundMessageId)}/typing`);
}

async function markAsRead(inboundMessageId) {
  return call('POST', `/whatsapp/inboundMessages/${encodeURIComponent(inboundMessageId)}/markAsRead`);
}

// Busca un número conectado en la cuenta de YCloud (recorre las páginas).
async function findPhoneNumber(phone) {
  const target = e164(phone);
  for (let page = 1; page <= 20; page++) {
    const data = await call('GET', '/whatsapp/phoneNumbers', { query: { page, limit: 100 } });
    const items = data?.items || [];
    const hit = items.find((n) => e164(n.phoneNumber) === target);
    if (hit) return hit;
    if (items.length < 100) break;
  }
  return null;
}

async function createTemplate(tpl) {
  return call('POST', '/whatsapp/templates', { body: tpl });
}

async function getTemplate(wabaId, name, language) {
  return call('GET', `/whatsapp/templates/${encodeURIComponent(wabaId)}/${encodeURIComponent(name)}/${encodeURIComponent(language)}`);
}

async function listWebhookEndpoints() {
  return call('GET', '/webhookEndpoints', { query: { limit: 100 } });
}

async function createWebhookEndpoint({ url, enabledEvents, description }) {
  return call('POST', '/webhookEndpoints', { body: { url, enabledEvents, description } });
}

// Firma de los webhooks: cabecera "YCloud-Signature: t=TIMESTAMP,s=HEX",
// HMAC-SHA256 de `${t}.${cuerpo crudo}` con el secreto del endpoint.
function verifySignature(header, rawBody, secret, { toleranceSec = 300, now = Date.now() } = {}) {
  if (!header || !rawBody || !secret) return false;
  const parts = Object.fromEntries(
    String(header)
      .split(',')
      .map((p) => p.trim().split('='))
      .filter((kv) => kv.length === 2)
  );
  const t = parts.t;
  const s = parts.s;
  if (!t || !s || !/^[0-9a-f]+$/i.test(s)) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  // t puede venir en segundos o milisegundos
  const tsMs = ts > 1e12 ? ts : ts * 1000;
  if (Math.abs(now - tsMs) > toleranceSec * 1000) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(s, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  call,
  e164,
  sendText,
  sendTemplate,
  typing,
  markAsRead,
  findPhoneNumber,
  createTemplate,
  getTemplate,
  listWebhookEndpoints,
  createWebhookEndpoint,
  verifySignature,
};
