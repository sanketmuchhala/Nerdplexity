# Backend architecture

## 1. System context

Nerdplexity is a pnpm workspace with three code packages:

- `frontend/`: React UI, browser persistence, context construction, and the run client.
- `backend/`: Express API, run harness, providers, discovery, tools, and local model management.
- `shared/`: type-only contracts imported by both sides as `@app/types`.

The browser owns durable user data. The backend owns temporary execution state and provider communication.

```mermaid
flowchart TB
    subgraph Browser[Browser process]
        UI[React workbench]
        Client[Run client]
        IDB[(IndexedDB)]
        UI --> Client
        UI <--> IDB
        Client <--> IDB
    end

    subgraph Server[Node.js backend process]
        Express[Express app]
        Routes[HTTP routes]
        Registry[In-memory RunRegistry]
        Adapters[Provider adapters]
        Tools[Tool registry]
        Express --> Routes
        Routes --> Registry
        Registry --> Adapters
        Adapters <--> Tools
    end

    Client <-->|HTTP and NDJSON| Routes
    Adapters --> Ollama[Ollama]
    Adapters --> Compatible[OpenAI-compatible server]
    Adapters --> Hosted[Hosted AI providers]
    Tools --> Exa[Exa search API]

    Shared[shared type contracts] -. compile-time .-> Client
    Shared -. compile-time .-> Routes
```

### Why browser persistence and server execution are separate

The browser is the user's workspace: it saves threads, documents, credentials according to the selected storage mode, input snapshots, partial output, and finished run history. The server receives only what a request needs. This avoids creating a server-side user database, but it also means a new browser profile does not share data and the server cannot restore a run after restarting.

## 2. Startup and middleware order

`backend/src/server.ts` is the process entry point. It loads `.env.local` before importing application modules because hosted mode and origin configuration read environment variables. It then calls `createApp()` and listens on the configured address.

```mermaid
sequenceDiagram
    participant Node
    participant Env as dotenv
    participant App as createApp
    participant Express

    Node->>Env: load .env.local
    Node->>App: createApp()
    App->>Express: helmet()
    App->>Express: public health routes
    App->>Express: CORS policy
    App->>Express: origin guard
    App->>Express: JSON parser, 10 MB
    App->>Express: run routes
    App->>Express: local model routes if not hosted
    App->>Express: discovery route
    App->>Express: API 404 and error handler
    App->>Express: static frontend and SPA fallback
    Node->>Express: listen(HOST, PORT)
```

Middleware order matters:

1. Helmet adds defensive HTTP headers.
2. `/health` and `/v1/health` are intentionally readable cross-origin so a separate frontend can diagnose an origin-policy failure.
3. CORS headers are added only for loopback or configured browser origins.
4. `originGuard` returns `403` before an untrusted browser page can reach a runtime or provider.
5. JSON bodies are limited to 10 MB.
6. API routes run.
7. Unknown `/v1/*` routes return JSON `404` instead of the React app.
8. The safe error handler avoids logging raw bodies that may contain API keys.
9. Production static files and the React Router fallback are last.

## 3. Internal module dependency map

```mermaid
flowchart TD
    Server[server.ts] --> App[app.ts]
    App --> Origins[middleware/origins.ts]
    App --> Errors[middleware/errors.ts]
    App --> RunRoutes[routes/runs.ts]
    App --> ModelRoutes[routes/models.ts]
    App --> Discovery[runtime/discovery.ts]

    RunRoutes --> Destinations[runtime/destinations.ts]
    RunRoutes --> Registry[runtime/runs.ts]
    RunRoutes --> Adapters[runtime/adapters.ts]
    RunRoutes --> ToolLoop[runtime/toolLoop.ts]

    Registry --> Queue[queue/localQueue.ts]
    Registry --> Adapters
    ToolLoop --> Adapters
    ToolLoop --> Tools[runtime/tools.ts]
    Tools --> WebSearch[runtime/webSearch.ts]

    ModelRoutes --> Destinations
    ModelRoutes --> Streams[runtime/streams.ts]
    Discovery --> Destinations
    Adapters --> Destinations
    Adapters --> Streams
    WebSearch --> Destinations

    Contracts[shared/src] -. types .-> App
    Contracts -. types .-> RunRoutes
    Contracts -. types .-> Registry
    Contracts -. types .-> Adapters
    Contracts -. types .-> Tools
```

### Responsibilities by layer

| Layer | Owns | Must not own |
| --- | --- | --- |
| App/middleware | HTTP hardening, origin policy, body parsing, route order, static serving | Provider-specific payloads |
| Routes | HTTP validation and translating requests into domain calls | Provider streaming details |
| Run registry | Lifecycle, sequence numbers, replay, timeout, queue, terminal state | HTTP response objects or provider JSON |
| Adapters | Provider request/response formats, streaming, usage, safe provider errors | Browser persistence or run ownership |
| Tool loop | Model → tool → model iteration and aggregate usage | Tool implementation details |
| Tool registry | Allowed functions, argument checks, timeouts, bounded output | Arbitrary model-selected code or destinations |
| Discovery | Model listing and descriptor normalization | Proving that a listed model will successfully run |
| Destination policy | Fixed provider endpoints and local/remote URL rules | Saving connections or keys |
| Shared package | Type contracts | Runtime logic |

## 4. The two execution shapes

### Local mode

Local mode is the default when `NERDPLEXITY_HOSTED` is unset. The server binds to `127.0.0.1` unless `HOST` overrides it. Ollama and loopback OpenAI-compatible endpoints may use HTTP. Local runs are serialized through one queue.

```mermaid
flowchart LR
    Browser -->|localhost:5174| Backend
    Backend -->|http://127.0.0.1:11434| Ollama
    Backend -->|http://127.0.0.1:1234/v1| LM[LM Studio or llama.cpp]
    Backend -->|HTTPS| Cloud[Hosted provider]
```

The runtime must be reachable from the machine running the backend. A browser's `localhost` and a remote server's `localhost` are not the same machine.

### Hosted mode

Set `NERDPLEXITY_HOSTED=1` for a remotely reachable backend. Its default bind address becomes `0.0.0.0`. Hosted mode:

- refuses loopback, literal private/reserved IPs, IPv6 literals, `.local`, and `.internal` custom targets;
- disables Ollama pull/delete endpoints;
- still allows official hosted providers and public HTTPS OpenAI-compatible endpoints;
- requires the deployed frontend origin in `ALLOWED_ORIGINS`.

```mermaid
flowchart LR
    HostedUI[Hosted frontend] -->|allowed origin| HostedAPI[Hosted backend]
    HostedAPI -->|HTTPS| Providers[Hosted providers]
    HostedAPI -- blocked --> Laptop[User laptop runtime]
    Evil[Unlisted browser origin] -- 403 --> HostedAPI
```

Hosted mode is a network safety policy, not user authentication. See [Security and data](security-and-data.md).

## 5. State ownership and lifetime

| Data | Owner | Lifetime |
| --- | --- | --- |
| Threads and messages | Browser IndexedDB | Durable in that browser profile |
| Connections | Browser IndexedDB | Durable in that browser profile |
| API keys | Browser session memory or optional device storage | Depends on user choice |
| Documents and attachments | Browser IndexedDB | Durable in that browser profile |
| Run input/output/history | Browser IndexedDB | Durable in that browser profile |
| Active run controller | Backend `RunRegistry` | Until terminal state or process restart |
| Ordered event replay buffer | Backend `RunRegistry` | In memory; bounded and temporary |
| Provider request/key | Active backend call closure | One discovery or run request |
| Local queue | Backend singleton | Process lifetime |

There is no backend database and no worker process. Horizontal scaling would break reconnect semantics unless run ownership and event storage were externalized or requests were pinned to one process.

## 6. Shared contracts

The `shared/src` files are the seam between frontend and backend:

- `connections.ts` defines connection kinds, targets, discovery results, model capabilities, pricing, and quota snapshots.
- `runs.ts` defines start requests, content parts, states, errors, timing, tools, and event envelopes.
- `backend.ts` defines health/capability reporting.

They are TypeScript-only. Runtime validation still happens in the route because a network client can send anything regardless of TypeScript.

## 7. Active versus retained compatibility code

`runtime/adapters.ts` is the production streaming path for all supported providers. `runtime/local.ts` is an older non-streaming helper retained in the tree, but no production backend module imports it. Do not build new harness work on `runtime/local.ts`; extend `adapters.ts`, the run engine, and their tests.

Similarly, planning documents may describe proposed routes or states that are not active. The endpoint list in [API reference](api-reference.md) is generated from the current Express wiring.
