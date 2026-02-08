# Copilot / AI Agent Guidance for Pterodactyl-Frontend ✅

**Quick context**
- This repo is an alternate frontend that talks to a Pterodactyl Panel and proxies console websocket connections to nodes (Wings). It avoids exposing admin keys or node hostnames directly to browsers.

## Tech stack & frameworks 🧩
- Node.js + Express — HTTP server and router (EJS templates rendered server-side).
- EJS — simple server-side templating for pages and fragments.
- HTMX — progressive enhancement for small dynamic fragments where used.
- Bootstrap 5 — design system / styling (dark theme by default in this workspace).
- axios — HTTP client for communicating with Pterodactyl Panel API.
- ws (npm) — server-side WebSocket client/server used for the proxy.
- DOMPurify — client-side text sanitization for console/log output.

## Routing & key paths 📁
- Frontend pages
  - `/` — dashboard (server list)
  - `/server/:id` — server detail / console default
- API router (mounted at `/api`):
  - `GET /api/health` — health check
  - `POST /api/login` — login to panel (panel auth proxy)
  - `GET /api/servers` — servers list via Client API
  - `GET /api/server/:id/overview` — server fragment
  - `GET /api/server/:id/console` — *issue* console token (obtains panel websocket token/socket and stores it in backend tokenStore)
  - (dev) `GET /api/debug/tokens` — lists token prefixes when `DEBUG_TOKEN_DUMP=1` or `NODE_ENV=development` (safe for debugging)
- Websocket proxy path (HTTP upgrade):
  - `ws://<frontend-host>/ws/server/:id` — client connects here and must send an auth frame (see below)

## Websocket proxy mechanics 🔁
- Flow overview:
  1. Client requests console token from `GET /api/server/:id/console`. Backend calls panel `GET /api/client/servers/:id/websocket` using the **Client API key** (or Application key as fallback) to receive `{ token, socket }`.
  2. Backend stores the panel token and socket in an in-memory `tokenStore` with an expiry (default 15 minutes).
  3. Browser opens `ws://<frontend>/ws/server/:id` and sends: `{"event":"auth","args":["<token>"]}`.
  4. Proxy validates token (lookup in `tokenStore`) and ensures the token maps to the requested `serverId`.
  5. Proxy opens a websocket to the panel node at the stored `socket`, forwards `auth` to the node, and begins bi-directional forwarding of messages.

- Message expectations (examples):
  - Client -> proxy -> node: `{"event":"auth","args":["<token>"]}`
  - Client -> proxy -> node: `{"event":"send logs","args":[null]}`
  - Client -> proxy -> node: `{"event":"send command","args":["<command>"]}`
  - Node -> proxy -> client: `{"event":"auth success"}`
  - Node -> proxy -> client: `{"event":"console output","args":["<line> "]}`
  - Node -> proxy -> client: `{"event":"token expiring"}` / `{"event":"token expired"}`

- Implementation notes:
  - Proxy filters the client `auth` frame and performs the token validation on the server side (so tokens never appear in logs or other clients).
  - Proxy queues client-to-remote messages until the backend socket is fully OPEN, to avoid lost frames.
  - The proxy will attempt token refresh on `token expiring`/`token expired` events by calling `getConsoleToken(serverId)` again, storing the refreshed token, and re-authing the remote connection.

## Token & session handling 🔐
- Never expose `PTERODACTYL_APPLICATION_API_KEY` in the browser. Keep it in `.env` server-side.
- Client key (`PTERODACTYL_CLIENT_API_KEY`) is used server-side to fetch console tokens. The raw panel console token is returned to the browser for its short-lived authentication to the proxy, but the backend validates it against the server-side store.
- tokenStore behaviour:
  - Trim tokens when storing/looking up to avoid whitespace mismatches.
  - Store token meta { serverId, socket, expiresAt, createdAt }.
  - TTL default: 15 minutes; token invalidation recommended on first use but currently optional.

## Logging & safety 📝
- API requests/responses are logged to `log.txt` as JSON-lines (one entry per request) for debugging.
- Sensitive fields (passwords, tokens, API keys, Authorization headers) are masked/redacted before writing logs.
- Enable `DEBUG_TOKEN_DUMP=1` only in development when you need to inspect token prefixes — never expose full tokens in logs.

## UI behavior & security UX ⚠️
- Console UI only renders `console output` events to the terminal view. Other events (status, auth success) update a small note area.
- Command input is disabled until `auth success` or the first real `console output` line is received — this avoids sending commands before the node is ready.
- Console lines are sanitized with DOMPurify before inserting into the DOM to prevent XSS.

## Debugging tips & dev workflow 🔧
- To reproduce console connection issues: open DevTools → Network → WS frames and the Console, then observe the `auth`, `send logs`, and `console output` frames.
- If the proxy throws `Unexpected server response: 403` when connecting to the node, check node origin validation; attaching an `Origin` header (from PANEL_URL) helped in some environments.
- To dump active tokens in development: GET `/api/debug/tokens` (shows token prefixes only) with `NODE_ENV=development` or `DEBUG_TOKEN_DUMP=1`.

---

If you want, I can add a short example section with sample WS frames for the most common operations (auth, request logs, send command), or create a small troubleshooting checklist in the README. Which would you prefer? ✨