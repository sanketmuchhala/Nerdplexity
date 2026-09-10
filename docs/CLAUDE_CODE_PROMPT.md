# Claude Code continuation prompt

Paste this into Claude Code with this repository open:

```text
Use plan mode for this first task. This is Nerdplexity, branch codex/local-workspace. Read docs/HANDOFF.md and docs/ROADMAP.md, then inspect the changes relative to caefdbcf7b43fe88e1b34d645f672a9f037df170. Read relevant existing source, README, and plan/ documents. Do not assume the previous assistant's progress messages establish successful tests.

I want a structured plan for a polished local AI workspace and extensible harness inspired by Odysseus. It should make connecting models, chatting, using bounded tools, and inspecting runs approachable. Ollama/LM Studio/llama.cpp provide inference. Nerdplexity is the application and orchestration layer. A later, separate community site should catalog legitimate free API access and free tiers, with RSS ingestion and/or publication to be decided.

An earlier assistant started a large implementation before showing me a plan and exhausted my usage. Preserve the checkpoint and keep this review bounded. Your initial deliverable is:
- What is implemented in source, with paths and evidence.
- What passed checks and what remains untested.
- The most important defects, product gaps, and architecture choices.
- A phased roadmap with concrete acceptance criteria.
- A single small next task with its scope and checks.

Do not edit code, launch a broad redesign, delegate to agents, download models, use paid APIs, or deploy during this initial review. Wait for my approval of the proposed next task. Once I authorize that task, implement only that scope, verify it meaningfully, update docs/HANDOFF.md and docs/ROADMAP.md, and report the result. Avoid lengthy optional testing or polishing after the agreed scope is satisfied.

Preserve existing user data. Audit browser persistence and legacy settings rather than silently replacing them. Verify real streaming, stop propagation, error states, document-tool limits, and model capability handling. Display only actual tool actions and reported usage. Document local-host versus remote-host behavior. Do not add unrestricted filesystem, shell, network, or browser tools before a permission/sandbox design. Keep private local data separate from the future public directory. Free-tier listings need sources, limits, freshness, and moderation; never distribute keys or bypass quotas.

This is an unfinished checkpoint with passing typecheck/build, not a completed Odysseus-equivalent harness. Begin with the review and proposed next step.
```
