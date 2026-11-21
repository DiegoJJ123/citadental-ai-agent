// Paso 1 del onboarding: lee la web de la clínica y extrae con IA los datos que
// el bot necesita (dirección, horario, precios, mutuas...). El resultado es
// solo un borrador: en el paso 2 se revisa y corrige a mano.
const OpenAI = require('openai');

const MAX_PAGES = 6;
const MAX_CHARS_PER_PAGE = 12000;
const MAX_TOTAL_CHARS = 45000;
const COMMON_LINK = 'servicio|precio|tarifa|contact|horario|nosotros|ubicaci|como-llegar|donde|faq|pregunta|informaci';
const USEFUL_LINK_BY_TYPE = {
  dental: new RegExp(`${COMMON_LINK}|tratamiento|clinica|clínica|equipo|financ|seguro|mutua|aseguradora|especialidad|implant|ortodon|estetic`, 'i'),
  restaurante: new RegExp(`${COMMON_LINK}|carta|menu|menú|plato|cocina|bebida|vino|postre|alergen|alérgen|reserva|grupo|evento|celebraci|terraza|delivery|domicilio|llevar`, 'i'),
  otro: new RegExp(`${COMMON_LINK}|producto|catalogo|catálogo|equipo`, 'i'),
};
const USEFUL_LINK = USEFUL_LINK_BY_TYPE.dental;
// PDFs que merece la pena leer (cartas, menús, tarifas).
const USEFUL_PDF = /carta|menu|menú|tarifa|precio|alergen|alérgen/i;
const MAX_PDF_BYTES = 6 * 1024 * 1024;

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

async function fetchPdfText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const host = new URL(url).hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/i.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CitaDentalAI-Onboarding/1.0)' } });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_PDF_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_PDF_BYTES || buf.subarray(0, 5).toString() !== '%PDF-') return null;
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buf });
    let data;
    try {
      data = await parser.getText();
    } finally {
      await parser.destroy?.();
    }
    const text = String(data?.text || '')
      .replace(/^-- \d+ of \d+ --$/gm, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    return text ? { url, text } : null;
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

function internalLinks(html, base, useful = USEFUL_LINK, pdfs = null) {
  const out = new Set();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const u = new URL(m[1], base);
      if (!/^https?:$/.test(u.protocol)) continue;
      const label = m[2].replace(/<[^>]+>/g, ' ');
      // Las cartas en PDF suelen estar alojadas fuera (Drive, CDN…): se aceptan de cualquier dominio.
      if (/\.pdf$/i.test(u.pathname)) {
        if (pdfs && (USEFUL_PDF.test(u.pathname) || USEFUL_PDF.test(label))) pdfs.add(u.toString());
        continue;
      }
      if (u.hostname !== base.hostname) continue;
      if (/\.(jpe?g|png|gif|webp|svg|zip|mp4)$/i.test(u.pathname)) continue;
      if (useful.test(u.pathname) || useful.test(label)) {
        u.hash = '';
        out.add(u.toString());
      }
    } catch {}
  }
  return [...out];
}

async function crawl(website, type = 'dental') {
  const start = normalizeUrl(website);
  const home = await fetchPage(start);
  if (!home) throw new Error('No he podido abrir esa web. Revisa la dirección o rellena los datos a mano.');
  const pages = [{ url: home.url, text: htmlToText(home.html).slice(0, MAX_CHARS_PER_PAGE) }];
  const useful = USEFUL_LINK_BY_TYPE[type] || USEFUL_LINK;
  const pdfs = new Set();
  let links = internalLinks(home.html, new URL(home.url), useful, pdfs).filter((l) => l !== home.url);
  // Webs con enlaces genéricos («Ver más», «Conócenos»): si hay pocos enlaces
  // útiles, se completan con otras páginas internas que no sean legales,
  // tienda o cuenta.
  if (links.length < 3) {
    const SKIP = /aviso|legal|cookie|privac|condicion|accesib|carrito|cart|checkout|cuenta|login|account|tienda|shop|producto\/|mapa-web|sitemap|wp-|feed|tag\/|categor|\/blog\/./i;
    const extra = internalLinks(home.html, new URL(home.url), /./).filter((l) => l !== home.url && !links.includes(l) && !SKIP.test(new URL(l).pathname));
    links = [...links, ...extra];
  }
  links = links.filter((l) => new URL(l).pathname.replace(/\/+$/, '') !== new URL(home.url).pathname.replace(/\/+$/, '')).slice(0, MAX_PAGES - 1);
  const more = await Promise.all(links.map(fetchPage));
  for (const p of more) {
    if (!p) continue;
    pages.push({ url: p.url, text: htmlToText(p.html).slice(0, MAX_CHARS_PER_PAGE) });
    internalLinks(p.html, new URL(p.url), useful, pdfs); // cartas en PDF enlazadas desde «Carta»
  }
  // Hasta 3 PDFs útiles (carta, menú, tarifas, alérgenos), delante del resto para que no se queden fuera.
  const pdfTexts = (await Promise.all([...pdfs].slice(0, 3).map(fetchPdfText))).filter(Boolean);
  pages.splice(1, 0, ...pdfTexts.map((p) => ({ url: `${p.url} (PDF)`, text: p.text.slice(0, MAX_CHARS_PER_PAGE) })));
  let total = 0;
  return pages.filter((p) => (total += p.text.length) <= MAX_TOTAL_CHARS);
}

async function extractClinicInfo(website, { openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), model, type = 'dental' } = {}) {
  const biz = require('./business').TYPES[type] || require('./business').TYPES.dental;
  const FIELDS = biz.fields;
  const pages = await crawl(website, type);
  const corpus = pages.map((p) => `### Página: ${p.url}\n${p.text}`).join('\n\n');
  const schema = FIELDS.map((f) => `"${f.key}": string  // ${f.label}`).join('\n');

  const response = await openai.chat.completions.create({
    model: model || process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini',
    response_format: { type: 'json_object' },
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `Extraes datos de la web de ${biz.extractWhat} para configurar su asistente de WhatsApp.
Devuelve SOLO un objeto JSON con estas claves (todas string, en español):
${schema}
Reglas:
- Usa EXCLUSIVAMENTE información que aparezca en el texto. Si un dato no aparece, deja "" (cadena vacía). Nunca inventes precios, horarios ni datos.
${biz.extractRules.map((r) => '- ' + r).join('\n')}
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
  for (const f of FIELDS) {
    const v = data[f.key];
    info[f.key] = Array.isArray(v) ? v.join('\n') : typeof v === 'string' ? v.trim() : '';
  }
  return { info, pagesRead: pages.map((p) => p.url) };
}

module.exports = { INFO_FIELDS, extractClinicInfo, normalizeUrl, htmlToText, internalLinks, crawl };
