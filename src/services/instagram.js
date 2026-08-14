const IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const API_VERSION = 'v21.0';

async function graphRequest(pathSegment, params) {
  const url = new URL(`https://graph.facebook.com/${API_VERSION}/${pathSegment}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, access_token: IG_ACCESS_TOKEN }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Instagram Graph API error en ${pathSegment}: ${JSON.stringify(data)}`);
  }
  return data;
}

// Publica una imagen (debe estar en una URL pública) con su caption en el feed de Instagram.
// Devuelve el ID del post publicado.
async function publishImagePost(imageUrl, caption) {
  if (!IG_BUSINESS_ACCOUNT_ID || !IG_ACCESS_TOKEN) {
    throw new Error('Faltan IG_BUSINESS_ACCOUNT_ID / IG_ACCESS_TOKEN en el .env.');
  }

  const container = await graphRequest(`${IG_BUSINESS_ACCOUNT_ID}/media`, {
    image_url: imageUrl,
    caption,
  });

  const published = await graphRequest(`${IG_BUSINESS_ACCOUNT_ID}/media_publish`, {
    creation_id: container.id,
  });

  return published.id;
}

module.exports = { publishImagePost };
