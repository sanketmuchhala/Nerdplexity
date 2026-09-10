# Nerdplexity

A local-first model workbench for connecting local runtimes and online providers with your own API keys.

The project is being developed toward chat, files, model comparisons, and optional tools. See the [implementation plan](plan/implementation-plan.md) for the agreed scope and delivery phases.

## Current state

The existing app includes browser-persisted conversations, provider settings, local Ollama integration, and analytics pages. The first implementation phase establishes startup, build checks, and browser regression tests.

True end-to-end streaming, unified model discovery, richer provider connections, files, comparisons, and tool execution are planned work. Existing provider adapters have not all been validated against live services; model availability depends on the provider and account.

## Setup

Requirements: Node.js (the package declares `>=18`) and pnpm 9.0.0. Ollama is optional.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

If pnpm is not installed, use the pinned version through npm:

```sh
npm exec --yes --package=pnpm@9.0.0 -- pnpm install --frozen-lockfile
npm exec --yes --package=pnpm@9.0.0 -- pnpm dev
```

Open **http://127.0.0.1:5173/app**. The backend runs on **http://127.0.0.1:5174**; its health endpoint is `/health`. Both services bind to loopback by default. Vite forwards `/v1` requests to the backend.

Cloud-only development does not start or require Ollama. For local inference, start an installed Ollama service separately:

```sh
pnpm dev:ollama
```

Configure the endpoint in Settings. The current selector still uses a fixed model list; dynamic discovery is the next phase.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start backend and frontend |
| `pnpm dev:server` | Start the backend only |
| `pnpm dev:web` | Start Vite only |
| `pnpm dev:ollama` | Start an already-installed Ollama runtime |
| `pnpm typecheck` | Check all TypeScript packages |
| `pnpm build` | Build all packages |
| `pnpm start` | Serve the production build from the backend on port 5174 |
| `pnpm test` | Run the Playwright browser regression suite |
| `pnpm lint` | Run the existing source emoji policy check |

Run `pnpm build` before `pnpm start`. The lint command is not a complete ESLint or security audit. The package-level Vitest scripts are noninteractive, but unit-test coverage has not yet been established.

If using the npm bootstrap, prefix a command with `npm exec --yes --package=pnpm@9.0.0 --`, for example `npm exec --yes --package=pnpm@9.0.0 -- pnpm test`.

## Browser checks

Install Chromium once:

```sh
pnpm exec playwright install chromium
pnpm test
```

Alternatively, use an installed Google Chrome:

```sh
PLAYWRIGHT_CHANNEL=chrome pnpm test
```

Playwright starts local web/backend processes as needed. Tests use isolated browser contexts and do not require real API keys. They cover backend health, conversation creation/persistence, settings, and empty event history.

With `pnpm dev` already running, capture the UI using synthetic events:

```sh
node scripts/capture-baseline.mjs
# Or use installed Chrome:
PLAYWRIGHT_CHANNEL=chrome node scripts/capture-baseline.mjs
```

Captures are written to `docs/screenshots/baseline/`. See [baseline notes](plan/baseline.md) for results and known gaps.

## App routes

- `/`: landing page.
- `/app`: chat and settings.
- `/app/analytics`: analytics navigation.
- `/app/analytics/dashboard`: metrics.
- `/app/analytics/events`: event history.
- `/app/analytics/benchmark`: existing local benchmark screen, pending replacement with model comparisons.

## Data and credentials

Conversations, settings, and analytics currently live in browser IndexedDB. Provider keys saved in Settings are stored on that browser profile. Local browser storage is not an encrypted credential vault.

Online provider requests send messages and required context through the local backend to the selected provider. Web search also uses external services. Local storage does not make those workflows offline.

Do not commit keys or personal conversation exports. The new connection design will add session-only credentials by default and an explicit remember option while preserving existing saved settings.

## Repository

- `packages/web`: React, Vite, Zustand, and Dexie frontend.
- `packages/server`: Express routes, provider adapters, local queue, and metrics.
- `packages/types`: shared TypeScript contracts.
- `tests/browser`: browser regression tests.
- `plan/implementation-plan.md`: current workbench plan.
- `plan/baseline.md`: setup and validation evidence.

## License

[MIT](LICENSE).
