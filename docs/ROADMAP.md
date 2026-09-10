# Nerdplexity proposed roadmap

Status: planning document, not an approved commitment. See [HANDOFF.md](HANDOFF.md) for implemented source and verified checks. No timeline or feature completion is implied by this list.

## Phase 0: review and recover the checkpoint

- [x] Preserve existing implementation on a separate branch with source-based status and handoff prompts.
- [x] Run TypeScript checks and production build in the current environment.
- [ ] Review the branch diff and decide which changes to keep.
- [ ] Reproduce installation with the declared Node/pnpm setup on the owner's laptop.
- [ ] Smoke-test one installed local model and capture the actual interface.
- [ ] Agree on MVP scope, supported runtimes, visual direction, and a bounded next task.

Exit: owner has inspected the proposal and working baseline, with outstanding defects listed.

## Phase 1: reliable local model MVP

Starting source exists: discovery, chat streaming, generation controls, cancellation, browser persistence, run history.

- [ ] Verify Ollama end to end, then one OpenAI-compatible server; document exact tested runtime/model versions.
- [ ] Add targeted tests for chunk splits, Unicode, stream termination, malformed records, upstream errors, abort propagation, and URL validation.
- [ ] Validate queue cancellation, timeout reporting, concurrent tabs, storage migration, thread changes during a run, and partial-output recovery.
- [ ] Make first-run setup explicit: runtime offline, server online but no model, unsupported model capability, ready to chat.
- [ ] Audit cloud-provider regression behavior and clearly label which paths stream.
- [ ] Reconcile legacy analytics and generation settings with the new run path.
- [ ] Add context-budget handling and truthful token/latency displays; never invent absent usage.
- [ ] Perform desktop/mobile, keyboard, contrast, and reduced-motion QA.
- [ ] Update README setup and feature claims to match demonstrated behavior.

Exit: fresh install -> connect -> discover -> select -> stream -> stop -> reload history works reproducibly. Tests cover the meaningful failure paths.

## Phase 2: useful document workspace

Starting source exists: text imports, local document storage, lexical search/read tools, bounded loop, visible traces.

- [ ] Validate actual tool-capable models and unsupported-tool fallback.
- [ ] Let users explicitly choose documents per run and inspect what is shared.
- [ ] Add consistent citations with document IDs and passage offsets plus tests for missing evidence.
- [ ] Define context budgets for inventory, retrieved passages, tool output, and final answer.
- [ ] Stream the agent's final response where supported.
- [ ] Checkpoint runs incrementally and add resumability only after defining replay semantics.
- [ ] Add reliable workspace export/import and versioned storage migration.
- [ ] Evaluate PDF parsing, chunking, embeddings, and retrieval quality only against a concrete use case. A vector database is not a prerequisite for the current text workspace.

Exit: a user imports source material, asks an answerable question, inspects real tool results/citations, and receives an explicit limitation when evidence is absent.

## Phase 3: extensible harness

This is proposed work, not present functionality.

- [ ] Define shared runtime, tool, run-event, capability, and artifact contracts.
- [ ] Add a tool registry with typed arguments, timeouts, output limits, and explicit permissions.
- [ ] Evaluate MCP integration with per-server trust and capability controls.
- [ ] Design approvals, scoped workspace access, isolated execution, and audit events before filesystem writes, shell, or browser tools.
- [ ] Add task/artifact workspace primitives, recoverable runs, retry policy, and reproducible configuration.
- [ ] Add model routing/fallback only with visible provider choice, explicit data boundaries, and measured benefit.
- [ ] Decide whether multi-agent workflows solve a demonstrated need before building orchestration.
- [ ] Evaluate desktop packaging versus a local web server. Keep local inference reachable without implying that remote hosting accesses a laptop.

Exit: one useful workflow uses a new tool through the contract, exposes its actions, enforces scope, and recovers from failure.

## Phase 4: community free API directory and RSS

Separate public service from the private local workspace. No directory backend, submission flow, ingestion worker, or RSS endpoint exists yet.

- [ ] Define entries: provider, model/service, endpoint/docs links, access method, free-tier category, limits, reset window, regions, data policy, source URL, last-verified time, status, and change history.
- [ ] Build browsing/search/filtering and source-backed detail pages.
- [ ] Add community submissions, deduplication, moderation, corrections, and stale-entry reports.
- [ ] Verify limits against provider documentation; distinguish trials, expiring promotions, credits, and recurring free tiers.
- [ ] Add bounded health checks that respect provider terms, rate limits, and request costs. Keep credentials server-side where required.
- [ ] Resolve RSS scope with the owner: ingest provider announcements, publish directory updates, or both. Support stable IDs, deduplication, provenance, and update timestamps.
- [ ] Publish an RSS feed for additions, changed limits, and unavailable services if outbound RSS is selected.
- [ ] Let the local app import trusted catalog metadata; users supply their own keys where required. Do not distribute credentials or evade quotas.
- [ ] Measure listing accuracy, stale-entry rate, submission turnaround, and successful user connections.

Exit: each listing has evidence and freshness metadata, submissions are reviewed, and feed items link to validated changes.

## Phase 5: release and maintenance

- [ ] CI for typecheck/build and focused tests, installation docs, a supported runtime matrix, and release notes.
- [ ] Opt-in diagnostics with clear data scope; no hidden upload of prompts or documents.
- [ ] Audit secrets, dependencies, trust boundaries, data deletion/export, and release packaging.
- [ ] Evaluate distribution, onboarding, support, and sustainable directory hosting costs.

## Decisions to review before expanding scope

1. First audience and task: personal local workspace, developer harness, or document assistant?
2. MVP runtime coverage: Ollama first, then which OpenAI-compatible server?
3. Local web app versus desktop packaging, and whether the public directory is a separate repository.
4. Visual direction inspired by Odysseus without copying branding or presenting parity claims.
5. RSS ingestion, publication, or both.
6. Which existing analytics features remain central and which move to an advanced area.

## Recommended next bounded task

Review this checkpoint, propose the smallest fixes needed for an Ollama smoke test on the owner's laptop, and present the plan before editing. Do not attempt the full roadmap in a single session.
