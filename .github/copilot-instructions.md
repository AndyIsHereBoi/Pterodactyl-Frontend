# Copilot / AI Agent Guidance for Pterodactyl-Frontend 

**Quick context**
- This repo is an Alternate front end for Pterodactyl Panel (using the panels built in API)
- Primary external dependency / integration to expect: the Pterodactyl Panel (https://pterodactyl.io).

## Pterodactyl Panel (summary) 
- What it is: an open-source game server management panel with a RESTful HTTP API for both administrative and client-facing operations. Nodes run the Wings daemon which exposes a separate node/daemon API (including WebSocket-based server consoles, never accessed by the api directly, only panel backend).

- Primary base paths to know (do not list every route):
  - **/api/application/** — Admin/application-level API (create users, manage servers, nodes, nests, eggs, allocations, etc.). Requires an **Application API key** or an admin bearer token. Keep these keys server-side only.
  - **/api/client/** — Client/user-scoped API (user interactions with their servers, e.g., start/stop, server info). These endpoints are intended for user-facing operations and use **client tokens** or short-lived session tokens.
  - **Wings (daemon) API** — Runs per-node; used for node operations and server console websocket connections. Auth to Wings is token-based and typically proxied or handled by the backend.

- Key types & security guidance:
  - **Application / Admin keys**: full-power keys for server-wide administration. Never expose in frontend/browser code; always proxy admin calls through your backend and store keys in environment variables.
  - **Client tokens / session tokens**: scoped tokens for user actions. These may be used by the frontend only if issued with proper scope & expiry; prefer backend-issued short-lived tokens.
  - **Wings console tokens**: used for websocket console sessions; tokens are short-lived and delivered via a secure backend route.
  - Use the `Authorization: Bearer <token>` header for API requests unless a specific endpoint documents otherwise.

- Reference docs: https://old-api.redbanana.dev/ - official docs for canonical endpoint behavior and permission models.