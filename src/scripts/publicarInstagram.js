// Genera una imagen con IA y la publica en Instagram.
// Uso: node src/scripts/publicarInstagram.js "prompt de la imagen" "caption del post"
require('dotenv').config();
const { generateInstagramImage } = require('../services/imageGen');
const { publishImagePost } = require('../services/instagram');

async function main() {
  const [prompt, caption] = process.argv.slice(2);
  if (!prompt) {
    console.error('Uso: node src/scripts/publicarInstagram.js "prompt de la imagen" "caption del post"');
    process.exit(1);
  }

  console.log('Generando imagen...');
  const { publicUrl } = await generateInstagramImage(prompt);
  console.log('Imagen generada:', publicUrl);

  console.log('Publicando en Instagram...');
  const postId = await publishImagePost(publicUrl, caption || '');
  console.log('Publicado. ID del post:', postId);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
