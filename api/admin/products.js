const crypto = require('node:crypto');
const { loadProducts, saveProducts } = require('../../lib/catalog');
const { isSameOrigin, requireAdmin } = require('../../lib/auth');

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_CATEGORIES = new Set(['Knitwear', 'Accessories', 'Home', 'Other']);
const IMAGE_TYPES = new Map([
  ['image/jpeg', { extension: 'jpg', signature: bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff }],
  ['image/png', { extension: 'png', signature: bytes => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  ['image/webp', { extension: 'webp', signature: bytes => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' }],
  ['image/gif', { extension: 'gif', signature: bytes => ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)) }]
]);

function cleanText(value, maximumLength) {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : '';
}

async function resolveImage(value, id, putBlob) {
  if (typeof value !== 'string') throw new Error('Upload a product photo or enter an HTTPS image URL.');
  const dataUrl = value.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (dataUrl) {
    const contentType = dataUrl[1].toLowerCase();
    const imageType = IMAGE_TYPES.get(contentType);
    const imageBytes = Buffer.from(dataUrl[2], 'base64');
    if (imageBytes.length > MAX_IMAGE_BYTES) throw new Error('Product photos must be 3 MB or smaller.');
    if (!imageType.signature(imageBytes)) throw new Error('The uploaded file does not match its image type.');
    const blob = await putBlob(`products/${id}-${crypto.randomUUID()}.${imageType.extension}`, imageBytes, {
      access: 'public',
      addRandomSuffix: true,
      cacheControlMaxAge: 31536000,
      contentType
    });
    return { image: blob.url, uploadedUrl: blob.url };
  }

  if (/^\/uploads\/\d+\.(?:jpg|png|webp|gif)$/i.test(value)) {
    return { image: value, uploadedUrl: '' };
  }

  let imageUrl;
  try { imageUrl = new URL(value); } catch { throw new Error('Use an HTTPS image URL.'); }
  if (imageUrl.protocol !== 'https:') throw new Error('Use an HTTPS image URL.');
  return { image: imageUrl.href, uploadedUrl: '' };
}

async function deleteManagedImage(image, deleteBlob) {
  try {
    const imageUrl = new URL(image);
    if (imageUrl.hostname.endsWith('.public.blob.vercel-storage.com')) await deleteBlob(imageUrl.href);
  } catch { }
}

async function validateProduct(body, id, putBlob) {
  const name = cleanText(body?.name, 100);
  const description = cleanText(body?.description, 600);
  const category = cleanText(body?.category, 30);
  const price = Number(body?.price);
  if (!name) throw new Error('Enter a product name.');
  if (!Number.isFinite(price) || price <= 0) throw new Error('Enter a valid price greater than zero.');
  if (!ALLOWED_CATEGORIES.has(category)) throw new Error('Choose a valid category.');
  if (!description) throw new Error('Enter a product description.');

  const { image, uploadedUrl } = await resolveImage(body.image, id, putBlob);
  return {
    product: {
      id,
      name,
      category,
      material: cleanText(body.material, 80),
      color: cleanText(body.color, 60),
      description,
      price,
      tag: cleanText(body.tag, 35),
      image
    },
    uploadedUrl
  };
}

module.exports = async function handler(request, response) {
  if (!['POST', 'PUT', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'POST, PUT, DELETE');
    return response.status(405).json({ error: 'Method not allowed.' });
  }
  if (!isSameOrigin(request)) return response.status(403).json({ error: 'Request origin is not allowed.' });
  if (!requireAdmin(request, response)) return;

  const productId = request.method === 'POST' ? '' : String(request.query?.id || '');
  if (request.method !== 'POST' && !/^\d+$/.test(productId)) return response.status(400).json({ error: 'A valid product ID is required.' });

  let uploadedUrl = '';
  try {
    const { del, put } = await import('@vercel/blob');
    const products = await loadProducts();
    if (request.method === 'DELETE') {
      const productIndex = products.findIndex(product => String(product.id) === productId);
      if (productIndex < 0) return response.status(404).json({ error: 'Product not found.' });
      const [removed] = products.splice(productIndex, 1);
      await saveProducts(products);
      await deleteManagedImage(removed.image, del);
      return response.status(200).json({ ok: true });
    }

    const id = request.method === 'POST' ? String(Date.now()) : productId;
    const { product, uploadedUrl: newUpload } = await validateProduct(request.body || {}, id, put);
    uploadedUrl = newUpload;

    let previousImage = '';
    if (request.method === 'POST') {
      products.push(product);
    } else {
      const productIndex = products.findIndex(item => String(item.id) === productId);
      if (productIndex < 0) {
        if (uploadedUrl) await deleteManagedImage(uploadedUrl, del);
        return response.status(404).json({ error: 'Product not found.' });
      }
      previousImage = products[productIndex].image;
      products[productIndex] = product;
    }

    try {
      await saveProducts(products);
    } catch (error) {
      if (uploadedUrl) await deleteManagedImage(uploadedUrl, del);
      throw error;
    }
    if (previousImage && previousImage !== product.image) await deleteManagedImage(previousImage, del);
    return response.status(request.method === 'POST' ? 201 : 200).json(product);
  } catch (error) {
    const status = /photo|image|price|category|product name|description|HTTPS/i.test(error.message) ? 400 : 503;
    console.error('Admin product operation failed:', error);
    return response.status(status).json({ error: error.message || 'Could not save the product.' });
  }
};
