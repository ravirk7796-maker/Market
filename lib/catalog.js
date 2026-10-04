const seedProducts = require('../products.json');

const CATALOG_PATH = 'arshi-knot/products.json';

function hasBlobCredentials() {
  return Boolean(process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN) || Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function loadProducts() {
  if (!hasBlobCredentials()) return JSON.parse(JSON.stringify(seedProducts));

  const { get } = await import('@vercel/blob');
  const blob = await get(CATALOG_PATH, { access: 'public', useCache: false });
  if (!blob) return JSON.parse(JSON.stringify(seedProducts));

  const products = await new Response(blob.stream).json();
  if (!Array.isArray(products)) throw new Error('Stored product catalogue is invalid.');
  return products;
}

async function saveProducts(products) {
  if (!hasBlobCredentials()) throw new Error('Connect a Vercel Blob store before saving products.');

  const { put } = await import('@vercel/blob');
  await put(CATALOG_PATH, JSON.stringify(products), {
    access: 'public',
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: 'application/json; charset=utf-8'
  });
}

module.exports = { loadProducts, saveProducts };
