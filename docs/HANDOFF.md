# Nerdplexity implementation handoff

Checkpoint: 2026-09-10. Repository: sanketmuchhala/Nerdplexity.
Branch: `codex/local-workspace`. Original base: `caefdbcf7b43fe88e1b34d645f672a9f037df170`.

## Read this first

The owner wanted a structured product and implementation plan for an ambitious local AI harness inspired by Odysseus. An earlier assistant started implementing before the owner reviewed that plan. This branch preserves that work for inspection; it does not represent an approved final architecture or a finished product. No separate repository was created in this checkout.

Start with this document and [ROADMAP.md](ROADMAP.md). The owner should review the direction before another broad implementation pass. Keep work bounded and report useful progress. Do not run long autonomous redesigns, delegate to agents, download models, or spend paid API credits without a request covering that work.

## Product goal

Make Nerdplexity a useful, polished local AI workspace and eventually an extensible harness: connect a runtime, choose a model, chat, use bounded tools, and inspect what happened. Nerdplexity is application/runtime orchestration software, not a trained model. Ollama, LM Studio, or llama.cpp performs inference.

Future, separate product surface: a community directory of legitimate free AI APIs and free tiers, supported by verified submissions and RSS updates. This is planned only. It must distinguish local inference, no-key services, free tiers, trials, and paid services. It must not promise unlimited free inference.

## Current architecture

- React + TypeScript + Vite frontend in `packages/web`.
- Express + TypeScript backend in `packages/server`.
- Shared package in `packages/types`; pnpm workspace.
- Dexie/IndexedDB stores conversations, settings, workspace documents, and run records in the browser.
- Local flow: browser -> Express `/v1/local/*` -> runtime on the app host -> NDJSON run events -> browser.
- Cloud flow: existing `/v1/chat` endpoint and existing provider adapters. The new UI consumes this response as JSON, not a live stream.
- The Express host must have access to the model runtime. A remote hosted frontend/backend does not automatically reach the user's laptop localhost.

## Implemented in source, not fully acceptance-tested

| Area | Files | Current behavior |
| --- | --- | --- |
| Workspace shell | `packages/web/src/workspace/Workspace.tsx`, `workspace.css`, `packages/web/src/App.tsx` | Chat, Models, Workspace, Run history, thread navigation, search palette, responsive CSS. `/` redirects to `/app`. Existing analytics routes remain. |
| Chat | `ChatWorkspace.tsx`, `useRun.ts`, `api.ts` in the workspace folder | Incremental local output, stop control, generation settings, thread export, visible document-tool results, partial-output persistence attempt. |
| Model connection | `Models.tsx`, `packages/server/src/runtime/local.ts` | Ollama model discovery and OpenAI-compatible model lists. Local endpoint configuration and model selection. No in-app model installer. |
| Runtime stream | `packages/server/src/runtime/streams.ts`, `local.ts`, `routes/localRuntime.ts` | Ollama NDJSON and OpenAI-style SSE parsing, event normalization, reported usage, duration/first-token timing, timeout, abort handling, existing local queue reuse. |
| Documents | `Documents.tsx`, `packages/web/src/lib/db.ts` | Import/edit/delete text, Markdown, CSV, JSON, or log files. Import limit 100 KB; content limits 20 documents, 100,000 characters each and 400,000 total. No PDF/OCR or embeddings. |
| Document agent | `packages/server/src/runtime/agent.ts` | Model tool loop with `search_documents` and `read_document`; at most 6 model steps and 12 tool calls. Search is lexical. Reads are paged at 6,000 characters. |
| Run history | `Runs.tsx`, `useRun.ts`, `db.ts` | Completed/stopped/failed records, available token counts, timing, tool arguments/results, saved output. UI and JSON export cover the most recent 100 runs. |
| Persistence | `db.ts`, `packages/web/src/state/chatStore.ts` | IndexedDB schema version 3, local runtime/model preferences, explicit conversation ID for writing replies, local-first defaults for new settings. |
| Compatibility | `packages/server/src/providers/local-ollama.ts` | Existing Ollama adapter uses shared runtime generation logic, replacing old low output-token caps. Legacy callers may still buffer the full response. |
| Local access checks | `packages/server/src/server.ts`, `routes/localMetrics.ts`, `runtime/local.ts` | Loopback bind by default, browser-origin filtering, restricted runtime URLs, redirect rejection, metrics request timeouts. These changes are not a complete security assessment. |
| Text rendering | `packages/web/src/lib/stripEmojis.ts` | Preserve Markdown/code whitespace instead of collapsing all whitespace. Existing emoji removal remains. |
| Workspace config | `pnpm-workspace.yaml` | An `allowBuilds.esbuild: false` entry was added earlier. Validate portability against the pinned package-manager version. |

## Verification performed at this checkpoint

- `pnpm typecheck`: PASS for types, server, and web.
- `pnpm build`: PASS for types, server, and web.
- Build reports an outdated Browserslist dataset and a main JavaScript bundle around 677 KB before gzip. These are warnings, not build failures.
- The execution environment used pnpm 11.19.0 through its wrapper; root `package.json` specifies pnpm 9.0.0. A fresh laptop install with the pinned version remains unverified.
- No runtime test suite was executed in this checkpoint. No dedicated test files were found in the package source scan; `orchestrator/spec.ts` is not evidence of executed tests.
- No successful real-model session, completed browser QA, provider compatibility matrix, migration test, or deployment is claimed.

Earlier chat updates mentioning browser checks or tests being underway are not proof they passed. Use the explicit results above.

## Known limits and review targets

1. The document agent calls non-streaming model completions per step, then emits its final answer as one delta. Ordinary local chat streams incrementally.
2. Tool calling depends on model and runtime support. LM Studio/llama.cpp compatibility is an implementation target, not a verified claim for every server/model.
3. Documents live in browser storage and are sent with a document-agent request to Express. The model receives the document inventory and retrieved passages. There is no durable server workspace, cross-device sync, vector store, or general filesystem tool.
4. Audit cloud-key persistence and existing security copy before making privacy claims. Existing settings/provider paths were retained, not comprehensively reviewed.
5. The new run path does not visibly emit the legacy PromptOps event records. Review analytics integration before describing old dashboards as complete for new runs.
6. Test offline/empty runtime, midstream disconnect, cancellation while queued, malformed payloads, history switching/deletion during generation, storage failure, and refreshing during a run. Run records are primarily saved at the end, not checkpointed throughout.
7. Audit origin/CORS behavior, accepted localhost ports, custom HOST settings, Docker addressing, and the Vite proxy. These are local-use defaults, not a multi-user deployment design.
8. Message limits count characters, not model tokens. Add model-aware context handling before large conversations and document workloads.
9. Review the substantial removal of legacy Ollama adapter behavior for regressions. Review old settings controls whose options are not propagated by the new runtime.
10. Model cards show app-host memory and runtime-reported metadata. They do not establish that a particular model fits the machine.
11. UI source is present but aesthetic quality, keyboard navigation, mobile layout, and accessibility still require browser review.

## Run on a laptop

After fetching this branch, install Node and the package manager specified by `package.json`, then run:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

Start an already installed local runtime and load a model that fits the laptop. In separate terminals from the repository root:

```sh
pnpm --filter @app/server dev
```

```sh
pnpm --filter @app/web dev
```

Open `http://localhost:5173/app`, choose Models, and connect. Defaults: Ollama `http://127.0.0.1:11434`; OpenAI compatible `http://127.0.0.1:1234/v1`. Backend default port: 5174.

The root `pnpm dev` also launches `ollama serve`; use separate package commands when Ollama already runs or when using another runtime. Resolve any localhost IPv4/IPv6 proxy mismatch if the UI fails to reach the backend. Production serving from the built server is a separate path requiring a smoke test.

## Other planning material

Existing `plan/nerdplexity.md` and `plan/phase2_nerdplexity.md` remain historical context. Their aspirations and README claims are not completion evidence. The roadmap below is the proposed continuation, pending owner review.

- [Proposed roadmap](ROADMAP.md)
- [Codex continuation prompt](CODEX_PROMPT.md)
- [Claude Code continuation prompt](CLAUDE_CODE_PROMPT.md)
