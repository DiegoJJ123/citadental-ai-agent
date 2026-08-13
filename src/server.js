require('dotenv').config();
const express = require('express');
const webhookRouter = require('./routes/webhook');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/', webhookRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CitaDental AI bot escuchando en el puerto ${PORT}`);
});
