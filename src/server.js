require('dotenv').config();
const express = require('express');
const webhookRouter = require('./routes/webhook');
const dashboardRouter = require('./routes/dashboard');
const productMetricsRouter = require('./routes/productMetrics');
const onboardingRouter = require('./routes/onboarding');
const { startReminderScheduler } = require('./services/reminders');
const { ensureDemoSlots } = require('./db/seed');

const app = express();
app.set('trust proxy', 1); // Render está detrás de un proxy; necesario para que req.protocol sea 'https'
// rawBody: la firma de los webhooks de YCloud se calcula sobre los bytes exactos.
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use('/generated', express.static(require('path').join(__dirname, '..', 'public', 'generated')));

app.get('/health', (req, res) => res.json({ ok: true, model: require('./services/agent').MODEL }));

app.use('/', webhookRouter);
app.use('/', dashboardRouter);
app.use('/', productMetricsRouter);
app.use('/', onboardingRouter);

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
