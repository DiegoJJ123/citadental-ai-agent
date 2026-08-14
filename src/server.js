require('dotenv').config();
const express = require('express');
const webhookRouter = require('./routes/webhook');
const dashboardRouter = require('./routes/dashboard');

const app = express();
app.set('trust proxy', 1); // Render está detrás de un proxy; necesario para que req.protocol sea 'https'
app.use(express.json());
app.use('/generated', express.static(require('path').join(__dirname, '..', 'public', 'generated')));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/', webhookRouter);
app.use('/', dashboardRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CitaDental AI bot escuchando en el puerto ${PORT}`);
});
