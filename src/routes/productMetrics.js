const express = require('express');
const { getDashboardStats } = require('../services/stats');

const router = express.Router();

// Endpoint de solo lectura, máquina-a-máquina, para que el Agentic Org OS (Sofía,
// agente Product Ops) monitorice la salud del bot. Auth por API key en cabecera,
// no por cookie/sesión (a diferencia de /api/stats, pensado para el navegador).
router.get('/api/product-metrics', (req, res) => {
  const apiKey = process.env.PRODUCT_METRICS_API_KEY;
  if (!apiKey || req.get('x-api-key') !== apiKey) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json(getDashboardStats());
});

module.exports = router;
