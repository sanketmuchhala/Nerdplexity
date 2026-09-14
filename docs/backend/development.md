# Backend development and testing

This page is the practical guide for running, debugging, testing, and extending the backend.

## 1. Requirements

- Node.js 18 or newer; CI uses Node 20.
- pnpm 9.0.0 is the pinned package manager.
- Ollama is optional unless testing a real local model.

From the repository root:

```sh
pnpm install --frozen-lockfile
```

If `pnpm` is unavailable, the root README includes an npm bootstrap command for the pinned version.

## 2. Run locally

Start backend and frontend together:

```sh
pnpm dev
```

Or start only the backend:

```sh
pnpm dev:server
```

Defaults:

- frontend: `http://127.0.0.1:5173`
- backend: `http://127.0.0.1:5174`
- health: `http://127.0.0.1:5174/v1/health`

The backend dev command uses `tsx watch src/server.ts`. The frontend Vite server proxies `/v1` to the backend, so browser code can use relative API paths.

To use Ollama, start the already-installed runtime separately:

```sh
pnpm dev:ollama
```

No model is downloaded automatically by normal backend startup.

## 3. Environment configuration

The server loads `.env.local` from the process working directory before creating the app.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5174` | Backend listening port; Vite also uses it as proxy target |
| `HOST` | `127.0.0.1` local, `0.0.0.0` hosted | Explicit listening interface override |
| `NERDPLEXITY_HOSTED` | unset/false | `1`, `true`, or `yes` enables hosted destination restrictions and disables Ollama management |
| `ALLOWED_ORIGINS` | empty | Comma-separated exact browser origins allowed in addition to loopback |
| `EXA_API_URL` | `https://api.exa.ai` | Operator-only Exa base, primarily used by tests |
| `WEB_PORT` | `5173` | Frontend dev port; read by Vite, not backend runtime |
| `VITE_API_URL` | same origin | Frontend build-time URL for a separately hosted backend |

The sample environment file is minimal and contains older comments about provider environment keys. Current provider and Exa keys are supplied by the browser per request; the backend does not read provider-key environment variables.

## 4. Production build

```sh
pnpm build
pnpm start
```

The workspace build compiles `shared`, `backend`, and `frontend`. `pnpm start` runs `backend/dist/server.js`. The backend serves `frontend/dist` and sends `index.html` for unmatched non-API GET requests.

If the frontend build is absent, the SPA fallback returns a small JSON message saying the API server is running.

## 5. Verification commands

From the repository root:

```sh
pnpm typecheck
pnpm -r test
pnpm build
pnpm lint
pnpm test
pnpm test:split
```

| Command | Coverage |
| --- | --- |
| `pnpm typecheck` | TypeScript across all workspace packages |
| `pnpm -r test` | Backend and frontend Vitest unit suites |
| `pnpm build` | Production TypeScript and Vite builds |
| `pnpm lint` | Current source policy/no-emoji checks; not a full security audit |
| `pnpm test` | Main Playwright browser suite |
| `pnpm test:split` | Separately configured frontend/backend deployment behavior |

CI runs all six after a frozen install and installs Chromium for Playwright.

Run the backend unit suite alone:

```sh
pnpm --filter @app/server test
```

Run one Vitest file during development:

```sh
pnpm --filter @app/server exec vitest run src/runtime/runs.test.ts
```

## 6. Backend test map

| Test file | What it proves |
| --- | --- |
| `app.test.ts` | Health, hosted capability reporting, origin behavior, API JSON 404 |
| `middleware/origins.test.ts` | Exact origin parsing and loopback rules |
| `middleware/errors.test.ts` | Malformed-body response and avoiding sensitive body logs |
| `runtime/destinations.test.ts` | Provider endpoint pinning, auth headers, URL rules, hosted private-target refusal, redaction |
| `runtime/discovery.test.ts` | Every provider's catalog mapping, safe failures, pricing/capabilities/filtering |
| `runtime/streams.test.ts` | Every-byte chunk splits, UTF-8 boundaries, CRLF, final line |
| `runtime/adapters.test.ts` | Streaming, usage, images, reasoning, retries, errors, partial responses, and provider-specific tool messages |
| `runtime/runs.test.ts` | Lifecycle, ordering, one terminal event, idempotency, cancellation, queueing, replay, routes, validation |
| `runtime/tools.test.ts` | Calculator grammar and tool success/error/denial/timeout/output/cancel behavior |
| `runtime/toolLoop.test.ts` | Multi-step calls, call IDs, limits, cancellation, usage aggregation |
| `runtime/webSearch.test.ts` | Fixed Exa request, result bounding, redaction, validation, timeout, prompt-injection instructions |
| `routes/models.test.ts` | Ollama management target/tag validation and progress normalization |

Tests use fake `fetch` implementations and recorded provider-shaped responses. They do not spend API credits or require Ollama. Real provider/runtime checks are still important because accounts and wire formats can change.

## 7. Debugging by symptom

### Browser says the backend is down

1. Open `/v1/health` directly.
2. Check that `PORT` matches the Vite proxy target.
3. If the response is HTML/non-JSON, the request may be reaching a static host rather than Nerdplexity.
4. For a separate frontend, confirm `VITE_API_URL` was set at build time.

### Browser says the origin is blocked

1. Inspect `originAllowed` in the health response.
2. Add the exact frontend origin, without a path, to `ALLOWED_ORIGINS`.
3. Restart the server after changing `.env.local`.

### Discovery says offline

1. Trace `routes/app → discovery → resolveTarget`.
2. Confirm the runtime is reachable from the backend host, not merely from the browser's machine.
3. For Ollama, use a loopback URL without `/api`.
4. For a custom compatible server, confirm its `/models` path below the configured base.

### A run starts but no answer appears

1. Inspect the saved run ID and request `/events?after=0`.
2. Check whether it is queued behind another local run.
3. Look for status, tool, quota, or reasoning events before the first text delta.
4. A `404` after restart means the browser must mark the run interrupted.
5. A `410` means the client fell behind the replay buffer.

### Output stops halfway

The adapter deliberately reports a dropped/malformed provider stream as a transport failure while preserving prior deltas. Inspect the terminal event and adapter fixture for that provider rather than treating partial output as completed.

### Tool mode fails immediately

Check in order:

1. The selected model catalog must not explicitly say tools are unsupported.
2. Document tools require a local target and at least one document.
3. Web search requires an Exa key.
4. Provider/tool-call support can still fail when capability is unknown; use a known tool-capable model.

## 8. Trace common code paths

### Chat generation

```text
frontend/useRun.ts
→ frontend/runClient.ts startRun
→ backend/routes/runs.ts validateRunRequest
→ backend/runtime/destinations.ts resolveTarget
→ backend/runtime/runs.ts RunRegistry.start/drive
→ backend/runtime/adapters.ts streamModel
→ provider
→ RunRegistry.append
→ GET /events
→ frontend/runClient.ts followRun
→ frontend/useRun.ts persistence/UI
```

### Tool generation

```text
routes/runs.ts executorFor
→ runtime/toolLoop.ts runWithTools
→ runtime/adapters.ts streamModel
→ model tool call
→ runtime/tools.ts executeTool
→ tool result message
→ streamModel again
```

### Model discovery

```text
POST /v1/models/discover
→ runtime/discovery.ts discover
→ runtime/destinations.ts resolveTarget
→ provider-specific list mapper
→ shared ModelDescriptor[]
```

## 9. Change guides

### Add a run event

1. Add the event variant to `RunEventPayload` in `shared/src/runs.ts`.
2. Decide whether it is lifecycle-owned by the registry or progress-owned by the executor.
3. Add it to `ProgressPayload` if executors emit it.
4. Emit it in the correct runtime layer.
5. Handle it in `frontend/src/workspace/useRun.ts` and persistence/export as needed.
6. Test ordering, replay, reconnect, and terminal interaction.

Never make an event contain keys or an unbounded payload.

### Add a provider

Follow the checklist in [Providers and model discovery](providers-and-models.md). Preserve explicit routing, official endpoint pinning, safe errors, cancellation, arbitrary chunk handling, images, tool calls, and truthful usage.

### Add an API route

1. Put narrow validation in a route module.
2. Keep provider protocol logic in the runtime layer.
3. Mount it before the `/v1` JSON catch-all.
4. Decide whether hosted mode should mount it.
5. Add origin/error tests and document it in [API reference](api-reference.md).

### Add a tool

Follow [Tools](tools.md). The current automatic loop is only appropriate for read-only/no-external-effect tools.

### Change run lifecycle behavior

Treat these as invariants unless deliberately redesigning the protocol:

- one executor per retained idempotency key;
- monotonic sequence numbers;
- exactly one terminal event;
- no output accepted after terminal state;
- reconnect does not repeat model work;
- cancellation reaches provider and tools;
- missing usage stays missing;
- partial output is not mislabeled success.

## 10. Code review checklist

- Is runtime validation present even when shared TypeScript types exist?
- Does the change preserve key redaction and avoid raw-body logging?
- Are output, input, loops, concurrency, and time bounded?
- Does it work for both local and remote execution classifications?
- Does hosted mode avoid private destinations and local-only features?
- Are provider quirks contained inside adapters/discovery?
- Does abort propagate through all asynchronous work?
- Are stream records safe across arbitrary byte boundaries?
- Are absent capabilities, timing, and usage represented as unknown/absent?
- Are tests deterministic and free of paid provider calls?
- Were API and architecture docs updated?

## 11. Known cleanup note

`backend/src/runtime/local.ts` contains an older non-streaming local helper and is not imported by the active production backend. The current harness path is `routes/runs.ts → runtime/runs.ts → runtime/adapters.ts`. Confirm all consumers before removing the compatibility file, and do that as a separate code-health change rather than while extending the harness.
