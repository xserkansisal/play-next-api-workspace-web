# play-next-api-workspace-web

Frontend for the Play Next API workspace. React + TypeScript + Vite, styled with Tailwind CSS v4 and a shadcn/ui-compatible setup (`components.json`, `@/lib/utils` `cn()` helper). Talks to the separate Express API repo over HTTP.

## Requirements

- Node.js >= 22.12 (Vite 7 requirement)
- npm

## Setup

```sh
npm install
cp .env.example .env.local   # set VITE_API_BASE_URL to the API origin
```

`VITE_API_BASE_URL` configures the Axios client in `src/lib/api.ts`. The home page offers a "Check API health" button that calls `GET /health` and shows loading, success, and error states.

## Scripts

| Script              | Purpose                                  |
| ------------------- | ---------------------------------------- |
| `npm run dev`       | Start the Vite dev server                |
| `npm run build`     | Typecheck and build for production       |
| `npm run typecheck` | Run TypeScript project checks            |
| `npm test`          | Run Vitest once (jsdom + Testing Library) |
| `npm run preview`   | Preview the production build             |

## Adding shadcn/ui components

The repo is preconfigured for the shadcn CLI, e.g. `npx shadcn@latest add card`. Components land in `src/components/ui`.
