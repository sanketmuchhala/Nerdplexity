# P0 validation baseline

Recorded: 2026-09-10, branch `codex/local-workspace`, on top of `caefdbc`.
Scope: toolchain, startup, and existing behavior before workbench changes (P1+). See [the implementation plan](implementation-plan.md).

## Environment

| Tool | Version | Note |
| --- | --- | --- |
| Node.js | 26.8.1 | Homebrew; package declares `>=18` |
| pnpm | 9.0.0 | Not on PATH; run through `npm exec --yes --package=pnpm@9.0.0 -- pnpm` |
| TypeScript | 5.9.2 | |
| Vite | 5.4.19 | |
| Vitest | 1.6.1 | |
| Playwright | 1.63.0 | Chromium from the Playwright cache; `PLAYWRIGHT_CHANNEL=chrome` also works |

Ollama was not running during these checks.

## Toolchain changes in P0

- Root `dev` starts only backend and web; `dev:ollama` starts Ollama separately. `start` no longer launches Ollama.
- Backend binds to `HOST` (default `127.0.0.1`); `PORT` is parsed as a number. Vite binds to `127.0.0.1:5173` with `strictPort`.
- Package `test` scripts use `vitest run` so they do not enter watch mode.
- Added `@playwright/test`, `playwright.config.ts`, `tests/browser/baseline.spec.ts`, and `scripts/capture-baseline.mjs`.
- Removed emoji from three UI strings so the existing `ci:no-emoji` policy passes.
- Superseded plans are marked historical; README rewritten around verified behavior.

## Results

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Pass; lockfile up to date |
| `pnpm typecheck` | Pass (types, web, server) |
| `pnpm build` | Pass. Warning: web bundle 672.82 kB (207.88 kB gzip) exceeds Vite's 500 kB chunk warning; stale browserslist data |
| `pnpm lint` | Pass. This is only the emoji policy check, not ESLint |
| `pnpm -r test` (Vitest) | **Fails: no test files exist** in `packages/server` (Vitest exits 1). No unit-test coverage exists. This is a gap, not a regression |
| `pnpm test` (Playwright) | Pass, 4/4: backend health without Ollama, new conversation persists across reload, empty event history renders without a page error, Settings opens and closes with Escape |

## UI capture

`node scripts/capture-baseline.mjs` against running dev servers writes `docs/screenshots/baseline/`: landing, chat, dashboard, and events at 1440x1000 and 390x844; dashboard and events with six synthetic events; and dashboard with a synthetic `/v1/metrics` 503. External requests are blocked during capture.

Observations:

- Horizontal overflow at 390px on dashboard and events: the analytics header tabs do not wrap, widening the page to about 464px. Landing and chat do not overflow.
- The empty dashboard renders blank charts with 0-1 axes instead of an empty state.
- The dashboard's System Metrics card reports host memory usage as a red bar even with no inference activity.

## Known gaps carried into later phases

Recorded before checkpoint `323d763` and P1. Local streaming, the model lists, provider routing, and unit tests have since changed; see the progress log in [the implementation plan](implementation-plan.md).

- Chat waits for the full response; there is no end-to-end streaming (P2).
- Two separate hardcoded model lists; the shared local list contains one model (P1).
- Provider routing infers provider from model-name substrings (P1).
- No live provider calls were made; adapter behavior is unverified.
- No unit tests; the first planned fixtures are the buffered NDJSON/SSE parsers (P2).
- Web bundle is not code-split.
