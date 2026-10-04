const { loadProducts } = require('../lib/catalog');

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed.' });
  }

  response.setHeader('Cache-Control', 'no-store');
  try {
    return response.status(200).json(await loadProducts());
  } catch (error) {
    console.error('Product catalogue read failed:', error);
    return response.status(503).json({ error: 'Product catalogue is unavailable. Check the Vercel Blob connection.' });
  }
};
