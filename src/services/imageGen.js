const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'public', 'generated');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Genera una imagen cuadrada (1:1, formato feed de Instagram) a partir de un prompt
// y la guarda en public/generated. Devuelve { filePath, publicUrl }.
async function generateInstagramImage(prompt) {
  const result = await openai.images.generate({
    model: 'gpt-image-1',
    prompt,
    size: '1024x1024',
    quality: 'high',
  });

  const b64 = result.data[0].b64_json;
  const fileName = `${crypto.randomUUID()}.png`;
  const filePath = path.join(OUTPUT_DIR, fileName);
  fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));

  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    throw new Error('Falta BASE_URL en el .env (ej. https://citadental-ai-bot.onrender.com): Instagram necesita una URL pública para leer la imagen.');
  }

  return { filePath, publicUrl: `${baseUrl.replace(/\/$/, '')}/generated/${fileName}` };
}

module.exports = { generateInstagramImage };
