# Pending items

The single list of work that is not done, deferred, or waiting on a decision. The progress log in [implementation-plan.md](implementation-plan.md) stays the history of each phase; this file is the current to-do list. When an item is finished, move it to **Resolved** with the date and commit.

Last reviewed: 2026-09-12 (after P7 verification).

## In progress

- Nothing. P0–P7 are complete; use the release candidate and prioritize the open items from real workflows.

## Owner decisions

- **Documents stay local** (2026-09-11). Document tools run only on models on this machine and are not offered for online models.
- **Web search provider is Exa** (2026-09-11). Other providers can be added behind the same tool later.

## Deferred by the owner

- **MCP connections** (deferred 2026-09-11, "later"). Build only after the core tool contract is validated against the then-current MCP specification (plan section 7, P6).

## Open work

### Tools (P6)

- **Approval flow for tools with external effects.** No current tool changes anything outside the app, so `POST /v1/runs/:id/tool-decisions` and the `waiting_for_tool` state are not built. Required before adding any such tool.
- **Compare runs without tools.** Tool-enabled comparisons are not supported.
- **Custom endpoint pointed at OpenRouter.** Found in the live check: a custom compatible connection to `openrouter.ai` works, but loses the OpenRouter preset's $0 pricing (every model shows "Price unknown", Free only blocks them, free alternatives are not offered) and its error messages say "The endpoint". Suggest the preset when a custom URL matches a hosted provider.
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

### Code health

- **LAN runtimes over plain http** are not allowed by the destination policy.

## Resolved

- P8 (2026-09-12): the `codex/local-workspace` UI (black and green theme, model logos, list catalog, provider modal, logo-headed answers) merged into `codex/engine`, and the logo kit adopted. The other checkout's branch is now contained in `codex/engine`.
- P7 canonical analytics, explicit feedback, metric provenance/coverage, release CI and acceptance notes (2026-09-12). The responsive blue workbench was re-checked at 390/768/1440 px; owner visual review remains open above.
- Unrouted legacy chat, provider, telemetry, PromptOps, static-score, and DuckDuckGo `/v1/chat` code removed (P7, 2026-09-12).
- Web search through Exa (P6.2, 2026-09-11), checked live. Hosted providers stream (P2). Emoji stripping of model output removed (P2). Document agent steps now stream through the tool loop (P6.1, `28cb36a`). Benchmark screen replaced by Compare (P5, `c79a8ce`).
