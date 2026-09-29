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

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Typecheck and build for production |
| `npm run typecheck` | Run TypeScript project checks |
| `npm test` | Run Vitest once with jsdom and Testing Library |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run preview` | Preview the production build (Vite's own preview server — for local sanity checks only, not for production; see "Deploying to a VM" below) |
| `npm run serve:dist` | Serve the built `dist/` directory with SPA fallback, on `$PORT` (default `4173`) — this is what actually runs in production, under PM2 |

The frontend test suite mocks the API and EventSource. The separate API repository was not started as part of these checks.

## Deploying to a VM

Target environment: an on-premises VM on the organization's internal network, managed with **PM2** (not Docker, not systemd). The web app and the API run as two separate processes on two separate ports, with **no reverse proxy** in front of either. There is **no TLS** — this deployment is plain HTTP, which is only acceptable because it stays inside the internal network with no credentials or sign-in feature in transit. **Revisit this before adding TLS-sensitive features (authentication, sign-in) or exposing either service beyond the internal network.**

None of the steps below assume a specific hostname or machine — substitute your VM's actual address wherever `<web-host>` or `<api-host>` appears.

### 1. Prerequisites

- Node.js >= 22.12 (this repo pins dependency versions tested against Node 23.5; anything >= 22.12 satisfies `engines`).
- npm.
- PM2 installed and available on the VM (`npm install -g pm2`, or any other install method your organization prefers — this repo does not vendor PM2 itself).

### 2. Install and configure

```sh
npm install
cp .env.example .env.local
```

Set `VITE_API_BASE_URL` in `.env.local` to the API's real address on this deployment, for example `http://<api-host>:3000`.

**This variable is baked into the build at build time, not read at runtime.** Vite inlines `import.meta.env.VITE_API_BASE_URL` directly into the compiled JavaScript bundle when `npm run build` runs. This means:

- You must set `VITE_API_BASE_URL` correctly **before** running `npm run build`, not after.
- Changing `.env.local` (or the shell environment) and restarting PM2 **does nothing** — the already-built `dist/` bundle still contains the old value baked in. There is no runtime re-read of this variable.
- To point the deployed app at a different API address, you must edit the value and **run `npm run build` again**, then restart the PM2 process so it serves the freshly built files.

This is a common trap: someone deploys, later changes the environment variable on the VM, restarts the process, and is confused when the app still talks to the old API address. It is not a bug — it is how Vite's build-time env injection works. Always rebuild after changing this variable.

### 3. Build

```sh
npm run build
```

Produces a static `dist/` directory. `npm run build` runs `tsc -b` first, so a build also fails on a type error.

### 4. Serve the build under PM2

There is no reverse proxy, so something must serve `dist/` directly on its own port. This repo uses the [`serve`](https://www.npmjs.com/package/serve) package (installed as a normal dependency, not a dev-only tool, since it is needed at runtime on the VM) rather than:

- **`vite preview`** — Vite's own docs describe this as intended for locally previewing a build, not as a production server; it is not designed to be the thing running unattended under a process manager.
- **The Vite dev server (`npm run dev`)** — never run this in production. It is unoptimized, serves unbundled/unminified module graphs intended for fast local iteration, and is not hardened for anything but local development.
- **A hand-rolled Express static server** — unnecessary extra code and a dependency on Express just to reimplement what `serve` already does correctly, including SPA fallback.

`serve` is small, has no reverse-proxy assumptions (it binds directly to a port, which matches this deployment), and its `-s` (single-page) flag is exactly the SPA-fallback behavior this app needs: any path it can't find on disk falls back to `index.html`, so client-side routes and browser refreshes on a deep link don't 404.

A PM2 ecosystem file, `ecosystem.config.cjs`, is included at the repo root:

```sh
WEB_PORT=4173 pm2 start ecosystem.config.cjs
```

- App name: `play-next-api-workspace-web`.
- Entrypoint: `node_modules/.bin/serve -s dist -l $WEB_PORT` (default port `4173` if `WEB_PORT` is unset).
- Logs: `./logs/web-out.log` and `./logs/web-error.log`, next to the ecosystem file (not PM2's default `~/.pm2/logs`, so they travel with the deployment).
- Restart behavior: restarts automatically on crash, but backs off after repeated crashes (`max_restarts: 10`, `min_uptime: 10s`, `restart_delay: 2000`ms) instead of hot-looping.

Useful PM2 commands once running:

```sh
pm2 status                              # check the process is up
pm2 logs play-next-api-workspace-web    # tail logs
pm2 restart play-next-api-workspace-web # restart after a rebuild
pm2 stop play-next-api-workspace-web    # stop without removing from PM2's list
```

To survive a VM reboot, generate and enable a PM2 startup script once, then save the current process list:

```sh
pm2 startup            # prints and can run an OS-specific command to install a PM2 boot service
pm2 save               # persists the current process list (including this app) to be restored on boot
```

### 5. Configure the API's CORS for this origin

The API only allows browser requests from the exact origin in its own `CORS_ORIGIN` environment variable — it does not infer or default to this app's address. Set the API's `CORS_ORIGIN` to this app's real address on the deployment, for example `CORS_ORIGIN=http://<web-host>:4173`, before starting the API. If this is skipped, the app loads but every API call fails with an opaque CORS error in the browser console, with no server-side indication of what is misconfigured.

