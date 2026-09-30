# play-next-api-workspace-web

Desktop-first React + TypeScript workspace for the separate Play Next API service. Built with Vite, Tailwind CSS v4, a shadcn/ui-compatible setup, Axios, and CodeMirror 6.

## Setup

- Node.js >= 22.12
- npm

```sh
npm install
cp .env.example .env.local
```

Set `VITE_API_BASE_URL` in `.env.local` to the API origin (for example `http://localhost:3000`). The frontend uses the API's `/api/v1` shared-data endpoints and `/api/v1/events` SSE stream.

The API's CORS check is an exact match against its own `CORS_ORIGIN` environment variable — it does not allow `http://localhost:5173` (the Vite dev server's default origin) by default. When running the API locally against this frontend, set `CORS_ORIGIN` on the API side to match the origin this dev server actually runs on (`http://localhost:5173` by default), or requests from the browser will fail with an opaque CORS error and no indication of why.

## Slice 3 workspace

The workspace loads collections, environments, and Trash; supports searchable alphabetic collection trees; creates collections, folders, requests, and environments; and saves each resource independently. Request drafts have explicit Save and unsaved indicators. Trash restoration runs a conflict check before restoring and supports per-item rename overrides. Live updates show review/keep-working actions, preserve local edits, and never auto-merge or replace an open draft. The request body is JSON-highlighted in CodeMirror and saved as text so `{{variables}}` remain editable.

Sending is intentionally a Slice 4 stub. Import/export controls are disabled until Slice 5. There is no permanent delete, authentication, deployment configuration, or request proxy in this slice.

## Chaining a value from one response into the next request

`{{variable}}` references are resolved in the URL, query params, headers and the JSON body. Besides environment
variables, a value can be captured straight out of a response:

1. Send a request, then choose **Save a value as a variable** under the response tabs.
2. Give it a name and a path to the value. Paths can read the JSON body (`data.token`, `items[0].id`,
   `payload["odd key"]`), a response header (`header:location`) or the status code (`status`). The panel suggests the
   paths present in the current response and previews the value before you save it.
3. Use it as `{{name}}` anywhere in a later request.

These **runtime variables** are deliberately local:

- They live in `sessionStorage`, in one browser tab, and are **never sent to the API**. Collections and environments
  are shared by the whole team, so writing a captured value — typically a short-lived token tied to one person's
  sign-in — into a shared environment would silently change what everyone else sends.
- They **override** environment variables of the same name, so a freshly captured value wins over a stale placeholder.
- They are cleared when the tab closes. Use the **Variables** menu in the top bar to inspect, remove or clear them.

Extraction is intentionally declarative rather than a scripting sandbox. A path that does not resolve reports why
(missing field, out-of-range index, non-JSON body, or a value that is an object/array/null) instead of silently
storing an empty value. Postman pre-request/test scripts are still not imported or executed; if an imported
collection relied on `pm.environment.set`, recreate that step with a capture rule here.

## Authentication (Slice 7)

The app now requires sign-in before showing the workspace. Sign-in is a two-step, cookie-based flow against the API, which was already implemented server-side (see the API repo's `xserkansisal-api-foundation` branch):

1. **Request a code** — enter a work email (`@fluttersea.com`, `@sisal.com`, or `@sisal.it`; other domains are rejected). The API always replies with the same uniform message, whether or not the address is eligible — the disallowed-domain case is the one distinguishable rejection.
2. **Verify the code** — enter the 6-digit code emailed to that address (valid 15 minutes, single-use). On success the API sets an `HttpOnly` session cookie (`play_next_session`, 30-day lifetime) that this app cannot and does not need to read directly.

**A known API limitation to be aware of:** the verify-code endpoint returns the *same* error (`401 INVALID_OR_EXPIRED_CODE`) whether the code was wrong, has expired, or has already hit its 5-attempt limit — the response does not say which. This app tracks failed attempts against the current code client-side (a heuristic, not authoritative) so it can tell the user plainly once they've had 5 wrong tries with this code that it is dead and they need to request a new one, rather than repeating a generic "incorrect" message forever.

Once signed in:

- **Sign-out** is a button in the top bar; it revokes the session server-side and returns to the sign-in screen.
- A session can expire or be revoked at any time (it lasts up to 30 days but can be revoked server-side). If any API call comes back `401 AUTHENTICATION_REQUIRED` while already signed in, the app shows a blocking "session has expired" overlay with an embedded sign-in form **without unmounting the workspace**, so in-memory unsaved drafts are preserved across re-authentication.
- The live-update `EventSource` connection is also authenticated (`withCredentials: true`); an unauthenticated or expired SSE connection gets 401 and the browser does not auto-retry (per the EventSource spec), so there is no tight reconnect loop. On any SSE error this app probes `GET /auth/me` once to tell an auth failure (→ show the expired-session overlay) apart from a generic network/server outage (→ keep the existing manual "Reconnect" banner).
- Every collection, folder, request, and environment shows who created and who last modified it (an email address), or **"unknown"** for rows that existed before authentication was added — that is expected, not a bug.

**Retrieving a sign-in code locally, without real email:** the API has a development-only `GET /api/v1/auth/dev-inbox?email=...` route, gated behind `NODE_ENV=development`, a 32+ character `AUTH_DEV_INBOX_TOKEN` environment variable, a loopback-only request, and an `X-Dev-Inbox-Token` header matching that token. It returns the most recently issued code for that address. This app's UI has no built-in way to call it (it's a diagnostic route, not part of the product); use `curl` directly against the API when developing locally.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Typecheck and build for production |
| `npm run typecheck` | Run TypeScript project checks |
| `npm test` | Run Vitest once with jsdom and Testing Library |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run preview` | Preview the production build (Vite's own preview server — for local sanity checks only, not for production; see "Deploying to a VM" below) |

The frontend test suite mocks the API and EventSource. The separate API repository was not started as part of these checks.

## Deploying to a VM

Target environment: an on-premises VM on the organization's internal network. **nginx** serves the built static files and reverse-proxies `/api` to the API, so the browser sees a **single origin** — there is no cross-origin request in normal operation. The API itself still runs as its own process, managed with **PM2** (not Docker, not systemd); this app no longer runs under PM2, since nginx serves its static files directly (see "Why nginx, not a Node static server" below). There is **no TLS** — this deployment is plain HTTP. **This was originally scoped as acceptable because the internal network carried no credentials or sign-in feature; that is no longer true as of Slice 7, which added cookie-based sign-in. The `play_next_session` cookie now travels in plain text on this network.** This must be revisited (TLS added) before this deployment is exposed beyond a fully trusted internal segment.

None of the steps below assume a specific hostname or machine — substitute your VM's actual paths/addresses wherever a placeholder appears.

### 1. Prerequisites

- Node.js >= 22.12 (this repo pins dependency versions tested against Node 23.5; anything >= 22.12 satisfies `engines`) — needed to build the app, not to serve it.
- npm.
- nginx installed on the VM.
- The API running separately (its own repository), managed with PM2 as before — unchanged by this slice.

### 2. Install and configure

```sh
npm install
cp .env.example .env.local
```

Set `VITE_API_BASE_URL` in `.env.local` to a **same-origin relative path**, not an absolute host — this is the point of putting nginx in front:

```
VITE_API_BASE_URL=/api
```

**This variable is still baked into the build at build time, not read at runtime** — that has not changed. Vite inlines `import.meta.env.VITE_API_BASE_URL` directly into the compiled JavaScript bundle when `npm run build` runs. This means:

- You must set `VITE_API_BASE_URL` correctly **before** running `npm run build`, not after.
- Changing `.env.local` (or the shell environment) afterwards and reloading nginx **does nothing** — the already-built `dist/` bundle still contains the old value baked in. There is no runtime re-read of this variable.
- To change it, edit the value and **run `npm run build` again**, then redeploy the freshly built `dist/` files (nginx serves whatever is on disk, so this just means replacing the files — no PM2/process restart is needed on the web side, since nginx is not restarted per deploy, only reloaded if its own config changed).

This is a common trap: someone deploys, later changes the environment variable on the VM, and is confused when the app still talks to the old value. It is not a bug — it is how Vite's build-time env injection works. Always rebuild after changing this variable.

### 3. Build

```sh
npm run build
```

Produces a static `dist/` directory. `npm run build` runs `tsc -b` first, so a build also fails on a type error. Copy this `dist/` directory to wherever nginx will read it from on the VM (referred to as `__DIST_PATH__` below).

### 4. Install the nginx site config

`deploy/nginx.conf` in this repo is a ready-to-use nginx `server` block. It:

- Serves `dist/` as static files with `try_files $uri $uri/ /index.html`, so client-side routes and a browser refresh on a deep link fall back to `index.html` instead of 404ing.
- Reverse-proxies `/api/` to the API process, so `VITE_API_BASE_URL=/api` resolves same-origin.
- Disables proxy buffering for `/api/` (see "SSE and nginx buffering" below) — without this, the app's live-update feature silently stops working.

Copy it into your nginx config (for example `/opt/homebrew/etc/nginx/servers/` on this dev machine, or `/etc/nginx/sites-available/` + a symlink into `sites-enabled/` on most Linux distributions), and replace its two placeholders:

- `__DIST_PATH__` → the absolute path to this app's built `dist/` directory on the VM.
- `__API_ORIGIN__` → where the PM2-managed API actually listens, for example `http://127.0.0.1:3000` (loopback-only is fine and preferable, since nginx is the only thing that needs to reach it directly once it is the single public entry point).

Then reload nginx to pick up the new/changed site:

```sh
nginx -t          # validate the config before reloading
nginx -s reload    # or: sudo systemctl reload nginx / brew services restart nginx
```

### 5. Why nginx, not a Node static server

An earlier revision of this document served `dist/` with the [`serve`](https://www.npmjs.com/package/serve) npm package under its own PM2 process, on its own port, with no reverse proxy. That has been **removed**, not just left in place unused: the `serve` dependency was uninstalled from `package.json`, and the PM2 ecosystem file that ran it (`ecosystem.config.cjs`) was deleted. The web app is no longer a PM2-managed process at all — nginx serves its static files directly, and there is nothing long-running on the web side for PM2 to restart or crash-loop. The API is unaffected: it keeps running under PM2 exactly as before.

nginx was chosen for this revised shape because a reverse proxy was needed anyway (to give a single origin and hide the API's real port), and nginx is a natural, well-understood choice for serving static files from that same layer — running a second Node static-file process behind nginx just to serve `dist/` would have been redundant.

### 6. SSE and nginx buffering — read this before assuming the proxy "just works"

**nginx buffers proxied responses by default.** For a normal REST response this is invisible, but for a streaming Server-Sent Events response (the API's `/api/v1/events` endpoint, which this app's live-update notice depends on) it silently breaks it: events sit in nginx's buffer instead of being forwarded to the browser as they arrive, so the stream appears to hang — no error anywhere, the connection just doesn't do anything until the buffer is flushed or the connection closes.

`deploy/nginx.conf` sets the following on its `/api/` location specifically to prevent this:

- `proxy_buffering off;` — the key directive; forwards each chunk from the API to the client as soon as it arrives, instead of waiting to fill a buffer.
- `proxy_http_version 1.1;` — required for a properly persistent proxied connection.
- `proxy_read_timeout 1h;` — the default (60s) will kill an idle SSE connection that has nothing to send for a minute; a long timeout avoids that becoming a surprise. A real disconnect is still handled by the client's own reconnect logic (`Last-Event-ID`).
- `proxy_set_header Connection "";` — explicitly avoids sending a `Connection: close` header to the upstream, which would defeat the point of the above.
- `proxy_set_header X-Accel-Buffering no;` — a defensive extra signal in case another buffering layer is ever added in front of this one.

Do not remove any of these when adapting the config. This was verified live, not assumed — see the PR/commit notes for exactly how.

### 7. CORS is no longer needed for normal operation

Because nginx proxies `/api` on the same origin the browser loaded the page from, there is no cross-origin request for the app's own traffic, so the API's `CORS_ORIGIN` does not need to match this app's address for the deployed app to work. `CORS_ORIGIN` remains relevant only if something accesses the API directly and cross-origin — for example, a developer running this app's Vite dev server (`npm run dev`, still absolute-URL-based, still bypasses nginx) against the same API, or any other direct browser client. For that case, the API's `CORS_ORIGIN` still needs to be set to whatever origin is making that direct request, exactly as before.

