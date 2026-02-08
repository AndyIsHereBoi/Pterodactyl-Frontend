const express = require('express');
const router = express.Router();

const {
  alertHtml,
  serverCardHtml,
  loginToPanel,
  getServers
} = require('./functions');

// Health
router.get('/health', (req, res) => res.json({ ok: true }));

// Login endpoint
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.send(alertHtml('Email and password are required.', 'danger'));
  }

  const result = await loginToPanel(email, password);

  if (result.success) {
    res.setHeader('HX-Redirect', '/dashboard.html');
    res.send(alertHtml('Login successful! Redirecting...', 'success'));
  } else {
    res.send(alertHtml(result.error, 'danger'));
  }
});

// Servers list
router.get('/servers', async (req, res) => {
  const result = await getServers();

  if (!result.success) {
    return res.send(alertHtml(result.error, 'warning'));
  }

  if (!result.servers || result.servers.length === 0) {
    return res.send(alertHtml('No servers found.', 'info'));
  }

  const cardsHtml = result.servers.map(serverCardHtml).join('');
  res.send(`<div class="row g-3">${cardsHtml}</div>`);
});

module.exports = router;
