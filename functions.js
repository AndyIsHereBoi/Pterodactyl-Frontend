const axios = require('axios');

const PANEL_URL = process.env.PANEL_URL;
const APP_API_KEY = process.env.PTERODACTYL_APPLICATION_API_KEY;
const CLIENT_API_KEY = process.env.PTERODACTYL_CLIENT_API_KEY;

const fs = require('fs');
const path = require('path');
const LOG_FILE = path.join(__dirname, 'log.txt');

// Ensure log file exists
try { fs.closeSync(fs.openSync(LOG_FILE, 'a')); } catch (e) { console.error('Could not initialize log file', e); }

function maskSensitive(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    const lk = k.toLowerCase();
    if (lk.includes('password') || lk.includes('token') || lk.includes('key') || lk.includes('authorization')) {
      out[k] = '***REDACTED***';
    } else if (v && typeof v === 'object') {
      out[k] = maskSensitive(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function truncateString(s, n = 1000) {
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  if (str.length <= n) return str;
  return str.slice(0, n) + '...';
}

function safeResponseData(responseData) {
  if (!responseData) return null;
  if (typeof responseData === 'string') {
    try {
      const parsed = JSON.parse(responseData);
      return maskSensitive(parsed);
    } catch (e) {
      return truncateString(responseData);
    }
  }
  if (typeof responseData === 'object') return maskSensitive(responseData);
  return truncateString(String(responseData));
}

async function logApiRequest({ method, url, requestData, status, responseData, error }) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      method,
      url,
      status: status || null,
      request: maskSensitive(requestData) || null,
      response: safeResponseData(responseData),
      error: error ? (error.message || String(error)) : null
    };
    const line = JSON.stringify(entry) + '\n';
    await fs.promises.appendFile(LOG_FILE, line, 'utf8');
  } catch (e) {
    console.error('Failed to write API log', e);
  }
}

// ============ HTML Helpers ============

/**
 * Generate a Bootstrap alert HTML snippet
 * @param {string} message - Alert message
 * @param {'success'|'danger'|'warning'|'info'} type - Alert type
 * @returns {string} HTML string
 */
function alertHtml(message, type = 'info') {
  return `<div class="alert alert-${type}">${message}</div>`;
}

/**
 * Generate a server card HTML snippet
 * @param {object} server - Server object
 * @returns {string} HTML string
 */
function serverCardHtml(server) {
  const statusBadge = server.status === 'running'
    ? '<span class="badge bg-success">Online</span>'
    : '<span class="badge bg-secondary">Offline</span>';

  // Escape helper for attribute safety
  function escapeAttr(s){ return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  return `
    <div class="col-md-6 col-lg-4" data-server-identifier="${escapeAttr(server.identifier)}" data-server-name="${escapeAttr(server.name)}">
      <div class="card h-100">
        <div class="card-body position-relative">
          <h5 class="card-title">${server.name}</h5>
          <p class="card-text text-body-secondary small mb-2">${server.description || 'No description'}</p>
          ${statusBadge}
          <!-- Clicking card navigates to server view -->
          <a href="/server/${escapeAttr(server.identifier)}" class="stretched-link" aria-label="Open ${escapeAttr(server.name)}"></a>
        </div>
      </div>
    </div>
  `;
}

// ============ Pterodactyl API ============

/**
 * Authenticate user with Pterodactyl panel
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function loginToPanel(email, password) {
  if (!PANEL_URL) {
    return { success: false, error: 'Panel URL not configured.' };
  }

  try {
    const response = await axios.post(`${PANEL_URL}/auth/login`, {
      user: email,
      password: password
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    // Log successful login attempt (do not include password)
    await logApiRequest({ method: 'POST', url: `${PANEL_URL}/auth/login`, requestData: { user: email }, status: response.status, responseData: response.data });

    return { success: true, data: response.data };
  } catch (error) {
    const message = error.response?.data?.errors?.[0]?.detail || 'Invalid credentials.';
    await logApiRequest({ method: 'POST', url: `${PANEL_URL}/auth/login`, requestData: { user: email }, status: error.response?.status, responseData: error.response?.data, error });
    return { success: false, error: message };
  }
}

/**
 * Fetch servers using the Client API
 * @param {string} apiKey - Client API key (optional, uses env if not provided)
 * @returns {Promise<{success: boolean, servers?: array, error?: string}>}
 */
async function getServers(apiKey = CLIENT_API_KEY) {
  if (!PANEL_URL) {
    return { success: false, error: 'Panel URL not configured.' };
  }

  if (!apiKey) {
    return { success: false, error: 'Client API key not configured.' };
  }

  try {
    const response = await axios.get(`${PANEL_URL}/api/client`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    // Log request (do not include API key)
    await logApiRequest({ method: 'GET', url: `${PANEL_URL}/api/client`, requestData: { api: 'client' }, status: response.status, responseData: response.data });

    const servers = response.data.data.map(item => ({
      identifier: item.attributes.identifier,
      name: item.attributes.name,
      description: item.attributes.description,
      status: item.attributes.status,
      node: item.attributes.node,
      ip: item.attributes.sftp_details?.ip,
      port: item.attributes.sftp_details?.port
    }));

    return { success: true, servers };
  } catch (error) {
    const message = error.response?.data?.errors?.[0]?.detail || 'Failed to fetch servers.';
    await logApiRequest({ method: 'GET', url: `${PANEL_URL}/api/client`, requestData: { api: 'client' }, status: error.response?.status, responseData: error.response?.data, error });
    return { success: false, error: message };
  }
}

/**
 * Fetch server details using the Client API
 * @param {string} serverId - Server identifier
 * @param {string} apiKey - Client API key (optional, uses env if not provided)
 * @returns {Promise<{success: boolean, server?: object, error?: string}>}
 */
async function getServerDetails(serverId, apiKey = CLIENT_API_KEY) {
  if (!PANEL_URL) {
    return { success: false, error: 'Panel URL not configured.' };
  }

  if (!apiKey) {
    return { success: false, error: 'Client API key not configured.' };
  }

  try {
    const response = await axios.get(`${PANEL_URL}/api/client/servers/${serverId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    await logApiRequest({ method: 'GET', url: `${PANEL_URL}/api/client/servers/${serverId}`, requestData: { serverId }, status: response.status, responseData: response.data });

    return { success: true, server: response.data.attributes };
  } catch (error) {
    const message = error.response?.data?.errors?.[0]?.detail || 'Failed to fetch server details.';
    await logApiRequest({ method: 'GET', url: `${PANEL_URL}/api/client/servers/${serverId}`, requestData: { serverId }, status: error.response?.status, responseData: error.response?.data, error });
    return { success: false, error: message };
  }
}

/**
 * Send power action to a server
 * @param {string} serverId - Server identifier
 * @param {'start'|'stop'|'restart'|'kill'} action - Power action
 * @param {string} apiKey - Client API key (optional, uses env if not provided)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendPowerAction(serverId, action, apiKey = CLIENT_API_KEY) {
  if (!PANEL_URL) {
    return { success: false, error: 'Panel URL not configured.' };
  }

  if (!apiKey) {
    return { success: false, error: 'Client API key not configured.' };
  }

  const validActions = ['start', 'stop', 'restart', 'kill'];
  if (!validActions.includes(action)) {
    return { success: false, error: `Invalid action. Must be one of: ${validActions.join(', ')}` };
  }

  try {
    const response = await axios.post(`${PANEL_URL}/api/client/servers/${serverId}/power`, {
      signal: action
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    await logApiRequest({ method: 'POST', url: `${PANEL_URL}/api/client/servers/${serverId}/power`, requestData: { serverId, action }, status: response.status, responseData: response.data });

    return { success: true };
  } catch (error) {
    const message = error.response?.data?.errors?.[0]?.detail || 'Failed to send power action.';
    await logApiRequest({ method: 'POST', url: `${PANEL_URL}/api/client/servers/${serverId}/power`, requestData: { serverId, action }, status: error.response?.status, responseData: error.response?.data, error });
    return { success: false, error: message };
  }
}

/**
 * Send command to server console
 * @param {string} serverId - Server identifier
 * @param {string} command - Command to send
 * @param {string} apiKey - Client API key (optional, uses env if not provided)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendCommand(serverId, command, apiKey = CLIENT_API_KEY) {
  if (!PANEL_URL) {
    return { success: false, error: 'Panel URL not configured.' };
  }

  if (!apiKey) {
    return { success: false, error: 'Client API key not configured.' };
  }

  try {
    const response = await axios.post(`${PANEL_URL}/api/client/servers/${serverId}/command`, {
      command: command
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    await logApiRequest({ method: 'POST', url: `${PANEL_URL}/api/client/servers/${serverId}/command`, requestData: { serverId, command }, status: response.status, responseData: response.data });

    return { success: true };
  } catch (error) {
    const message = error.response?.data?.errors?.[0]?.detail || 'Failed to send command.';
    await logApiRequest({ method: 'POST', url: `${PANEL_URL}/api/client/servers/${serverId}/command`, requestData: { serverId, command }, status: error.response?.status, responseData: error.response?.data, error });
    return { success: false, error: message };
  }
}

/**
 * Request a console websocket token for a server using the Application (admin) API key.
 * @param {string} serverId
 * @param {string} apiKey - optional (defaults to APP_API_KEY)
 * @returns {Promise<{success:boolean, token?:string, data?:object, error?:string}>}
 */
async function getConsoleToken(serverId, apiKey = CLIENT_API_KEY) {
  if (!PANEL_URL) {
    return { success: false, error: 'Panel URL not configured.' };
  }

  if (!apiKey) {
    return { success: false, error: 'Client API key not configured.' };
  }

  try {
    // The panel expects GET on /api/client/servers/:id/websocket
    const clientUrl = `${PANEL_URL}/api/client/servers/${serverId}/websocket`;
    try {
      const response = await axios.get(clientUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        }
      });

      await logApiRequest({ method: 'GET', url: clientUrl, requestData: { serverId }, status: response.status, responseData: response.data });

      // Extract token string and socket safely
      const tokenStr = response.data?.data?.token || response.data?.token || response.data?.attributes?.token || null;
      const socket = response.data?.data?.socket || response.data?.socket || null;
      console.log(`Functions: obtained console token for server ${serverId} socket=${socket} tokenPrefix=${String(tokenStr).slice(0,8)}...`);
      return { success: true, token: tokenStr, data: response.data, socket };
    } catch (err) {
      // Log and try application GET as fallback (some panels may differ)
      await logApiRequest({ method: 'GET', url: clientUrl, requestData: { serverId }, status: err.response?.status, responseData: err.response?.data, error: err });

      // Try application GET with app key if available
      if (APP_API_KEY) {
        const appUrl = `${PANEL_URL}/api/application/servers/${serverId}/websocket`;
        try {
          const r2 = await axios.get(appUrl, {
            headers: {
              'Authorization': `Bearer ${APP_API_KEY}`,
              'Accept': 'application/json'
            }
          });
          await logApiRequest({ method: 'GET', url: appUrl, requestData: { serverId }, status: r2.status, responseData: r2.data });
          const token2 = r2.data?.data?.token || r2.data?.token || r2.data?.attributes?.token || null;
          const socket2 = r2.data?.data?.socket || r2.data?.socket || null;
          console.log(`Functions: (fallback) obtained console token for server ${serverId} socket=${socket2} tokenPrefix=${String(token2).slice(0,8)}...`);
          return { success: true, token: token2, data: r2.data, socket: socket2 };
        } catch (err2) {
          await logApiRequest({ method: 'GET', url: appUrl, requestData: { serverId }, status: err2.response?.status, responseData: err2.response?.data, error: err2 });
          return { success: false, error: 'Could not obtain console token from panel.' };
        }
      }

      return { success: false, error: 'Could not obtain console token from panel.' };
    }
  } catch (error) {
    await logApiRequest({ method: 'GET', url: `${PANEL_URL}/api/client/servers/${serverId}/websocket`, requestData: { serverId }, status: error.response?.status, responseData: error.response?.data, error });
    const message = error.response?.data?.errors?.[0]?.detail || 'Failed to obtain console token.';
    return { success: false, error: message };
  }
}
module.exports = {
  // HTML helpers
  alertHtml,
  serverCardHtml,
  
  // Pterodactyl API
  loginToPanel,
  getServers,
  getServerDetails,
  sendPowerAction,
  sendCommand,
  getConsoleToken
};
