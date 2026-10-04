const { isValidSession } = require('../../lib/auth');

module.exports = function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed.' });
  }
  response.setHeader('Cache-Control', 'no-store');
  return response.status(isValidSession(request) ? 200 : 401).json({ authenticated: isValidSession(request) });
};
