const { configuredPassword, isSameOrigin, issueSession } = require('../../lib/auth');

module.exports = function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed.' });
  }
  if (!isSameOrigin(request)) return response.status(403).json({ error: 'Request origin is not allowed.' });

  const password = configuredPassword();
  if (!password) return response.status(503).json({ error: 'Set ADMIN_PASSWORD to at least 16 characters in Vercel project settings.' });

  const submitted = typeof request.body?.password === 'string' ? request.body.password : '';
  const expectedBytes = Buffer.from(password);
  const submittedBytes = Buffer.from(submitted);
  if (expectedBytes.length !== submittedBytes.length || !require('node:crypto').timingSafeEqual(expectedBytes, submittedBytes)) {
    return response.status(401).json({ error: 'Incorrect password.' });
  }

  issueSession(response);
  return response.status(200).json({ authenticated: true });
};
