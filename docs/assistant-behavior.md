# Assistant behavior

Status: **implemented** · verified 2026-09-15 · prompt version `everyday-chat-v1`

This page describes current behavior. The broader memory and research design in `docs/plans/chat-quality-memory-research.md` remains a proposal.

## Instruction order

Every chat and comparison request starts with the versioned Nerdplexity assistant instructions in `frontend/src/lib/workbench.ts`. Imported system messages follow it, then the optional thread instruction, attached text files, complete retained conversation turns, and the current user message. Current user requests take precedence over learned conversational style. Attachments, prior messages, and retrieved text are explicitly treated as data rather than authority to rewrite application instructions.

Saved run input snapshots include the exact instruction text and version sent to the model. Retries do not stack a second copy of the product prompt.

## Context and output budgets

Answer length and context capacity default to **Automatic**. A known hosted model uses its reported context window and output maximum, with output reduced to the space remaining after the input and a token-estimation margin. The old blanket limits of 2,048 output tokens and 8,192 context tokens no longer apply to hosted models. The Free Router and Free Agent resolve the final answer's capacity against the concrete model selected on the server. Provider limits still apply; free inference does not mean unlimited context or output.

Automatic output reserves a modest amount of answer space while selecting input, then uses the remaining capacity for the answer. It does not discard useful conversation history solely to reserve a model's entire advertised output maximum. A local Ollama model retains the configured runtime context size to respect the machine's memory limits. When a model's context is unknown, the frontend preview uses a 65,536-token estimate; the server checks the actual selected model.

Choose **Custom output limit** or **Custom context budget** in Generation settings to set an explicit cap. Legacy threads with the previous default values switch to Automatic; other saved numeric limits and deliberately applied legacy presets retain their values. Custom output is capped by the selected model's reported maximum, with any reduction recorded as a run notice.

Large text attachments use question-relevant, labelled excerpts. Before selecting excerpts, Nerdplexity reserves space for up to two recent complete turns that fit within half the remaining input budget, preserving context for follow-up questions. Small attachments stay complete when they fit. Excerpt notices disclose omitted document content; the full extracted text remains attached.

When input plus the answer reservation does not fit, Nerdplexity removes the oldest complete historical turn until it fits. It never slices through a conversation message. Product instructions, imported/thread instructions, the selected attachment context, and the current prompt are retained; if those fixed inputs still do not fit, sending is blocked with an actionable error. The complete transcript remains stored even when older turns are omitted from one request.

Token counts are UTF-8 estimates, not provider-tokenizer results. Tool results consume additional context during an agent run.

## Streaming and tools

Normal chat answers stream directly. In a tool-enabled model step, answer-like text is buffered until the provider reports whether the step is terminal. Text from a step that requests tools becomes a typed `activity` event and remains visible above the answer. Text from a terminal step becomes answer `delta` content. This prevents phrases such as “Let me search” from being saved as part of the final answer while preserving what the provider actually emitted.

Provider-supplied reasoning remains a distinct stream. It is displayable provider output, not a claim that Nerdplexity exposes a model's complete private reasoning.

If a provider stops at its output limit, the partial text and finish reason are saved and the chat offers Continue.

## Answer rendering

Answers and displayable reasoning use `react-markdown` with CommonMark and `remark-gfm` for tables, nested lists, task lists, autolinks, and strikethrough. Code fences use the existing copyable code-block component.

Raw HTML is ignored and the syntax tree is passed through `rehype-sanitize`. Code blocks are syntax-highlighted with Prism, which escapes the code before it is inserted as markup; `frontend/src/components/Message.test.tsx` checks that HTML in a code block stays text. Links are limited to HTTP(S), email, or same-document anchors. Model-authored Markdown images are rendered as alt-text placeholders, so an answer cannot silently load a remote tracking image. Incomplete Markdown remains renderable while streaming.

## Not implemented yet

- Automatic web research modes, page reads, normalized inline citations, and evidence storage.
- Explicit profile settings and long-term/project memory.
- Semantic long-thread compaction or retrieval beyond whole-turn omission.
- Distributed or restartable live run execution.
