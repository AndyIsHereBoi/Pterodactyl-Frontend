const STORE = new Map();

function now() { return Date.now(); }

function storeToken(token, meta = {}) {
  if (!token) return;
  const key = String(token).trim();
  STORE.set(key, { ...meta, createdAt: now() });
}

function getToken(token) {
  const key = String(token).trim();
  const t = STORE.get(key);
  if (!t) return null;
  if (t.expiresAt && now() > t.expiresAt) {
    STORE.delete(key);
    return null;
  }
  return t;
}

function deleteToken(token) {
  const key = String(token).trim();
  STORE.delete(key);
}

function listTokens() {
  const out = [];
  for (const [k, v] of STORE.entries()) {
    out.push({ tokenPrefix: k.slice(0,8) + '...', serverId: v.serverId, createdAt: v.createdAt, expiresAt: v.expiresAt });
  }
  return out;
}

module.exports = { storeToken, getToken, deleteToken, listTokens };
