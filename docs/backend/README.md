# Nerdplexity backend guide

This documentation explains the current Nerdplexity backend from first principles. It is written for someone who can read basic TypeScript but has not worked on a model harness before.

The most important idea is that Nerdplexity is **not an AI model**. It is a harness around models. The harness validates a request, chooses the correct provider protocol, streams model output, optionally runs a small set of tools, records ordered events, and lets the browser reconnect or cancel.

## Start here

Read these pages in order if the backend is new to you:

1. [Architecture](architecture.md) — processes, modules, dependencies, and deployment shapes.
2. [Run harness](run-harness.md) — the core execution lifecycle, streaming, replay, queueing, and cancellation.
3. [Providers and model discovery](providers-and-models.md) — how one internal request becomes Ollama, OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, or Groq traffic.
4. [Tools](tools.md) — the bounded agent loop, calculator, document retrieval, and Exa web search.
5. [API reference](api-reference.md) — every active HTTP endpoint and event payload.
6. [Security and data](security-and-data.md) — keys, documents, origin checks, destination restrictions, and known limits.
7. [Development and testing](development.md) — setup, debugging paths, tests, and safe extension points.

## The 30-second mental model

```mermaid
flowchart LR
    User[User] --> Browser[React browser app]
    Browser -->|start run| API[Express API]
    API --> Registry[Run registry]
    Registry --> Adapter[Provider adapter]
    Adapter --> Model[Local or hosted model]
    Model -->|stream| Adapter
    Adapter -->|normalized events| Registry
    Registry -->|replay plus live NDJSON| Browser
    Adapter -. tool calls .-> ToolLoop[Bounded tool loop]
    ToolLoop -. results .-> Adapter
```

The browser sends a model choice explicitly. The backend does not guess a provider from the model name. A run receives a UUID, emits numbered events, and ends exactly once as completed, failed, or canceled.

## Beginner glossary

| Term | Meaning in Nerdplexity |
| --- | --- |
| **Backend** | The Express process in `backend/`. It accepts HTTP requests and talks to model services. |
| **Harness** | The orchestration layer around a model: lifecycle, transport, tools, limits, errors, replay, and cancellation. |
| **Provider** | A service or runtime that performs inference, such as Ollama, OpenAI, or Anthropic. |
| **Connection** | A user-configured route to a provider. It contains a kind, optional base URL, and optional key. |
| **Target** | The per-request connection data after the backend validates and resolves it. |
| **Adapter** | Code that converts Nerdplexity's common request/events into one provider's wire format and back. |
| **Run** | One attempt to get an answer from one model using one immutable request snapshot. |
| **Run registry** | The in-memory owner of active/recent runs, ordered events, cancellation, and replay. |
| **NDJSON** | Newline-delimited JSON: one complete JSON object per line. Nerdplexity uses it for browser event streams. |
| **SSE** | Server-Sent Events. Several providers stream records prefixed with `data:`; the backend parses them but exposes NDJSON to its own browser client. |
| **Delta** | A small piece of generated answer text. Deltas are appended to form the answer. |
| **Tool loop** | A bounded conversation in which a model asks the application to run an allowed function and receives the result. |
| **Idempotency key** | A client-generated key that makes a retried start request return the existing run instead of starting a duplicate. |
| **Replay** | Sending events the browser missed, beginning after its last sequence number. |

## Source map

```text
backend/
├── env.sample                  # Example server environment
├── package.json                # Backend scripts and dependencies
└── src/
    ├── server.ts               # Loads environment and starts listening
    ├── app.ts                  # Builds and wires the Express application
    ├── middleware/
    │   ├── origins.ts          # Browser-origin policy
    │   └── errors.ts           # Last-resort safe error responses
    ├── routes/
    │   ├── runs.ts             # Start, follow, and cancel runs
    │   └── models.ts           # Ollama pull and delete routes
    ├── queue/
    │   └── localQueue.ts       # One-at-a-time execution for local models
    └── runtime/
        ├── runs.ts             # Run state machine, event buffer, replay
        ├── adapters.ts         # All live streaming provider adapters
        ├── discovery.ts        # Provider-specific model catalog discovery
        ├── destinations.ts     # URL, key, and local/remote policy
        ├── toolLoop.ts         # Multi-step model/tool orchestration
        ├── tools.ts            # Built-in tool registry and execution limits
        ├── webSearch.ts        # Exa search client and result normalization
        ├── streams.ts          # Chunk-safe line decoder
        └── local.ts            # Older non-streaming local compatibility helper

shared/src/
├── backend.ts                  # Health response contract
├── connections.ts              # Connection and model catalog contracts
└── runs.ts                     # Run requests, events, errors, tools, timing
```

Every production backend module has a focused test beside it except `server.ts`, `queue/localQueue.ts`, and the retained `runtime/local.ts` compatibility helper. Higher-level run tests exercise queue integration.

## What is authoritative

Use the following order when documentation and code appear to disagree:

1. Shared contracts in `shared/src/` define the browser/server boundary.
2. Validation and behavior in `backend/src/` define what actually runs.
3. Tests beside those modules capture expected edge cases.
4. This guide explains that implementation.
5. Files in `plan/` include history and future ideas; they are not necessarily implemented behavior.

## Current boundaries

The current backend deliberately stays small:

- It does not store conversations, files, presets, or run history in a database. Those live in browser IndexedDB.
- It keeps active and recently finished run events only in process memory. A backend restart loses them.
- It has no server accounts, authentication, multi-user ownership, or distributed workers.
- It can run four read-only tools: calculator, document search, document read, and Exa web search.
- It cannot execute shell commands, write files, open arbitrary URLs, or use MCP.
- It serializes local model runs to reduce memory contention. Remote runs execute concurrently.
- A hosted backend refuses local/private runtime targets and disables Ollama installation/removal.

These are design facts, not accidental omissions. Read [Security and data](security-and-data.md) before expanding any of them.
