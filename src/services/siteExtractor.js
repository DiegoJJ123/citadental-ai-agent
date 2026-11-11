// Paso 1 del onboarding: lee la web de la clínica y extrae con IA los datos que
// el bot necesita (dirección, horario, precios, mutuas...). El resultado es
// solo un borrador: en el paso 2 se revisa y corrige a mano.
const OpenAI = require('openai');

const MAX_PAGES = 6;
const MAX_CHARS_PER_PAGE = 12000;
const MAX_TOTAL_CHARS = 45000;
const USEFUL_LINK = /tratamiento|servicio|precio|tarifa|contact|horario|clinica|clínica|equipo|nosotros|financ|seguro|mutua|aseguradora|ubicaci|como-llegar|donde|especialidad|implant|ortodon|estetic|faq|pregunta/i;

// Campos que guarda la clínica (y que el formulario del paso 2 muestra).
const INFO_FIELDS = [
  { key: 'nombre', label: 'Nombre de la clínica' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'email', label: 'Email' },
  { key: 'direccion', label: 'Dirección' },
  { key: 'como_llegar', label: 'Cómo llegar / parking / transporte', multiline: true },
  { key: 'horario', label: 'Horario de la clínica', multiline: true },
  { key: 'tratamientos', label: 'Tratamientos que ofrece', multiline: true },
  { key: 'precios', label: 'Precios', multiline: true },
  { key: 'primera_visita', label: 'Primera visita (precio, qué incluye)', multiline: true },
  { key: 'mutuas', label: 'Mutuas / aseguradoras', multiline: true },
  { key: 'financiacion', label: 'Financiación y formas de pago', multiline: true },
  { key: 'idiomas', label: 'Idiomas' },
  { key: 'otros', label: 'Otra información útil para pacientes', multiline: true },
];

function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Falta la web de la clínica');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  if (!/^https?:$/.test(u.protocol)) throw new Error('La web debe empezar por http o https');
  // Evita que se use para leer direcciones internas del servidor.
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/i.test(u.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) {
    throw new Error('Dirección no permitida');
  }
  return u;
}

async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CitaDentalAI-Onboarding/1.0)', Accept: 'text/html' },
    });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('html')) return null;
    const html = (await res.text()).slice(0, 600000);
    return { url: res.url || String(url), html };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&euro;/g, '€')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function internalLinks(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.hostname !== base.hostname || !/^https?:$/.test(u.protocol)) continue;
      if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4)$/i.test(u.pathname)) continue;
      const label = m[2].replace(/<[^>]+>/g, ' ');
      if (USEFUL_LINK.test(u.pathname) || USEFUL_LINK.test(label)) {
        u.hash = '';
        out.add(u.toString());
      }
    } catch {}
  }
  return [...out];
}

async function crawl(website) {
  const start = normalizeUrl(website);
  const home = await fetchPage(start);
  if (!home) throw new Error('No he podido abrir esa web. Revisa la dirección o rellena los datos a mano.');
  const pages = [{ url: home.url, text: htmlToText(home.html).slice(0, MAX_CHARS_PER_PAGE) }];
  const links = internalLinks(home.html, new URL(home.url)).filter((l) => l !== home.url).slice(0, MAX_PAGES - 1);
  const more = await Promise.all(links.map(fetchPage));
  for (const p of more) if (p) pages.push({ url: p.url, text: htmlToText(p.html).slice(0, MAX_CHARS_PER_PAGE) });
  let total = 0;
  return pages.filter((p) => (total += p.text.length) <= MAX_TOTAL_CHARS);
}

async function extractClinicInfo(website, { openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), model } = {}) {
  const pages = await crawl(website);
  const corpus = pages.map((p) => `### Página: ${p.url}\n${p.text}`).join('\n\n');
  const schema = INFO_FIELDS.map((f) => `"${f.key}": string  // ${f.label}`).join('\n');

  const response = await openai.chat.completions.create({
    model: model || process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini',
    response_format: { type: 'json_object' },
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `Extraes datos de la web de una clínica dental española para configurar su asistente de WhatsApp.
Devuelve SOLO un objeto JSON con estas claves (todas string, en español):
${schema}
Reglas:
- Usa EXCLUSIVAMENTE información que aparezca en el texto. Si un dato no aparece, deja "" (cadena vacía). Nunca inventes precios, horarios ni mutuas.
- "precios": una línea por tratamiento, formato "Tratamiento: precio".
- "tratamientos" y "mutuas": una por línea.
- "horario": tal como lo indique la web (p. ej. "Lunes a viernes 9:00-14:00 y 16:00-20:00").`,
      },
      { role: 'user', content: corpus },
    ],
  });

  let data = {};
  try {
    data = JSON.parse(response.choices[0].message.content || '{}');
  } catch {
    data = {};
  }
  const info = {};
  for (const f of INFO_FIELDS) {
    const v = data[f.key];
    info[f.key] = Array.isArray(v) ? v.join('\n') : typeof v === 'string' ? v.trim() : '';
  }
  return { info, pagesRead: pages.map((p) => p.url) };
}

module.exports = { INFO_FIELDS, extractClinicInfo, normalizeUrl, htmlToText, internalLinks };
