# Nerdplexity

A local-first model workbench for connecting local runtimes and online providers with your own API keys.

The project is being developed toward chat, files, model comparisons, and optional tools. See the [implementation plan](plan/implementation-plan.md) for the agreed scope and delivery phases.

## Current state

The app has browser-persisted threads, a connections-based model catalog, streaming chat for Ollama and OpenAI-compatible endpoints, a bounded document agent for local models, run history, and analytics pages.

Hosted providers (OpenAI, Anthropic, Gemini, DeepSeek) list their models through discovery, but their chat responses are still returned whole rather than streamed. Streaming for them, files, comparisons, and general tool execution are planned work. Provider adapters have been tested against fixtures and a local fake server, not live provider accounts; model availability depends on the provider and account.

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

Open **Models** to manage connections. Ollama (`http://127.0.0.1:11434`) and LM Studio / llama.cpp (`http://127.0.0.1:1234/v1`) are preconfigured. Add OpenAI, Anthropic, Gemini, DeepSeek, or any OpenAI-compatible endpoint (for example `https://openrouter.ai/api/v1`) with your own key. Each connection shows whether it is offline, rejected the key, has the wrong address, or has no models. Listing models does not prove a model can run; the first chat does.

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
| `pnpm -r test` | Run server and web unit tests (Vitest) |
| `pnpm lint` | Run the existing source emoji policy check |

Run `pnpm build` before `pnpm start`. The lint command is not a complete ESLint or security audit. Unit tests cover the destination policy, model discovery per provider, stream line reassembly, and the browser storage migration.

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

Playwright starts local web/backend processes as needed. Tests use isolated browser contexts and do not require real API keys or a running model; discovery and runs are served from fixtures. They cover backend health, thread persistence, empty event history, offline versus empty connections, adding a custom endpoint through to a streamed answer, and hosted providers without a key.

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

Threads, settings, connections, and analytics live in browser IndexedDB. API keys are kept for the current tab session unless you tick **Remember this key on this device**, which stores them unencrypted in that browser profile. Keys saved by earlier versions were migrated as remembered keys; use **Forget key** to remove one. Keys are sent to the local backend in request bodies, never in URLs.

Requests to an online connection send your messages through the local backend to that provider. Hosted providers are pinned to their official endpoints. Custom endpoints must use https unless they are on this machine. The document agent runs only on models on this machine; documents are never sent to remote endpoints. Web search also uses external services.

Do not commit keys or personal conversation exports.

## Repository

- `packages/web`: React, Vite, Zustand, and Dexie frontend.
- `packages/server`: Express routes, provider adapters, local queue, and metrics.
- `packages/types`: shared TypeScript contracts.
- `tests/browser`: browser regression tests.
- `plan/implementation-plan.md`: current workbench plan.
- `plan/baseline.md`: setup and validation evidence.

## License

[MIT](LICENSE).
