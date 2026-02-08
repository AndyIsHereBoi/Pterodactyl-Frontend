const axios = require('axios');

const PANEL_URL = process.env.PANEL_URL;
const APP_API_KEY = process.env.PTERODACTYL_APPLICATION_API_KEY;
const CLIENT_API_KEY = process.env.PTERODACTYL_CLIENT_API_KEY;

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

  return `
    <div class="col-md-6 col-lg-4">
      <div class="card h-100">
        <div class="card-body">
          <h5 class="card-title">${server.name}</h5>
          <p class="card-text text-body-secondary small mb-2">${server.description || 'No description'}</p>
          ${statusBadge}
        </div>
        <div class="card-footer bg-transparent border-0">
          <a href="/server.html?id=${server.identifier}" class="btn btn-sm btn-outline-primary">Manage</a>
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

    return { success: true, data: response.data };
  } catch (error) {
    const message = error.response?.data?.errors?.[0]?.detail || 'Invalid credentials.';
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

    return { success: true, server: response.data.attributes };
  } catch (error) {
    const message = error.response?.data?.errors?.[0]?.detail || 'Failed to fetch server details.';
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
    await axios.post(`${PANEL_URL}/api/client/servers/${serverId}/power`, {
      signal: action
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    return { success: true };
  } catch (error) {
    const message = error.response?.data?.errors?.[0]?.detail || 'Failed to send power action.';
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
    await axios.post(`${PANEL_URL}/api/client/servers/${serverId}/command`, {
      command: command
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    return { success: true };
  } catch (error) {
    const message = error.response?.data?.errors?.[0]?.detail || 'Failed to send command.';
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
  sendCommand
};
