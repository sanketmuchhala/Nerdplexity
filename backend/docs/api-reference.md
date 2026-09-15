# Backend API reference

[Back to the backend documentation index](README.md)

Default local base URL: `http://127.0.0.1:5174`.

During frontend development, Vite proxies `/v1` to this server. A separately deployed frontend uses its `VITE_API_URL` build setting.

## 1. Common behavior

- API request/response bodies are JSON unless an endpoint says NDJSON.
- JSON requests are limited to 10 MB.
- API keys belong in JSON bodies, never query strings.
- Unknown `/v1/*` routes return `404 { "error": "API route not found." }`.
- Browser requests need an allowed `Origin`; command-line requests without `Origin` are allowed.
- Local mode uses the built-in local owner. Hosted mode requires a Better Auth bearer session and scopes saved data, Bench results, and runs to that user.
- Examples use placeholders. Never paste real keys into committed files or shell history you plan to share.

## 2. Endpoint summary

| Method | Path | Purpose | Hosted mode |
| --- | --- | --- | --- |
| GET | `/health` | Backend status | Available |
| GET | `/v1/health` | Same status under the API prefix | Available |
| Any | `/v1/auth/*` | Better Auth sign-up, sign-in, sign-out, and session routes | Hosted only |
| GET | `/v1/account` | Current owner/account | Available; auth required when hosted |
| Various | `/v1/conversations/*`, `/v1/documents/*` | Owner-scoped threads, messages, attachments, and workspace documents | Available |
| GET | `/v1/conversations/:id/export` | Thread export including saved PDF originals | Available |
| GET, PUT | `/v1/conversations/:id/attachments/:attachmentId/pdf` | Fetch or restore an original PDF as `{pdfBase64}`; owner-scoped, maximum 20 MB decoded | Available |
| Various | `/v1/run-records/*` | Durable run history and completion claims | Available; owner-scoped |
| Various | `/v1/connections/*`, `/v1/presets/*`, `/v1/comparisons/*`, `/v1/settings` | Saved workspace records without keys | Available; owner-scoped |
| POST | `/v1/models/discover` | Validate a target and list models | Available; private targets refused |
| POST | `/v1/runs` | Validate and start one model attempt | Available; private targets refused |
| GET | `/v1/runs/:id/events` | Replay/follow ordered run events | Available |
| POST | `/v1/runs/:id/cancel` | Cancel queued/running work | Available |
| GET | `/v1/bench/suite` | Bench categories, sources, and licenses | Available |
| POST | `/v1/bench` | Start a Bench job (followed and canceled through `/v1/runs/:id`) | Available; private targets refused |
| GET | `/v1/bench/results` | Pass counts per model and category, and recent answers | Available |
| DELETE | `/v1/bench/results` | Delete all results, or one model's (`{ connectionId, model }`) | Available |
| POST | `/v1/agent/specialists` | The top models per kind of task for a list of free models ([Free Agent](free-agent.md#12-api-contract)) | Available; private targets refused |
| POST | `/v1/models/ollama/pull` | Pull an Ollama model with progress | Disabled |
| DELETE | `/v1/models/ollama` | Delete an Ollama model | Disabled |

When local model routes are disabled, they fall through to the normal JSON API 404.

## 3. Health

### `GET /health` and `GET /v1/health`

No request body. Example response:

```json
{
  "status": "ok",
  "timestamp": "<ISO-8601 timestamp>",
  "hosted": false,
  "originAllowed": true,
  "features": {
    "ollamaManagement": true
  }
}
```

| Field | Meaning |
| --- | --- |
| `hosted` | Whether the app was built in hosted deployment mode |
| `originAllowed` | Whether the request's browser origin may use protected endpoints |
| `ollamaManagement` | Whether pull/delete routes are mounted |

Health intentionally permits cross-origin reads. This lets a hosted frontend distinguish "backend down" from "backend reachable, but this site is not allowed."

```sh
curl http://127.0.0.1:5174/v1/health
```

## 4. Model discovery

### `POST /v1/models/discover`

Request:

```json
{
  "target": {
    "kind": "ollama",
    "baseURL": "http://127.0.0.1:11434"
  }
}
```

Hosted example:

```json
{
  "target": {
    "kind": "openai",
    "apiKey": "<key supplied at runtime>"
  }
}
```

Success response:

```json
{
  "ok": true,
  "execution": "local",
  "models": [
    {
      "id": "example:latest",
      "displayName": "example:latest",
      "capabilities": { "tools": true, "vision": false },
      "contextLength": 32768,
      "sizeBytes": 4500000000,
      "details": "7B · Q4_K_M · llama",
      "loaded": false,
      "pricing": "local",
      "source": "discovered"
    }
  ],
  "host": {
    "platform": "darwin",
    "arch": "arm64",
    "memory": 17179869184,
    "cpus": 8
  },
  "checkedAt": 1789300000000
}
```

`host` is included only for targets classified as local. Individual model fields are omitted when the provider does not report them; capability `null` means unknown.

Discovery failure is still an HTTP-successful, typed result:

```json
{
  "ok": false,
  "error": {
    "category": "offline",
    "message": "Nothing is answering at this address. Start the runtime, then refresh."
  },
  "checkedAt": 1789300000000
}
```

Possible discovery categories are `offline`, `auth`, `not-found`, `rate-limited`, `timeout`, `invalid-response`, `invalid-destination`, and `unknown`.

## 5. Start a run

### `POST /v1/runs`

Minimal local request:

```json
{
  "idempotencyKey": "example_run_12345",
  "target": {
    "kind": "ollama",
    "baseURL": "http://127.0.0.1:11434"
  },
  "model": "example:latest",
  "messages": [
    { "role": "user", "content": "Explain event replay simply." }
  ],
  "settings": {
    "temperature": 0.7,
    "maxTokens": 2048,
    "numCtx": 8192
  }
}
```

Full request shape:

```ts
interface RunStartRequest {
  idempotencyKey: string;
  target: {
    kind: 'ollama' | 'openai-compatible' | 'openai' | 'anthropic' |
          'gemini' | 'deepseek' | 'openrouter' | 'groq';
    baseURL?: string;
    apiKey?: string;
  };
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string | Array<
      | { type: 'text'; text: string }
      | { type: 'image'; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string }
    >;
  }>;
  settings?: {
    temperature?: number;
    maxTokens?: number;
    numCtx?: number;
  };
  tools?: Array<'calculator' | 'search_documents' | 'read_document' | 'web_search'>;
  documents?: Array<{ id: string; title: string; content: string }>;
  search?: { provider: 'exa'; apiKey: string };
}
```

Rich content arrays are permitted only on user messages.

New-run response: HTTP `201`.

```json
{ "runId": "4cc86d67-f743-4ade-98d0-089a91c47a37", "existing": false }
```

Repeated retained idempotency key: HTTP `200` with the original ID and `existing: true`.

Validation errors return HTTP `400`, for example:

```json
{ "error": "Document tools run only on models on this machine. Documents are not sent to remote endpoints." }
```

Starting a run returns before generation finishes. Follow the event endpoint immediately.

### Tool-enabled example

```json
{
  "idempotencyKey": "example_tools_12345",
  "target": {
    "kind": "ollama",
    "baseURL": "http://127.0.0.1:11434"
  },
  "model": "tool-model:latest",
  "messages": [
    { "role": "user", "content": "What does the launch note decide?" }
  ],
  "tools": ["search_documents", "read_document"],
  "documents": [
    { "id": "doc-1", "title": "Launch note", "content": "The release decision is Friday." }
  ]
}
```

### Web-search example

```json
{
  "idempotencyKey": "example_search_12345",
  "target": {
    "kind": "openrouter",
    "apiKey": "<model provider key>"
  },
  "model": "example/model",
  "messages": [
    { "role": "user", "content": "Find the latest release information." }
  ],
  "tools": ["web_search"],
  "search": {
    "provider": "exa",
    "apiKey": "<Exa key supplied at runtime>"
  }
}
```

The two keys have different scopes and are not placed in events.

With `"search": { "provider": "exa", "apiKey": "…", "auto": true }` the `web_search` tool is not needed: the server searches once before the model answers when the latest message needs current information, and shows it as a `tool` event at step 0 with ID `web_auto` ([Tools, automatic web search](tools.md#automatic-web-search)).

### Free Router example

Instead of `target` and `model`, a run may send `route`: free models across up to 12 connections (200 models), each connection's key sent once. The server chooses the model (`backend/src/runtime/router.ts`).

```json
{
  "idempotencyKey": "example_route_12345",
  "route": {
    "strategy": "free",
    "connections": [
      { "id": "openrouter", "target": { "kind": "openrouter", "apiKey": "<key>" } },
      { "id": "lmstudio", "target": { "kind": "openai-compatible", "baseURL": "http://127.0.0.1:1234/v1" } }
    ],
    "models": [
      { "connectionId": "openrouter", "model": "meta-llama/llama-3.3-70b-instruct:free", "capabilities": { "tools": true, "vision": false }, "contextLength": 131072 },
      { "connectionId": "lmstudio", "model": "qwen2.5-7b-instruct" }
    ]
  },
  "messages": [{ "role": "user", "content": "Explain recursion briefly." }]
}
```

Every connection passes the same destination policy as `target`. The web app lists only models it has verified as free (on this machine, catalog $0, or an account marked as having no billing); the server does not re-check prices. With document tools on, only models on this machine are kept. How the router chooses:

1. Classify the latest message (code, math, reasoning, writing, structured output, general) and what it needs (images, tools, estimated tokens).
2. Leave out models that report no image or tool support, whose context is too small, or that are cooling down after a failure.
3. Rank by parameter count read from the model ID, task fit (coding or reasoning models), tool support, and this server's recent success rate and latency for the model. `openrouter/free` and `openrouter/auto` go last.
4. Send to the best model with short rate-limit waits turned off. If it fails with quota, unavailable, transport, timeout, invalid request, context, or auth before any text, reasoning, or tool call, try the next one (at most 4). A refusal is never routed around, and once any output was shown the run stays on that model.

Rate limits put a model (or, for account-wide limits such as OpenRouter's free-model quota and bad keys, every model on that account) on cooldown until the provider's reset. Health is kept in memory per user, provider, address, and key hash.

### Free Agent example

`"strategy": "agent"` runs the Free Agent on the same route ([Free Agent](free-agent.md), [architecture](free-agent-architecture.md)). The optional `route.agent` carries the user's settings; every field is optional, and any choice that does not name a model in `route.models` is dropped rather than rejected:

```json
"route": {
  "strategy": "agent",
  "connections": [ … ],
  "models": [ … ],
  "agent": {
    "behavior": "auto | quick | thorough",
    "drafts": 2,
    "writer": { "connectionId": "openrouter", "model": "meta-llama/llama-3.3-70b-instruct:free" },
    "planner": { "connectionId": "openrouter", "model": "qwen/qwen3-32b:free" },
    "drafters": [{ "connectionId": "openrouter", "model": "google/gemma-3-27b-it:free" }],
    "specialists": { "code": { "connectionId": "openrouter", "model": "qwen/qwen3-coder:free" } }
  }
}
```

The run then reports `agent` step events and ends with `completed.agent` (section 6).

## 6. Follow and replay events

### `GET /v1/runs/:id/events?after=N`

`after` defaults to `0` and must be a non-negative integer. The response content type is `application/x-ndjson`. Each line is one `RunEnvelope`.

```sh
curl -N 'http://127.0.0.1:5174/v1/runs/<run-id>/events?after=0'
```

Example stream:

```ndjson
{"v":1,"runId":"abc","seq":1,"ts":1789300000000,"event":{"type":"queued","position":0}}
{"v":1,"runId":"abc","seq":2,"ts":1789300000010,"event":{"type":"started"}}
{"v":1,"runId":"abc","seq":3,"ts":1789300000100,"event":{"type":"delta","text":"Hello"}}
{"v":1,"runId":"abc","seq":4,"ts":1789300000200,"event":{"type":"completed","usage":{"prompt_tokens":10,"completion_tokens":1,"total_tokens":11},"finishReason":"stop","timing":{"queuedMs":10,"ttftMs":90,"durationMs":200}}}
```

The server replays retained events with `seq > after`, then keeps the response open for live events. It closes after a terminal event.

Errors:

| HTTP | Code | Meaning |
| ---: | --- | --- |
| 400 | — | `after` is invalid |
| 404 | `unknown-run` | Registry no longer contains the run |
| 410 | `replay-unavailable` | Needed early events fell out of the bounded buffer |

### Event catalog

| Event type | Important fields | Meaning |
| --- | --- | --- |
| `queued` | `position` | Run exists and may be waiting for the local queue |
| `started` | — | Executor began; local queue wait ended |
| `status` | `message` | Visible retry, tool-step, or parameter notice |
| `delta` | `text` | Answer text to append |
| `reasoning` | `text` | Provider-exposed reasoning text to append |
| `quota` | `quota`, `connectionId` on routed runs | Rate-limit snapshot from response headers |
| `tool` | call ID/name/input/output/step/status/duration/source | Tool progress and outcome |
| `route` | attempt/connectionId/model/status (`trying`, `failed`)/reason/category | Free Router sent the request to a model, or that model failed before answering |
| `model` | model, provider | The concrete model answering, reported by OpenRouter's stream (for `openrouter/free`, the model its router picked) |
| `agent` | id, role, status, reason, connectionId, model, mode, task, kind, text, reasoning, durationMs | A Free Agent step started, switched model, finished, or failed ([Free Agent, section 12](free-agent.md#12-api-contract)) |
| `agent_output` | id, channel (`text` or `reasoning`), text | Part of a Free Agent step's output or reasoning, live; appended to the step with that id |
| `completed` | usage/finishReason/loadMs/route/agent/timing | Successful terminal event; `route` names the model that answered a routed run, `agent` how a Free Agent run went and who wrote the answer |
| `failed` | structured `error`, timing | Failed terminal event |
| `canceled` | reason, timing | Canceled terminal event |

Terminal events are mutually exclusive.

## 6a. Bench

`POST /v1/bench` sends graded questions from `backend/bench/suite.json` (see its README for datasets and licenses) to the chosen models and saves every graded answer for the user.

```json
{
  "idempotencyKey": "bench_12345678",
  "connections": [{ "id": "openrouter", "target": { "kind": "openrouter", "apiKey": "<key>" } }],
  "models": [{ "connectionId": "openrouter", "model": "meta-llama/llama-3.3-70b-instruct:free" }],
  "categories": ["code", "math", "instructions", "tools", "facts"],
  "perCategory": 3
}
```

The response is `{ runId, existing, total }`. The job runs in the same registry as chat runs, so `GET /v1/runs/:id/events` streams it and `POST /v1/runs/:id/cancel` stops it; its time limit is 3 hours instead of 10 minutes. Each graded item arrives as a `bench` event with the saved `result` and `done`/`total`; skipped requests arrive as a `bench` event with `skipped`, plus a `status` explaining why.

- Up to 30 models and 12 connections, 1–20 items per category; only connections a model uses are contacted.
- Requests to one connection go one at a time, spaced about 10% under the provider's documented free per-minute limit (OpenRouter 20, Groq 30, Gemini 10, Cerebras 5, SambaNova 20, Mistral and Hugging Face 60, others 20; none for models on this machine, which share the local queue). Every item goes to every model before the next item.
- A rate limit of 60 s or less is waited out once; a longer one skips the model, and an account-wide limit or rejected key skips the connection. Rate limits are never recorded as answers. Other failed requests are saved as `error` (not counted for or against quality), and three in a row skip the model. A refusal is a failed answer.
- Grading is deterministic: the number on the "Answer:" line (GSM8K), the returned Python literal (CRUXEval; model code is never run), IFEval's strict instruction checks, BFCL's argument matching, and SQuAD's normalized span match.

The Free Router reads `GET /v1/bench/results`' scores for the user at the start of each routed run. For each task kind it pools the matching categories (code; math; math and facts for reasoning; instructions for writing and structured output; facts and instructions for general questions; plus tools when tools are on). With at least 3 graded answers it adds `graded / (graded + 3) × 1.2 × (smoothed pass rate − 0.5)` to the model's score, where the smoothed rate is `(passed + 1) / (graded + 2)`, and explains it in the route reason ("passed 3 of 3 Bench math tests").

## 7. Cancel a run

### `POST /v1/runs/:id/cancel`

No body is required.

```sh
curl -X POST http://127.0.0.1:5174/v1/runs/<run-id>/cancel
```

Response:

```json
{ "state": "canceled" }
```

If the run is already terminal, the response returns that terminal state. An unknown ID returns HTTP `404` with `code: "unknown-run"`.

Cancellation produces a `canceled` event with reason `user`. The other internal reasons are `no-client` and `timeout`.

## 8. Pull an Ollama model

### `POST /v1/models/ollama/pull`

Available only outside hosted mode.

```json
{
  "target": {
    "kind": "ollama",
    "baseURL": "http://127.0.0.1:11434"
  },
  "model": "example:latest"
}
```

Returns `application/x-ndjson` progress records such as:

```ndjson
{"status":"pulling manifest","done":false}
{"status":"downloading","total":1000,"completed":500,"digest":"sha256:...","done":false}
{"status":"success","done":true}
```

Fields are normalized and bounded. Closing the browser response aborts the upstream pull. If an error occurs after headers were sent, it appears as a terminal progress line with `status: "failed"`, `done: true`, and `error`.

## 9. Delete an Ollama model

### `DELETE /v1/models/ollama`

Available only outside hosted mode. The request body is the same target/model shape as pull.

```sh
curl -X DELETE http://127.0.0.1:5174/v1/models/ollama \
  -H 'Content-Type: application/json' \
  -d '{"target":{"kind":"ollama","baseURL":"http://127.0.0.1:11434"},"model":"example:latest"}'
```

Success:

```json
{ "ok": true }
```

The route forwards an upstream error status and a detail capped at 300 characters.

## 10. Generic parser and server errors

The last-resort error handler deliberately avoids raw error objects because body-parser errors can retain request bodies and keys.

| Situation | Status and response |
| --- | --- |
| Invalid JSON | `400 { "error": "The request body is not valid JSON." }` |
| Body larger than 10 MB | `413 { "error": "The request is too large." }` |
| Other Express 4xx parser error | matching status, `{ "error": "Invalid request." }` |
| Unexpected server error | `500 { "error": "Internal server error" }` |

Provider failures usually arrive as a `failed` run event because model execution starts asynchronously after `POST /v1/runs` has returned.
