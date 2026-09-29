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
| `npm run preview` | Preview the production build |

The frontend test suite mocks the API and EventSource. The separate API repository was not started as part of these checks.
