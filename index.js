require('dotenv').config();
const path = require('path');
const fs = require('fs').promises;
const express = require('express');
const connectLivereload = require('connect-livereload');
const livereload = require('livereload');

const http = require('http');
const WebSocket = require('ws');

const lrserver = livereload.createServer();
const app = express();
const PORT = process.env.PORT || 3000;
const APP_NAME = process.env.APP_NAME || 'Pterodactyl Frontend';

lrserver.watch(path.join(__dirname, 'public'));
// Also watch all EJS templates so template edits trigger live reloads
lrserver.watch(path.join(__dirname, 'views', '**', '*.ejs'));
console.log('Livereload: watching /public and /views/**/*.ejs for changes');

app.use(connectLivereload());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configure EJS view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Serve templated pages (titles/headers reflect APP_NAME)
app.get('/login', (req, res) => res.render('login', { appName: APP_NAME }));
app.get('/dashboard', (req, res) => res.render('dashboard', { appName: APP_NAME }));
app.get('/index', (req, res) => res.render('index', { appName: APP_NAME }));

// Redirect old .html URLs to clean routes
app.get('/login.html', (req, res) => res.redirect(301, '/login'));
app.get('/dashboard.html', (req, res) => res.redirect(301, '/dashboard'));
app.get('/index.html', (req, res) => res.redirect(301, '/index'));

// Home (dashboard) — show servers list at `/`
app.get('/', (req, res) => res.render('dashboard', { appName: APP_NAME }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Mount API router
app.use('/api', require('./index_api'));

// Server view route
const { getServerDetails, alertHtml, getConsoleToken } = require('./functions');
app.get('/server/:id', async (req, res) => {
  const id = req.params.id;
  let serverName = id;
  try {
    const r = await getServerDetails(id);
    if (r.success && r.server && r.server.name) serverName = r.server.name;
  } catch (err) {
    // ignore
  }

  res.render('server', { appName: APP_NAME, serverId: id, serverName });
});

// WebSocket proxy: upgrade handling
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', async (request, socket, head) => {
  // Expect path: /ws/server/:id
  const url = new URL(request.url, `http://${request.headers.host}`);
  const match = url.pathname.match(/^\/ws\/server\/([^\/]+)$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const serverId = decodeURIComponent(match[1]);

  // Accept the client connection
  wss.handleUpgrade(request, socket, head, async (wsClient) => {
    try {
      // Wait for the client to send an auth message with the token
      let authTimeout = setTimeout(() => {
        try { wsClient.send(JSON.stringify({ event: 'error', args: ['Auth timeout'] })); } catch (e) {}
        try { wsClient.close(); } catch (e) {}
      }, 15000); // 15s to authenticate

      // Capture and log the first few raw messages from the client for debugging
      let rawCount = 0;
      const onRaw = (m) => {
        rawCount++;
        const txt = (typeof m === 'string') ? m : (m && m.toString ? m.toString() : '<binary>');
        const sample = txt.length > 300 ? txt.slice(0, 300) + '...[truncated]' : txt;
        console.log(`Proxy: raw client message #${rawCount} (${sample.length} chars): ${sample.replace(/\n/g, ' ')}`);
        if (rawCount >= 3) wsClient.off('message', onRaw);
      };
      wsClient.on('message', onRaw);

      const onMessage = async (msg) => {
        // msg may be a Buffer in Node's ws implementation
        const text = (typeof msg === 'string') ? msg : (msg && msg.toString ? msg.toString() : '');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
        if (!parsed || parsed.event !== 'auth' || !Array.isArray(parsed.args) || !parsed.args[0]) {
          // Not auth, ignore until auth arrives
          return;
        }

        clearTimeout(authTimeout);
        wsClient.off('message', onMessage);
        wsClient.off('message', onRaw);

        const token = parsed.args[0];
        console.log(`Proxy: received auth token for server ${serverId} (tokenPrefix=${String(token).slice(0,8)}...)`);
        const { getToken, deleteToken } = require('./tokenStore');
        const meta = getToken(token);
        console.log(`Proxy: lookup result for tokenPrefix=${String(token).slice(0,8)}... -> ${meta ? 'FOUND' : 'NOT_FOUND'}`);
        if (!meta || meta.serverId !== serverId) {
          try { wsClient.send(JSON.stringify({ event: 'error', args: ['Invalid or expired token'] })); } catch (e) {}
          try { wsClient.close(); } catch (e) {}
          return;
        }
        console.log(`Proxy: token valid for server ${meta.serverId} createdAt=${new Date(meta.createdAt).toISOString()} expiresAt=${meta.expiresAt ? new Date(meta.expiresAt).toISOString() : 'none'}`);

        // Connect to backend websocket
        const backendSocket = meta.socket;
        let wsRemote;
        try {
          // Include Origin header so node doesn't reject upgrade (some nodes validate origin)
          const originHeader = (process.env.PANEL_URL || '').replace(/^https?:\/\//, '') ? process.env.PANEL_URL : undefined;
          wsRemote = new WebSocket(backendSocket, { rejectUnauthorized: false, headers: originHeader ? { Origin: originHeader } : undefined });
        } catch (err) {
          console.error('Failed to create remote websocket', err);
          try { wsClient.send(JSON.stringify({ event: 'error', args: ['Backend connection failed'] })); } catch (e) {}
          try { wsClient.close(); } catch (e) {}
          return;
        }

        // Always attach an error handler immediately to avoid uncaught exceptions
        wsRemote.on('error', (err) => {
          console.error('Remote WS error during handshake or runtime', err && err.message ? err.message : err);
          // If it's a 403, note probable origin/auth mismatch
          if (err && String(err).includes('403')) console.warn('Remote returned 403 — check node origin/host validation and that the socket URL is correct.');
          try { wsClient.send(JSON.stringify({ event: 'error', args: ['Backend connection error'] })); } catch (e) {}
          try { wsClient.close(); } catch (e) {}
        });

        wsRemote.on('open', () => {
          // Forward auth to backend
          try { wsRemote.send(JSON.stringify({ event: 'auth', args: [token] })); } catch (e) {}

          // Flush any queued client messages that arrived while the backend was connecting
          if (pendingClientMessages && pendingClientMessages.length) {
            console.log(`Proxy: flushing ${pendingClientMessages.length} queued client messages to backend`);
            while (pendingClientMessages.length) {
              const msg = pendingClientMessages.shift();
              try { wsRemote.send(msg); } catch (err) { console.error('Proxy: failed to send queued message', err); }
            }
          }

          // Forward remote -> client, but handle token lifecycle events
          wsRemote.on('message', async (m) => {
            try {
              const txt = (typeof m === 'string') ? m : (m && m.toString ? m.toString() : '');
              let parsed = null;
              try { parsed = JSON.parse(txt); } catch (e) { parsed = null; }

              // Handle token lifecycle notifications from the node
              if (parsed && (parsed.event === 'token expiring' || parsed.event === 'token expired')) {
                console.log(`Proxy: backend event ${parsed.event} received for server ${serverId}, attempting token refresh`);
                try {
                  const { getConsoleToken } = require('./functions');
                  const { storeToken, deleteToken } = require('./tokenStore');
                  const refreshed = await getConsoleToken(serverId);
                  if (refreshed && refreshed.success && refreshed.token) {
                    const newToken = String(refreshed.token);
                    const newSocket = refreshed.socket || meta.socket;
                    const expiresInMs = (15 * 60 * 1000);
                    const expiresAt = Date.now() + expiresInMs;

                    // Store new token and update socket
                    storeToken(newToken, { serverId, socket: newSocket, expiresAt });
                    console.log(`Proxy: refreshed token for ${serverId} tokenPrefix=${newToken.slice(0,8)}...`);

                    // Re-auth backend with the new token on behalf of the client
                    try { wsRemote.send(JSON.stringify({ event: 'auth', args: [newToken] })); } catch (e) {}

                    // Notify client UI that a refresh occurred (no full token sent)
                    try { wsClient.send(JSON.stringify({ event: 'token refreshed', args: [newToken.slice(0,8) + '...'] })); } catch (e) {}
                  } else {
                    console.warn('Proxy: failed to refresh token from panel API');
                    try { wsClient.send(JSON.stringify({ event: 'error', args: ['Token refresh failed'] })); } catch (e) {}
                  }
                } catch (err) {
                  console.error('Proxy: error while refreshing token', err);
                  try { wsClient.send(JSON.stringify({ event: 'error', args: ['Token refresh error'] })); } catch (e) {}
                }

                // Forward the original message to the client as well
                try { wsClient.send(m); } catch (e) {}
                return;
              }

              // Log and forward auth success for visibility
              if (parsed && parsed.event === 'auth success') {
                console.log(`Proxy: backend auth success for server ${serverId}`);
              }

              // Default forward
              try { wsClient.send(m); } catch (e) {}
            } catch (err) {
              console.error('Proxy: error processing remote message', err);
              try { wsClient.send(m); } catch (e) {}
            }
          });
          wsRemote.on('close', () => { try { wsClient.close(); } catch (e) {} });
          wsRemote.on('error', (err) => { console.error('Remote WS error', err); try { wsClient.close(); } catch (e) {} });
        });

        // Queue for client messages that arrive before the backend is ready
        const MAX_QUEUE = 200;
        const pendingClientMessages = [];

        // Helper to forward or queue client messages
        const forwardClientMessage = (m) => {
          try {
            // Normalize to string for parsing without modifying raw buffer for forwarding
            const txt = (typeof m === 'string') ? m : (m && m.toString ? m.toString() : null);
            let p = null;
            try { p = txt ? JSON.parse(txt) : null; } catch (e) { p = null; }

            // Ignore auth frames sent by the client (we handle auth separately)
            if (p && p.event === 'auth') {
              console.log('Proxy: ignoring client auth frame (handled)');
              return;
            }

            if (wsRemote && wsRemote.readyState === WebSocket.OPEN) {
              try { wsRemote.send(m); console.log('Proxy: forwarded client->remote message', typeof m === 'string' ? (txt && txt.slice(0,120)) : `<binary:${m.length} bytes>`); } catch (e) { console.error('Proxy: error sending to remote', e); }
            } else {
              // Queue messages until remote opens
              if (pendingClientMessages.length >= MAX_QUEUE) {
                // Drop oldest if we're full
                pendingClientMessages.shift();
              }
              pendingClientMessages.push(m);
              console.log('Proxy: queued client message (remote not open yet). queueLength=', pendingClientMessages.length);
            }
          } catch (e) {
            console.error('Forward client->remote error', e);
          }
        };

        wsClient.on('message', forwardClientMessage);

        wsClient.on('close', () => { try { wsRemote.close(); } catch (e) {} });
        wsClient.on('error', () => { try { wsRemote.close(); } catch (e) {} });

        // Optionally, delete token after it's been used once
        // deleteToken(token);
      };

      wsClient.on('message', onMessage);

    } catch (err) {
      console.error('Websocket proxy error', err);
      try { wsClient.send(JSON.stringify({ event: 'error', args: ['Internal server error'] })); } catch (e) {}
      try { wsClient.close(); } catch (e) {}
    }
  });
});

// Generic error handler (do not leak stack traces to clients)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  // If request expects HTML, send sanitized alert
  if (req.accepts && req.accepts('html')) {
    return res.status(500).send(alertHtml('Internal server error.', 'danger'));
  }

  // Otherwise send a minimal JSON error
  res.status(500).json({ error: 'Internal server error.' });
});

// Start server using our http server (so ws works)
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
