# Release verification

P7 turns the P0–P6.2 work into a locally verifiable release candidate. This document records what automated checks prove and where a real provider account or runtime is still required.

## Acceptance evidence

| Area | Evidence in the repository | Result |
| --- | --- | --- |
| Persistence | Dexie migration fixtures cover existing v3/v4 data through v6, reopen/idempotency, preserved messages and credentials; import validation and startup retry have browser coverage. P7 fields are optional and require no store/index migration. | Passed |
| Streams | Run-engine and adapter tests cover arbitrary byte boundaries, UTF-8 splits, ordered replay, deduplication, disconnect, cancellation, and one terminal event. Browser tests cover refresh reattachment and partial answers. | Passed |
| Model switching | Browser tests verify next-turn switching, immutable historical provenance, context resolution, and retry snapshots. | Passed |
| Providers | Recorded-format adapter/discovery fixtures cover every supported provider. Browser tests exercise the real backend through a deterministic OpenAI-compatible server. | Passed with live limits below |
| Cost policy | Unit and browser tests verify local/$0/no-billing classification, unknown and paid blocking, per-thread override, and no automatic fallback. | Passed |
| Local runtime | Fixtures and browser tests cover unreachable/empty/missing states, local queue ordering, management progress/errors, and cancellation. | Passed with real-runtime limits below |
| Files and tools | Tests cover attachment limits and four image mappings, identical Compare inputs, tool argument validation, unknown/denied/error/timeout/cancel paths, bounded loops, and Exa result filtering/redaction. | Passed |
| UI | Browser flows cover keyboard dialogs, mobile navigation, light/dark persistence, long content, loading/error/empty states, and 1440/768/390 px overflow checks. | Passed |
| Metrics | P7 unit tests cover null-safe percentiles, valid generation-rate rules, immutable catalog-price estimates, coverage, explicit feedback, and credential-safe exports. The browser check verifies persisted feedback and responsive analytics. | Passed |

## Metric provenance

- Model time is total run duration minus local queue time.
- First text is measured by the run engine and omitted when no text arrived.
- Tokens are shown only when the provider reports usage.
- Tokens per second requires a completed run without tools, reported completion tokens, first-text timing, and a positive generation interval. Tool time would distort this rate, so tool runs do not show it.
- Context utilization divides provider-reported prompt tokens by the immutable input budget saved before the run.
- Hosted cost is an estimate only when the run saved a provider catalog price or a catalog-confirmed $0 classification. The estimate does not include caching, discounts, request fees, taxes, or later price changes.
- Helpful and unhelpful counts come only from user-selected feedback on saved assistant messages. No response-quality score is inferred.

## Live integrations still untested

- OpenAI, Anthropic, Gemini, DeepSeek, and Groq have not been run with real account keys in this environment.
- Ollama and LM Studio have not been exercised against a real installed model. Pull cancellation, disk/runtime failures, model load reporting, and tool support still need a real-runtime check.
- Native Anthropic and Gemini tool calls, and Ollama tool calls, are fixture-tested only.
- OpenRouter calculator and Exa search were checked live during P6.2 through a custom compatible connection; that does not validate every OpenRouter model or quota state.

Use **Check** on each configured model to record account-specific inference success. Availability, pricing, and quotas remain provider/account dependent.

## Local verification result

On 2026-09-12, the release candidate passed workspace typecheck, production build, source-policy lint, all 141 Vitest tests (108 server and 33 web), and all 32 Playwright tests through isolated local services. The analytics browser test also retained review captures at 1440, 768, and 390 px and asserted no horizontal overflow.

## Release boundary

The workflow in `.github/workflows/ci.yml` runs typecheck, unit tests, production build, source policy lint, and the Playwright browser suite. This phase creates a local release candidate only; it does not deploy or publish Nerdplexity.
