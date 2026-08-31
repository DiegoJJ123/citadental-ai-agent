const express = require('express');
const { getDashboardStats } = require('../services/stats');
const db = require('../db/db');

const router = express.Router();

function requireApiKey(req, res) {
  const apiKey = process.env.PRODUCT_METRICS_API_KEY;
  if (!apiKey || req.get('x-api-key') !== apiKey) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

// Endpoint de solo lectura, máquina-a-máquina, para que el Agentic Org OS (Sofía,
// agente Product Ops) monitorice la salud del bot. Auth por API key en cabecera,
// no por cookie/sesión (a diferencia de /api/stats, pensado para el navegador).
router.get('/api/product-metrics', (req, res) => {
  if (!requireApiKey(req, res)) return;
  res.json(getDashboardStats());
});

// Diego pidió (2026-08-31) poder pausar el bot para un número desde la app
// Diego Juarez SL (Org OS), no desde el dashboard propio del bot — mismo
// flag `escalated` que ya usa la tool escalar_a_humano en agent.js cuando el
// LEAD pide hablar con una persona (handleIncomingMessage no responde nada
// si escalated=1). Máquina-a-máquina, misma auth que /api/product-metrics.
router.post('/api/product-control/pause-conversation', express.json(), (req, res) => {
  if (!requireApiKey(req, res)) return;
  const phone = (req.body?.phone || '').replace(/\D/g, '');
  if (!phone) {
    return res.status(400).json({ error: 'Falta el número de teléfono' });
  }
  db.prepare(
    "INSERT INTO conversations (phone, history, escalated) VALUES (?, '[]', 1) " +
      'ON CONFLICT(phone) DO UPDATE SET escalated = 1'
  ).run(phone);
  res.json({ ok: true });
});

router.post('/api/product-control/resume-conversation', express.json(), (req, res) => {
  if (!requireApiKey(req, res)) return;
  const phone = (req.body?.phone || '').replace(/\D/g, '');
  if (!phone) {
    return res.status(400).json({ error: 'Falta el número de teléfono' });
  }
  db.prepare('UPDATE conversations SET escalated = 0 WHERE phone = ?').run(phone);
  res.json({ ok: true });
});

module.exports = router;
