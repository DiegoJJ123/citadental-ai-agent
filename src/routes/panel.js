// Panel de conversaciones de una clínica: ver los chats del asistente,
// pausar/reactivar el asistente en un chat y responder a mano.
//  - /panel/c/:clinicId/...  → administrador (login de Google, también la demo)
//  - /panel/t/:token/...     → recepción de la clínica (enlace privado, sin login)
const crypto = require('crypto');
const express = require('express');
const auth = require('../services/auth');
const db = require('../db/db');
const clinics = require('../services/clinics');
const messages = require('../services/messages');
const brand = require('../services/brand');
const { DEFAULT_TZ } = require('../services/tz');

const router = express.Router();
const form = express.urlencoded({ extended: false, limit: '50kb' });

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Enlace de la recepción: "<nombre-de-la-clinica>-<clave>", p. ej.
// "vitaldent-k7m2x9". La clave (6 caracteres sin ambigüedades: ~887 millones
// de combinaciones) es lo que impide adivinar el enlace de otra clínica.
const KEY_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const KEY_LEN = 6;
const TOKEN_RE = /^[a-z0-9-]{1,40}-[2-9a-hjkmnp-z]{6}$/;
const LEGACY_TOKEN_RE = /^[a-f0-9]{48}$/;

function newPanelToken(clinic) {
  const slug = clinics.slugify(clinic?.info?.nombre || clinic?.name || 'clinica').slice(0, 40).replace(/-+$/, '') || 'clinica';
  const bytes = crypto.randomBytes(KEY_LEN);
  const key = [...bytes].map((b) => KEY_ALPHABET[b % KEY_ALPHABET.length]).join('');
  return `${slug}-${key}`;
}

// Freno a quien pruebe enlaces al azar: 20 fallos por IP cada 15 minutos.
const failures = new Map();
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_MAX = 20;
function tooManyFailures(ip) {
  const f = failures.get(ip);
  return Boolean(f) && Date.now() - f.since < FAIL_WINDOW_MS && f.count >= FAIL_MAX;
}
function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since >= FAIL_WINDOW_MS) failures.set(ip, { since: Date.now(), count: 1 });
  else f.count += 1;
  if (failures.size > 5000) failures.clear();
}

function fmtTime(sqlite) {
  const ts = messages.toTs(sqlite);
  if (Number.isNaN(ts)) return '';
  const d = new Date(ts);
  const sameDay = new Date().toLocaleDateString('es-ES', { timeZone: DEFAULT_TZ }) === d.toLocaleDateString('es-ES', { timeZone: DEFAULT_TZ });
  return sameDay
    ? d.toLocaleTimeString('es-ES', { timeZone: DEFAULT_TZ, hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('es-ES', { timeZone: DEFAULT_TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const CSS = brand.CSS + `
.wrap{max-width:1040px;margin:0 auto;padding:28px 20px}
@media (max-width:640px){.wrap{padding:14px 10px}}
.hero{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:20px;flex-wrap:wrap}
.hero h1{font-size:30px;font-weight:800;margin:8px 0 4px;line-height:1.1} .hero p{margin:0;color:var(--text-muted)}
.hero .hello{display:flex;align-items:center;gap:16px} .hero img{width:78px;height:auto;filter:drop-shadow(0 12px 20px rgba(31,78,168,.25))}
.stats{display:flex;gap:10px;flex-wrap:wrap}
.stat{background:#fff;border:1px solid var(--border);border-radius:14px;padding:10px 16px;box-shadow:var(--shadow-soft);min-width:110px}
.stat b{display:block;font-family:"Plus Jakarta Sans",sans-serif;font-size:22px;color:var(--brand-deep);line-height:1.2} .stat span{font-size:12px;color:var(--text-muted)}
.card{background:#fff;border-radius:var(--radius);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-soft)}
.chat-row{display:flex;gap:14px;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border);text-decoration:none;color:inherit;transition:background .12s}
.chat-row:last-child{border-bottom:0} .chat-row:hover{background:var(--brand-soft)}
.avatar{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--brand-deep),var(--brand-light));display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;flex:none;font-family:"Plus Jakarta Sans",sans-serif}
.grow{flex:1;min-width:0} .name{font-weight:600;color:var(--text-strong)} .snippet{color:var(--text-muted);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{text-align:right;font-size:12px;color:var(--text-muted);flex:none}
.pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;margin-top:4px}
.p-bot{background:#EAF7EF;color:#17633A} .p-off{background:var(--alert-soft);color:#A34E12}
.empty{padding:44px 20px}
.chat-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--border);flex-wrap:wrap;background:#fff}
.chat-head .who{display:flex;align-items:center;gap:12px} .chat-head .back{text-decoration:none;font-size:20px;color:var(--brand-deep);padding:0 4px}
#msgs{height:60vh;overflow-y:auto;padding:18px;background:#EFEAE2;display:flex;flex-direction:column;gap:6px}
.m{max-width:75%;padding:8px 12px;border-radius:12px;font-size:14px;white-space:pre-wrap;box-shadow:0 1px 1px rgba(0,0,0,.06);word-wrap:break-word;color:#111B21}
.m small{display:block;font-size:11px;color:#667781;margin-top:3px;text-align:right}
.in{align-self:flex-start;background:#fff;border-top-left-radius:4px} .bot{align-self:flex-end;background:#DCE9FD;border-top-right-radius:4px} .human{align-self:flex-end;background:#D9FDD3;border-top-right-radius:4px}
.system{align-self:center;background:#FFF7CD;font-size:12px;border-radius:999px;padding:4px 12px}
form.send{display:flex;gap:8px;padding:12px;border-top:1px solid var(--border);background:var(--surface);align-items:center}
form.send textarea{flex:1;border:1px solid var(--border);border-radius:22px;padding:11px 16px;font:inherit;resize:none;height:46px;background:#fff}
form.send textarea:focus{outline:3px solid #D3E2FA;border-color:var(--brand-mid)}
.note{padding:12px 18px;font-size:13px;color:#8A4210;background:var(--alert-soft)}
.flash{padding:11px 16px;border-radius:12px;margin-bottom:14px} .f-ok{background:#EAF7EF;color:#17633A;border:1px solid #BFE6CE} .f-err{background:#FDECEC;color:#8E1F1F;border:1px solid #F6C9C9}
.legend{font-size:13px;color:var(--text-muted);margin:0 0 10px;display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.legend .dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
`;

function layout({ title, clinic, base, isAdmin, body, flash }) {
  const flashHtml = flash?.ok ? `<div class="flash f-ok">${esc(flash.ok)}</div>` : flash?.error ? `<div class="flash f-err">${esc(flash.error)}</div>` : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · ${esc(clinic.name)}</title>${brand.HEAD}<style>${CSS}</style></head><body>${brand.BG}
<header class="topbar"><a href="${base}" style="text-decoration:none">${brand.logo(esc(clinic.name))}</a><nav><a href="${base}">Chats</a>${isAdmin ? `<a href="/onboarding">Clínicas</a><a href="/dashboard/logout">Cerrar sesión</a>` : ''}</nav></header>
<div class="wrap">${flashHtml}${body}</div>${brand.FOOTER}</body></html>`;
}

// Resuelve la clínica y la base de URLs según el tipo de acceso.
function adminAccess(req, res, next) {
  const clinic = clinics.getClinicById(Number(req.params.clinicId));
  if (!clinic) return res.status(404).send('Clínica no encontrada');
  req.clinic = clinic;
  req.base = `/panel/c/${clinic.id}`;
  req.isAdmin = true;
  next();
}

// prefix: '/panel' (enlace nuevo) o '/panel/t' (enlaces antiguos de 48 cifras).
const tokenAccess = (prefix, re) => (req, res, next) => {
  const token = String(req.params.token || '').toLowerCase();
  if (tooManyFailures(req.ip)) return res.status(429).send('Demasiados intentos. Espera unos minutos.');
  const clinic = re.test(token) ? db.prepare('SELECT id FROM clinics WHERE panel_token = ?').get(token) : null;
  if (!clinic) {
    recordFailure(req.ip);
    return res.status(404).send('Enlace no válido o caducado. Pide uno nuevo a CitaDental AI.');
  }
  req.clinic = clinics.getClinicById(clinic.id);
  req.base = `${prefix}/${token}`;
  req.isAdmin = false;
  next();
};

const flashFrom = (q) => (q.ok ? { ok: q.ok } : q.error ? { error: q.error } : null);
const validPhone = (p) => /^\d{6,20}$/.test(String(p || ''));

// Iniciales del paciente; si no sabemos su nombre, un icono de persona.
const PERSON_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6z"/></svg>';
function avatar(name) {
  const initials = String(name || '').split(/\s+/).map((w) => w.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '')[0] || '').join('').slice(0, 2).toUpperCase();
  return `<div class="avatar">${initials ? esc(initials) : PERSON_ICON}</div>`;
}

function chatList(req, res) {
  const { clinic, base } = req;
  const chats = messages.listChats(clinic.id);
  const rows = chats
    .map((c) => {
      const label = c.patient_name || `+${c.phone}`;
      const who = c.last_author === 'patient' ? '' : c.last_author === 'bot' ? '🤖 ' : c.last_author === 'human' ? '👤 ' : '';
      return `<a class="chat-row" href="${base}/chat/${esc(c.phone)}">
        ${avatar(c.patient_name)}
        <div class="grow"><div class="name">${esc(label)}</div><div class="snippet">${esc(who + (c.last_body || ''))}</div></div>
        <div class="meta">${esc(fmtTime(c.last_at))}<br><span class="pill ${c.paused ? 'p-off' : 'p-bot'}">${c.paused ? 'Asistente pausado' : 'Asistente activo'}</span></div>
      </a>`;
    })
    .join('');
  res.send(
    layout({
      title: 'Chats',
      clinic,
      base,
      isAdmin: req.isAdmin,
      flash: flashFrom(req.query),
      body: `<div class="hero"><div class="hello"><img src="${brand.MASCOT_URL}" alt="" class="float"><div>
          <span class="eyebrow live"><i></i>Asistente atendiendo · se actualiza solo</span>
          <h1>Conversaciones de <span class="text-gradient">${esc(clinic.info?.nombre || clinic.name)}</span></h1>
          <p>Lo que hablan tus pacientes con el asistente. Entra en un chat para pausarlo o responder tú.</p></div></div>
          <div class="stats"><div class="stat"><b>${chats.length}</b><span>chats</span></div><div class="stat"><b>${chats.filter((c) => c.paused).length}</b><span>con el asistente pausado</span></div></div></div>
        <div class="legend"><span><i class="dot" style="background:#fff;border:1px solid #ccc"></i>Paciente</span><span><i class="dot" style="background:#DCE9FD"></i>🤖 Asistente</span><span><i class="dot" style="background:#D9FDD3"></i>👤 Recepción</span></div>
        <div class="card">${rows || `<div class="empty">${brand.mascot('Todavía no hay conversaciones. En cuanto un paciente escriba al WhatsApp de la clínica, aparecerá aquí.', { size: 110 })}</div>`}</div>
        <script>setTimeout(()=>location.reload(),20000)</script>`,
    })
  );
}

function renderMessages(list) {
  return list
    .map((m) => {
      const cls = m.author === 'patient' ? 'in' : m.author === 'bot' ? 'bot' : m.author === 'human' ? 'human' : 'system';
      const who = m.author === 'bot' ? 'Asistente' : m.author === 'human' ? 'Recepción' : '';
      return `<div class="m ${cls}">${esc(m.body)}<small>${who ? esc(who) + ' · ' : ''}${esc(fmtTime(m.created_at))}</small></div>`;
    })
    .join('');
}

function chatView(req, res) {
  const { clinic, base } = req;
  const phone = String(req.params.phone);
  if (!validPhone(phone)) return res.status(400).send('Número no válido');
  const chat = messages.getChat(clinic.id, phone);
  const label = chat.name ? `${chat.name} · +${phone}` : `+${phone}`;
  res.send(
    layout({
      title: label,
      clinic,
      base,
      isAdmin: req.isAdmin,
      flash: flashFrom(req.query),
      body: `<div class="card">
        <div class="chat-head">
          <div class="who"><a class="back" href="${base}" title="Volver a los chats">←</a>${avatar(chat.name)}<div><strong>${esc(label)}</strong><br>
            <span class="pill ${chat.paused ? 'p-off' : 'p-bot'}">${chat.paused ? 'Asistente pausado: responde la recepción' : 'Asistente activo'}</span></div></div>
          <form method="post" action="${base}/chat/${esc(phone)}/${chat.paused ? 'reactivar' : 'pausar'}">
            <button class="btn ${chat.paused ? 'green' : 'red'}" type="submit">${chat.paused ? 'Reactivar asistente' : 'Pausar asistente'}</button>
          </form>
        </div>
        <div id="msgs">${renderMessages(chat.messages) || '<div class="m system">Sin mensajes</div>'}</div>
        ${
          chat.canWrite
            ? `<form class="send" method="post" action="${base}/chat/${esc(phone)}/enviar">
                 <textarea name="text" placeholder="Escribe una respuesta… (al enviar, el asistente se pausa en este chat)" required></textarea>
                 <button class="btn" type="submit">Enviar</button></form>`
            : '<div class="note">No se puede escribir: han pasado más de 24 h desde el último mensaje del paciente (norma de WhatsApp). Podrás responder cuando vuelva a escribir.</div>'
        }
      </div>
      <script>
        const box=document.getElementById('msgs'); box.scrollTop=box.scrollHeight;
        let last=box.innerHTML.length;
        setInterval(async()=>{ try{ const r=await fetch('${base}/chat/${esc(phone)}/mensajes',{credentials:'include'}); if(!r.ok) return; const h=await r.text(); if(h.length!==last){ const atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<60; box.innerHTML=h; last=h.length; if(atBottom) box.scrollTop=box.scrollHeight; } }catch(e){} },8000);
      </script>`,
    })
  );
}

function chatFragment(req, res) {
  const phone = String(req.params.phone);
  if (!validPhone(phone)) return res.status(400).end();
  res.set('Cache-Control', 'no-store').send(renderMessages(messages.getChat(req.clinic.id, phone).messages));
}

function back(req, res, phone, params) {
  res.redirect(`${req.base}/chat/${phone}?${new URLSearchParams(params).toString()}`);
}

function pause(req, res) {
  const phone = String(req.params.phone);
  if (!validPhone(phone)) return res.status(400).end();
  messages.setPaused(req.clinic.id, phone, true);
  back(req, res, phone, { ok: 'Asistente pausado en este chat. Responde tú desde aquí o desde el WhatsApp de la clínica.' });
}

function resume(req, res) {
  const phone = String(req.params.phone);
  if (!validPhone(phone)) return res.status(400).end();
  messages.setPaused(req.clinic.id, phone, false);
  back(req, res, phone, { ok: 'Asistente reactivado: volverá a responder en este chat.' });
}

async function send(req, res) {
  const phone = String(req.params.phone);
  if (!validPhone(phone)) return res.status(400).end();
  const r = await messages.sendManual(req.clinic, phone, req.body?.text);
  back(req, res, phone, r.ok ? { ok: 'Mensaje enviado. El asistente queda pausado en este chat.' } : { error: r.error });
}

function mount(prefix, access) {
  router.get(`${prefix}`, access, chatList);
  router.get(`${prefix}/chat/:phone`, access, chatView);
  router.get(`${prefix}/chat/:phone/mensajes`, access, chatFragment);
  router.post(`${prefix}/chat/:phone/pausar`, access, pause);
  router.post(`${prefix}/chat/:phone/reactivar`, access, resume);
  router.post(`${prefix}/chat/:phone/enviar`, access, form, send);
}

router.use('/panel/c', auth.requireDashboardAuth);
mount('/panel/c/:clinicId', adminAccess);
mount('/panel/t/:token', tokenAccess('/panel/t', LEGACY_TOKEN_RE)); // enlaces antiguos
mount('/panel/:token', tokenAccess('/panel', TOKEN_RE));

module.exports = router;
module.exports.newPanelToken = newPanelToken;
