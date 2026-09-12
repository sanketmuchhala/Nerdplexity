# Codex continuation prompt

Paste this into Codex with this repository open:

```text
You are working on my Nerdplexity repository, branch codex/local-workspace.

Start in PLAN/REVIEW mode. Read docs/HANDOFF.md and docs/ROADMAP.md, inspect the branch diff from caefdbcf7b43fe88e1b34d645f672a9f037df170, then consult the existing README and plan/ documents for historical context. Check actual source before making completion claims.

My goal is a polished local AI workspace that grows into a useful harness inspired by Odysseus. It connects to models through runtimes such as Ollama and OpenAI-compatible servers. It is not itself an AI model. Later I want a community directory of legitimate free AI APIs/free tiers with RSS support.

The prior assistant implemented too much before I reviewed the plan and consumed my usage. Do not repeat that. Your first response should give:
1. A concise source-based account of what exists and what remains unverified.
2. Architecture and product gaps ranked by importance.
3. A phased proposal with acceptance criteria, reusing existing code where sound.
4. One small recommended next implementation task, its affected files, and verification approach.
5. Only the decisions that block that task.

Do not implement a broad redesign, install/download models, call paid APIs, deploy, or use sub-agents during this initial review. Wait for my approval of the next implementation task. When I authorize a task, complete that bounded task and its meaningful checks, then report the diff, results, limitations, and update the handoff. Do not treat approval for one phase as approval for the whole roadmap.

Technical constraints: preserve user conversations/settings; distinguish source implementation from tested behavior; report measured token usage only; propagate cancellation; show real tool results; keep local and cloud data paths explicit. Do not claim LM Studio/llama.cpp compatibility until tested with a named configuration. General filesystem/shell/browser tools require a scoped execution and permission design first. Keep the future public API directory separate from private prompts/documents. Do not promise unlimited free inference or share provider credentials.

The current checkpoint passes typecheck and build in the remote environment. Real-model smoke tests, laptop setup, browser QA, and most roadmap items remain outstanding. Start with a review, not another large implementation pass.
```
