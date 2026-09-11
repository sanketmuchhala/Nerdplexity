# Nerdplexity

A local-first model workbench for connecting local runtimes and online providers with your own API keys.

The project is being developed toward chat, files, model comparisons, and optional tools. See the [implementation plan](plan/implementation-plan.md) for the agreed scope and delivery phases.

## Current state

The app has browser-persisted threads, a connections-based model catalog, streaming chat for every connection type (Ollama, OpenAI-compatible endpoints, OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Groq), free-use controls, optional bounded tools, run history, and analytics pages. The chat workbench supports inline model switching, reusable model/settings presets, per-thread system instructions, explicit context budgets, request previews, immutable run snapshots, branches, regeneration, portable thread export/import, bounded text/code and compatible-model image attachments, search, light/dark themes, and responsive keyboard-accessible dialogs.

The Models page can stream Ollama pull progress and remove an installed model. Compare sends one frozen context snapshot to two explicitly selected models through the normal run engine, saves both results, labels measured and estimated metrics, and can continue either result in chat.

Tools are off by default and enabled per thread from the composer: **Calculator** (exact arithmetic computed by the app, available on any model) and **Documents** (search and read your Workspace documents, only on models on this machine). Tool calls stream through the same run engine for every provider, are limited to 6 model steps and 12 tool calls, and each call's exact input and result is shown with the answer and in Run history, separate from the model's text. No tool changes anything outside the app. Online retrieval and MCP are planned work.

Provider adapters have been tested against recorded-format fixtures and a local fake server, not live provider accounts; model availability depends on the provider and account.

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

To run a second checkout beside another, give it different ports: `WEB_PORT=5273 PORT=5274 pnpm dev`.

Open **Models** to manage connections. Ollama (`http://127.0.0.1:11434`) and LM Studio / llama.cpp (`http://127.0.0.1:1234/v1`) are preconfigured. Add OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Groq, or any OpenAI-compatible endpoint with your own key. Each connection shows whether it is offline, rejected the key, has the wrong address, or has no models, plus the rate-limit allowance the provider last reported. Listing models does not prove a model can run: use **Check** on a model card to send one short prompt.

## Free use

Each model shows what is known about its cost: **On this machine** (no hosted fee), **Free model** (the provider's catalog lists it at $0, as OpenRouter does), **Free plan** (you marked the account as having no billing enabled), a catalog price, or **Price unknown**. Nerdplexity cannot read billing settings; the account billing choice on a connection is your statement.

Turn on **Free only** in Models to run only models in the first three groups. Anything else, including a model ID typed by hand, is blocked before it is sent, with two choices: pick a free model, or allow charges for that thread. When a free model hits its limit, Nerdplexity suggests other free models; it never switches models or providers on its own.

Provider notes: OpenRouter free models are limited per minute and per day, and a negative balance blocks them too. Groq's free plan has per-model request and token limits. On Gemini's free tier, Google may use your prompts to improve its products, and free availability varies by model.

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

Run `pnpm build` before `pnpm start`. The lint command is not a complete ESLint or security audit. Unit tests cover the destination policy, model discovery and streaming per provider, the run engine (ordering, replay, idempotency, cancellation), stream reassembly, and the browser storage migration.

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

Playwright starts the backend, Vite, and a fake OpenAI-compatible provider (`tests/fixtures/fake-provider.mjs`). No API keys or local models are needed. Tests cover connections and discovery states, free-only blocking and the allow-charges override, free alternatives after a rate limit, billing statements, model checks, provider quota display, streaming and interruption behavior, inline model switching, settings snapshots and retries, presets, branches, explicit context trimming, safe thread import/export, attachments, identical comparison context, saved-result continuation, Ollama management controls, calculator and document tool loops with malformed tool arguments, theme persistence, dialog focus, mobile navigation, and responsive layouts.

Playwright does not reuse servers that are already running, because a server on the same port may belong to another checkout. Set `PW_REUSE=1` to reuse your own running dev servers, or use different ports: `WEB_PORT=5273 PORT=5274 pnpm test`.

With `pnpm dev` already running, capture the UI using synthetic events:

```sh
node scripts/capture-baseline.mjs
# Or use installed Chrome:
PLAYWRIGHT_CHANNEL=chrome node scripts/capture-baseline.mjs
```

Captures are written to `docs/screenshots/baseline/`. See [baseline notes](plan/baseline.md) for results and known gaps.

## How runs work

Sending a message starts a run on the local backend, which streams events to the browser. A run continues if the page reloads; the reloaded page reattaches and shows the rest of the answer. A run with no page attached for 60 seconds is canceled. **Stop** cancels the request to the model. If a run fails, stops, or is lost, the partial answer is kept and labeled. **Retry** starts a new attempt without repeating your message. Nerdplexity resends a request on its own only when the model never started: a rate limit that asks to wait 10 seconds or less (at most twice), or a model that rejects the temperature setting. Both are shown in the chat. Longer waits are shown with the time to wait.

Run history records queue time, time to first text, total time, reported token usage, finish reason, errors, and reasoning when the model reports it.

## App routes

- `/`: landing page.
- `/app`: chat and settings.
- `/app/models`: model catalog and Ollama management.
- `/app/connections`: local runtime and hosted provider connections.
- `/app/workspace`: persistent text documents for the Documents tool.
- `/app/runs`: run history.
- `/app/compare`: persisted side-by-side model comparisons.
- `/app/analytics`: analytics navigation.
- `/app/analytics/dashboard`: metrics.
- `/app/analytics/events`: event history.
- `/app/analytics/benchmark`: redirects to `/app/compare`.

## Data and credentials

Threads, attachments, comparisons, settings, connections, and analytics live in browser IndexedDB. API keys are kept for the current tab session unless you tick **Remember this key on this device**, which stores them unencrypted in that browser profile. Keys saved by earlier versions were migrated as remembered keys; use **Forget key** to remove one. Keys are sent to the local backend in request bodies, never in URLs.

Text/code attachments are limited to 100 KB each. Images are limited to PNG, JPEG, WebP, or GIF, 2 MB each and four per thread; all attachments together are limited to 5 MB. Images can be sent only when the selected catalog entry confirms vision support. Attachments are visible and removable before a run. Thread and comparison exports include their source context but omit credentials and connection destinations.

Requests to an online connection send your messages through the local backend to that provider. Hosted providers are pinned to their official endpoints. Custom endpoints must use https unless they are on this machine. Document tools run only on models on this machine; documents are never sent to remote endpoints. Web search also uses external services.

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
