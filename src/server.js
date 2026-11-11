require('dotenv').config();
const express = require('express');
const webhookRouter = require('./routes/webhook');
const dashboardRouter = require('./routes/dashboard');
const productMetricsRouter = require('./routes/productMetrics');
const { startReminderScheduler } = require('./services/reminders');
const { ensureDemoSlots } = require('./db/seed');

const app = express();
app.set('trust proxy', 1); // Render está detrás de un proxy; necesario para que req.protocol sea 'https'
app.use(express.json());
app.use('/generated', express.static(require('path').join(__dirname, '..', 'public', 'generated')));

app.get('/health', (req, res) => res.json({ ok: true, model: require('./services/agent').MODEL }));

app.use('/', webhookRouter);
app.use('/', dashboardRouter);
app.use('/', productMetricsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CitaDental AI bot escuchando en el puerto ${PORT}`);
  startReminderScheduler();
  const seedDemo = () => {
    try {
      const { added } = ensureDemoSlots();
      if (added) console.log(`Agenda demo: ${added} huecos nuevos`);
    } catch (err) {
      console.error('Error rellenando la agenda demo:', err);
    }
  };
  seedDemo();
  setInterval(seedDemo, 24 * 60 * 60 * 1000);
});
