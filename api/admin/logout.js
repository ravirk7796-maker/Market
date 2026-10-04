const { clearSession, isSameOrigin } = require('../../lib/auth');

module.exports = function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed.' });
  }
  if (!isSameOrigin(request)) return response.status(403).json({ error: 'Request origin is not allowed.' });
  clearSession(response);
  return response.status(200).json({ authenticated: false });
};
