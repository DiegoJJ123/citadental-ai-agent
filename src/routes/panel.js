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
const { DEFAULT_TZ } = require('../services/tz');

const router = express.Router();
const form = express.urlencoded({ extended: false, limit: '50kb' });

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function newPanelToken() {
  return crypto.randomBytes(24).toString('hex');
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

const CSS = `
*{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f0f2f5;color:#111b21}
header{background:#0f172a;color:#fff;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
header a{color:#cbd5e1;text-decoration:none;font-size:14px;margin-left:14px} header strong{font-size:16px}
.wrap{max-width:1000px;margin:0 auto;padding:16px}
.card{background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden}
.chat-row{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid #f0f2f5;text-decoration:none;color:inherit}
.chat-row:hover{background:#f5f6f6}
.avatar{width:42px;height:42px;border-radius:50%;background:#dfe5e7;display:flex;align-items:center;justify-content:center;font-weight:700;color:#54656f;flex:none}
.grow{flex:1;min-width:0} .name{font-weight:600} .snippet{color:#667781;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{text-align:right;font-size:12px;color:#667781;flex:none}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;margin-top:4px}
.p-bot{background:#dcfce7;color:#166534} .p-off{background:#fee2e2;color:#991b1b}
.empty{padding:30px;text-align:center;color:#667781}
.chat-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #e5e7eb;flex-wrap:wrap}
#msgs{height:60vh;overflow-y:auto;padding:16px;background:#efeae2;display:flex;flex-direction:column;gap:6px}
.m{max-width:75%;padding:7px 10px;border-radius:8px;font-size:14px;white-space:pre-wrap;box-shadow:0 1px 1px rgba(0,0,0,.06);word-wrap:break-word}
.m small{display:block;font-size:11px;color:#667781;margin-top:3px;text-align:right}
.in{align-self:flex-start;background:#fff} .bot{align-self:flex-end;background:#d9fdd3} .human{align-self:flex-end;background:#cfe9ff}
.system{align-self:center;background:#fff7cd;font-size:12px}
.btn{display:inline-block;border:0;border-radius:8px;padding:9px 14px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
.b-red{background:#dc2626;color:#fff} .b-green{background:#16a34a;color:#fff} .b-blue{background:#2563eb;color:#fff} .b-sec{background:#fff;color:#374151;border:1px solid #d1d5db}
form.send{display:flex;gap:8px;padding:12px;border-top:1px solid #e5e7eb;background:#f0f2f5}
form.send textarea{flex:1;border:1px solid #d1d5db;border-radius:8px;padding:9px;font:inherit;resize:none;height:44px}
.note{padding:10px 16px;font-size:13px;color:#667781;background:#fff}
.flash{padding:10px 14px;border-radius:8px;margin-bottom:12px} .f-ok{background:#ecfdf5;color:#065f46} .f-err{background:#fef2f2;color:#991b1b}
.legend{font-size:12px;color:#667781;margin:8px 0}
`;

function layout({ title, clinic, base, isAdmin, body, flash }) {
  const flashHtml = flash?.ok ? `<div class="flash f-ok">${esc(flash.ok)}</div>` : flash?.error ? `<div class="flash f-err">${esc(flash.error)}</div>` : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · ${esc(clinic.name)}</title><style>${CSS}</style></head><body>
<header><strong>💬 ${esc(clinic.name)} · Conversaciones</strong><div><a href="${base}">Chats</a>${isAdmin ? `<a href="/onboarding">Clínicas</a><a href="/dashboard/logout">Cerrar sesión</a>` : ''}</div></header>
<div class="wrap">${flashHtml}${body}</div></body></html>`;
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

function tokenAccess(req, res, next) {
  const token = String(req.params.token || '');
  const clinic = /^[a-f0-9]{48}$/.test(token) ? db.prepare('SELECT id FROM clinics WHERE panel_token = ?').get(token) : null;
  if (!clinic) return res.status(404).send('Enlace no válido o caducado. Pide uno nuevo a CitaDental AI.');
  req.clinic = clinics.getClinicById(clinic.id);
  req.base = `/panel/t/${token}`;
  req.isAdmin = false;
  next();
}

const flashFrom = (q) => (q.ok ? { ok: q.ok } : q.error ? { error: q.error } : null);
const validPhone = (p) => /^\d{6,20}$/.test(String(p || ''));

function chatList(req, res) {
  const { clinic, base } = req;
  const chats = messages.listChats(clinic.id);
  const rows = chats
    .map((c) => {
      const label = c.patient_name || `+${c.phone}`;
      const who = c.last_author === 'patient' ? '' : c.last_author === 'bot' ? '🤖 ' : c.last_author === 'human' ? '👤 ' : '';
      return `<a class="chat-row" href="${base}/chat/${esc(c.phone)}">
        <div class="avatar">${esc(label.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]/g, '').slice(0, 2).toUpperCase() || '?')}</div>
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
      body: `<div class="legend">🤖 respondió el asistente · 👤 respondió una persona. Se actualiza solo cada 20 segundos.</div>
        <div class="card">${rows || '<div class="empty">Todavía no hay conversaciones.</div>'}</div>
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
          <div><a href="${base}" style="text-decoration:none">←</a> <strong>${esc(label)}</strong>
            <span class="pill ${chat.paused ? 'p-off' : 'p-bot'}">${chat.paused ? 'Asistente pausado' : 'Asistente activo'}</span></div>
          <form method="post" action="${base}/chat/${esc(phone)}/${chat.paused ? 'reactivar' : 'pausar'}">
            <button class="btn ${chat.paused ? 'b-green' : 'b-red'}" type="submit">${chat.paused ? 'Reactivar asistente' : 'Pausar asistente'}</button>
          </form>
        </div>
        <div id="msgs">${renderMessages(chat.messages) || '<div class="m system">Sin mensajes</div>'}</div>
        ${
          chat.canWrite
            ? `<form class="send" method="post" action="${base}/chat/${esc(phone)}/enviar">
                 <textarea name="text" placeholder="Escribe una respuesta… (al enviar, el asistente se pausa en este chat)" required></textarea>
                 <button class="btn b-blue" type="submit">Enviar</button></form>`
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
mount('/panel/t/:token', tokenAccess);

module.exports = router;
module.exports.newPanelToken = newPanelToken;
