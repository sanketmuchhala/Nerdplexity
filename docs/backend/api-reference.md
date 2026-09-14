# Backend API reference

Default local base URL: `http://127.0.0.1:5174`.

During frontend development, Vite proxies `/v1` to this server. A separately deployed frontend uses its `VITE_API_URL` build setting.

## 1. Common behavior

- API request/response bodies are JSON unless an endpoint says NDJSON.
- JSON requests are limited to 10 MB.
- API keys belong in JSON bodies, never query strings.
- Unknown `/v1/*` routes return `404 { "error": "API route not found." }`.
- Browser requests need an allowed `Origin`; command-line requests without `Origin` are allowed.
- There is no server authentication or user account boundary.
- Examples use placeholders. Never paste real keys into committed files or shell history you plan to share.

## 2. Endpoint summary

| Method | Path | Purpose | Hosted mode |
| --- | --- | --- | --- |
| GET | `/health` | Backend status | Available |
| GET | `/v1/health` | Same status under the API prefix | Available |
| POST | `/v1/models/discover` | Validate a target and list models | Available; private targets refused |
| POST | `/v1/runs` | Validate and start one model attempt | Available; private targets refused |
| GET | `/v1/runs/:id/events` | Replay/follow ordered run events | Available |
| POST | `/v1/runs/:id/cancel` | Cancel queued/running work | Available |
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
| `quota` | `quota` | Rate-limit snapshot from response headers |
| `tool` | call ID/name/input/output/step/status/duration/source | Tool progress and outcome |
| `completed` | usage/finishReason/loadMs/timing | Successful terminal event |
| `failed` | structured `error`, timing | Failed terminal event |
| `canceled` | reason, timing | Canceled terminal event |

Terminal events are mutually exclusive.

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
