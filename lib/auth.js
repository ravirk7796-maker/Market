const crypto = require('node:crypto');

const SESSION_COOKIE = 'arshi_admin_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function configuredPassword() {
  const password = process.env.ADMIN_PASSWORD || '';
  return password.length >= 16 ? password : null;
}

function makeSignature(expiresAt, password) {
  return crypto.createHmac('sha256', password).update(String(expiresAt)).digest('base64url');
}

function readCookie(request, name) {
  const cookies = (request.headers.cookie || '').split(';');
  const entry = cookies.map(cookie => cookie.trim()).find(cookie => cookie.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : '';
}

function isValidSession(request) {
  const password = configuredPassword();
  if (!password) return false;
  const [expiresAtText, signature, ...extra] = readCookie(request, SESSION_COOKIE).split('.');
  if (!expiresAtText || !signature || extra.length || !/^\d+$/.test(expiresAtText)) return false;
  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false;
  const expected = Buffer.from(makeSignature(expiresAt, password));
  const supplied = Buffer.from(signature);
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function issueSession(response) {
  const password = configuredPassword();
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const value = `${expiresAt}.${makeSignature(expiresAt, password)}`;
  const secure = process.env.VERCEL ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

function clearSession(response) {
  const secure = process.env.VERCEL ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0${secure}`);
}

function requireAdmin(request, response) {
  if (!configuredPassword()) {
    response.status(503).json({ error: 'Set ADMIN_PASSWORD to a value of at least 16 characters in Vercel project settings.' });
    return false;
  }
  if (!isValidSession(request)) {
    response.status(401).json({ error: 'Admin sign-in required.' });
    return false;
  }
  return true;
}

module.exports = { clearSession, configuredPassword, isSameOrigin, isValidSession, issueSession, requireAdmin };
