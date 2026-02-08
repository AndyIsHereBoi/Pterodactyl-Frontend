const express = require('express');
const router = express.Router();

const {
  alertHtml,
  serverCardHtml,
  loginToPanel,
  getServers,
  getServerDetails
} = require('./functions');

// Health
router.get('/health', (req, res) => res.json({ ok: true }));

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.send(alertHtml('Email and password are required.', 'danger'));
    }

    const result = await loginToPanel(email, password);

    if (result.success) {
      res.setHeader('HX-Redirect', '/dashboard');
      res.send(alertHtml('Login successful! Redirecting...', 'success'));
    } else {
      res.send(alertHtml(result.error, 'danger'));
    }
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).send(alertHtml('Internal server error.', 'danger'));
  }
});

// Servers list
router.get('/servers', async (req, res) => {
  try {
    const result = await getServers();

    if (!result.success) {
      return res.send(alertHtml(result.error, 'warning'));
    }

    if (!result.servers || result.servers.length === 0) {
      return res.send(alertHtml('No servers found.', 'info'));
    }

    const cardsHtml = result.servers.map(serverCardHtml).join('');
    res.send(`<div class="row g-3">${cardsHtml}</div>`);
  } catch (err) {
    console.error('Servers list error', err);
    return res.status(500).send(alertHtml('Internal server error.', 'danger'));
  }
});

// Server overview fragment (kept for compatibility but not used as default)
router.get('/server/:id/overview', async (req, res) => {
  try {
    const id = req.params.id;

    const details = await getServerDetails(id);
    if (!details.success) {
      return res.send('<div class="alert alert-warning">Could not fetch server details.</div>');
    }

    const s = details.server;
    const html = `
      <div class="card mb-3">
        <div class="card-body">
          <h5 class="card-title">${s.name}</h5>
          <p class="small text-body-secondary mb-1">Node: ${s.node}</p>
          <p class="small text-body-secondary mb-1">IP: ${s.ip}:${s.port}</p>
          <p class="small mb-0">Status: <strong>${s.status}</strong></p>
        </div>
      </div>
    `;

    res.send(html);
  } catch (err) {
    console.error('Server overview error', err);
    return res.status(500).send('<div class="alert alert-danger">Internal server error.</div>');
  }
});

// Console token
const { storeToken } = require('./tokenStore');
router.get('/server/:id/console', async (req, res) => {
  try {
    const id = req.params.id;
    const { getConsoleToken } = require('./functions');

    const result = await getConsoleToken(id);
    if (!result.success) {
      return res.status(500).json({ success: false, error: 'Could not obtain console token.' });
    }

    // Store token and backend socket in token store with expiry (10-15min).
    const token = String(result.token);
    const socket = result.socket || result.data?.data?.socket || result.data?.socket || null;
    const expiresInMs = (15 * 60 * 1000); // 15 minutes
    const expiresAt = Date.now() + expiresInMs;

    storeToken(token, { serverId: id, socket, expiresAt });

    console.log(`API: stored console token for server ${id} socket=${socket} expiresAt=${new Date(expiresAt).toISOString()} tokenPrefix=${String(token).slice(0,8)}...`);

    // Return the raw token to the caller so it can authenticate the websocket proxy.
    return res.json({ success: true, token });
  } catch (err) {
    console.error('Console token error', err);
    return res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// Debug: list active tokens (development only or when DEBUG_TOKEN_DUMP=1)
if (process.env.DEBUG_TOKEN_DUMP === '1' || process.env.NODE_ENV === 'development') {
  router.get('/debug/tokens', (req, res) => {
    try {
      const { listTokens } = require('./tokenStore');
      const tokens = listTokens();
      return res.json({ success: true, tokens });
    } catch (err) {
      console.error('Debug tokens error', err);
      return res.status(500).json({ success: false, error: 'Could not list tokens.' });
    }
  });
}

module.exports = router;
