# Pending items

The single list of work that is not done, deferred, or waiting on a decision. The progress log in [implementation-plan.md](implementation-plan.md) stays the history of each phase; this file is the current to-do list. When an item is finished, move it to **Resolved** with the date and commit.

Last reviewed: 2026-09-14 (P11, Free Router).

## In progress

- **P11, Free Router and Bench** (2026-09-14, branch `claude/free-router`). Router, providers, and Bench done; see the progress log. Next in this track:
  - **Feedback and run history in ranking.** Bench results rank models now; explicit helpful/unhelpful feedback and routed-run outcomes are not used yet.
  - **Router health is in memory** and restarts empty with the server; persist it or derive it from run records.
  - **Bench jobs stop if the page is closed** for a minute (the run engine's no-client rule), and a reload does not reattach to a running job. Results saved so far are kept.
  - **The same model on several providers** (e.g. Llama 3.3 70B on Groq and Cerebras) is treated as separate models; grouping them would share Bench results and give more fallbacks (idea from the research).
  - **Reusing answers to repeated prompts** to save free quota (the research's semantic caching) is not built.
  - **Bench covers five categories.** Long-context, image input, and multi-turn tool use are not measured.
- **Default model** (2026-09-14, owner direction): the Free Router, not `openrouter/free`, whenever no model is chosen and it has a free model; shown with the Nerdplexity logo. Existing choices, including an earlier automatic `openrouter/free` default, are kept.
- **P12, memory.** A profile and remembered facts per user, retrieved into context, with embeddings in pgvector (the Railway Postgres template already includes it). Moved after the Free Router on 2026-09-14 at the owner's direction.

## Owner decisions

- **Documents stay local** (2026-09-11). Document tools run only on models on this machine and are not offered for online models. Since P10 the documents themselves are saved by the Nerdplexity server with the user's other data (on the user's computer, or in the hosted database).
- **Database and hosting** (2026-09-14). Postgres everywhere: PGlite locally, Railway Postgres (Hobby plan) when hosted. Real accounts when hosted; the local server has a single built-in owner. Browser data is imported automatically; `db:copy` moves local data to Railway.
- **Web search provider is Exa** (2026-09-11). Other providers can be added behind the same tool later.

## Deferred by the owner

- **MCP connections** (deferred 2026-09-11, "later"). Build only after the core tool contract is validated against the then-current MCP specification (plan section 7, P6).

## Open work

### Tools (P6)

- **Approval flow for tools with external effects.** No current tool changes anything outside the app, so `POST /v1/runs/:id/tool-decisions` and the `waiting_for_tool` state are not built. Required before adding any such tool.
- **Compare runs without tools.** Tool-enabled comparisons are not supported.
- **Custom endpoint pointed at OpenRouter.** Prices now come through (any remote catalog reporting `pricing.prompt`/`completion` is read, 2026-09-14), but `openrouter/free` is still only special-cased on the preset. The app should suggest the preset when a custom URL matches a hosted provider.
- **Citation style varies by model.** The live Nemotron answer cited with its own markers (`【1†L1-L4】`) instead of URLs despite the instruction; the tool activity still lists the real links. Consider numbering results and rendering citations.
- **Live tool-calling checks per provider.** Checked live only through OpenRouter's OpenAI-style route (Nemotron 3 Super free: calculator and web search). Native Anthropic, Gemini, Ollama, and other OpenAI-compatible servers are verified with fixtures only. Ollama streams tool calls only in versions that support it; models whose catalog reports tool support as unknown fail with a provider error if they reject tools.

### Workbench (P4)

- **Navigation differs from section 4.** The app has Chat, Models, Connections, Workspace, Run history, Compare; there is no separate Settings page.
- **No context compaction.** Over-limit context offers only omitting earlier turns, not summarizing them.
- **Owner visual review.** Screenshots at 390, 768, and 1440 px have been reviewed only by the implementing agents; P8 changed the whole look (black and green), so this review matters more now.
- **Model logos are a curated set.** 46 brands are mapped (`ModelLogo.tsx`); others show a lettered avatar. Add aliases as new providers appear.

### Files, local models, Compare (P5)

- **PDF/OCR and larger-document extraction** are not supported.
- **Real Ollama checks.** Pull cancellation, disk and runtime error messages, and `load_duration` reporting have not been checked against a real Ollama install.
- **Compare after reload.** A comparison still running when the page reloads is not reattached; its Run history records keep the engine's interrupted handling.
- **Image attachments are re-sent every turn** while they stay attached to a thread, which costs tokens on hosted models.

### Providers (P2–P3)

- **Live verification with real accounts** for Ollama, LM Studio, OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, and Groq. Use Check on each connection to record a result.
- **Anthropic and Gemini reasoning** is shown only when the provider sends it; the app does not request provider thinking settings.
- **OpenRouter credit status** (`/api/v1/key`) is not shown.
- **Anthropic rate-limit headers** (`anthropic-ratelimit-*`) are not parsed.
- **Runs are lost if the backend restarts.** This is by design; the client reports them as interrupted.

- **Providers not added** (2026-09-14): GitHub Models retired on 2026-07-30; Cloudflare Workers AI needs an account ID in its URL, so it works as a custom endpoint (`https://api.cloudflare.com/client/v4/accounts/<id>/ai/v1`) rather than a preset; NVIDIA NIM and Cohere's trial are finite or non-commercial. Together, DeepInfra, and Fireworks are credit trials only.
- **Day-level rate-limit headers** (SambaNova's `x-ratelimit-*-requests-day`) are not parsed; only per-minute headers are.
- **New providers checked with fixtures only.** Cerebras, Mistral, SambaNova, and Hugging Face follow their current API docs but have not been run with live keys; whether Cerebras accepts `stream_options` is unconfirmed (the adapter resends without it if rejected).

### Deployment

- **Deploy to Railway (owner).** Postgres from the pgvector template, the service from this repository, and the variables in the README's Deploying section. Not yet done or tested on Railway itself; the hosted mode, Postgres driver, and accounts are tested locally and in CI.
- **Set `VITE_API_URL` in Vercel** to the Railway address, add the Vercel address to `ALLOWED_ORIGINS` on Railway, then redeploy.
- **Hosted server limits.** Hostnames that resolve to private addresses (DNS rebinding) are not blocked, only literal addresses and local-only names. Sign-in rate limiting reads the visitor's address from `X-Real-IP`/`X-Forwarded-For` (set by Railway and Render); elsewhere all visitors share one limit.

### Accounts and data (P10)

- **Password reset and email verification** need an email provider (for example Resend). Until then the owner resets a password with `pnpm --filter @app/server user:password`.
- **GitHub or Google sign-in** is not built.
- **Remembered API keys are per browser, not per account.** They are keyed by connection ID; on a shared browser, a second account with a connection of the same fixed ID (for example `openrouter`) can use the first account's remembered key. Sign-out does not forget keys.
- **Only one browser's earlier data is imported per account.** Threads saved by earlier versions in a second browser stay in that browser (IndexedDB is never deleted).
- **The thread list loads every message** at startup, as the browser version did. Paginate before histories grow large.
- **No offline use or multi-device conflict handling.** The server is the single source of truth; changes wait for it.
- **PGlite serves one process.** Stop the local server before running `db:copy` against `backend/data`.

### Code health

- **LAN runtimes over plain http** are not allowed by the destination policy.

## Resolved

- P10 (2026-09-14): data moved to a server database (PGlite locally, Postgres when hosted) with accounts on hosted servers, which closes "anyone who knows the server's address can use it": hosted servers now require a session for data, runs, and discovery.
- Vercel Root Directory set to `frontend` by the owner (2026-09-13); production serves the web app.

- P8 (2026-09-12): the `codex/local-workspace` UI (black and green theme, model logos, list catalog, provider modal, logo-headed answers) merged into `codex/engine`, and the logo kit adopted. The other checkout's branch is now contained in `codex/engine`.
- P7 added canonical run measurements and release hardening (2026-09-12). P8.2 later removed the aggregate Analytics page while retaining useful per-run measurements in Run history.
- Unrouted legacy chat, provider, telemetry, PromptOps, static-score, and DuckDuckGo `/v1/chat` code removed (P7, 2026-09-12).
- Web search through Exa (P6.2, 2026-09-11), checked live. Hosted providers stream (P2). Emoji stripping of model output removed (P2). Document agent steps now stream through the tool loop (P6.1, `28cb36a`). Benchmark screen replaced by Compare (P5, `c79a8ce`).
