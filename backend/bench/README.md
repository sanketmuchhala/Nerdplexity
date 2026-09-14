# Bench suite

`suite.json` holds the questions Bench sends to models: 20 per category, sampled at evenly spaced positions from five published datasets, so the same sources always give the same suite. Every item records its dataset, split, row, and license.

Regenerate it with `pnpm --filter @app/server bench:sample` (needs network access to huggingface.co).

| Category | Dataset | License | What is checked |
| --- | --- | --- | --- |
| Code | [CRUXEval](https://huggingface.co/datasets/cruxeval-org/cruxeval), output prediction | MIT | The value a given Python function returns, compared as a literal. Model code is never run. |
| Math | [GSM8K](https://huggingface.co/datasets/openai/gsm8k), test | MIT | The number on the final "Answer:" line. |
| Instructions | [IFEval](https://huggingface.co/datasets/google/IFEval) | Apache-2.0 | Every instruction holds, using IFEval's strict rules. Only items whose instructions can be checked exactly are kept (no language detection or sentence counting), and essays over 300 words are left out to save free quota. |
| Tools | [Berkeley Function Calling Leaderboard](https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard), `BFCL_v3_simple` | Apache-2.0 | One call to the right function with accepted argument values, compared as BFCL does. Dots in function names become underscores, since tool names cannot contain them. |
| Facts | [SQuAD 1.1](https://huggingface.co/datasets/rajpurkar/squad), validation | CC BY-SA 4.0 | The answer span from the given passage, or a short answer containing it, after SQuAD's normalization. |

Grading is deterministic; no model judges another.

## Attribution

- CRUXEval: Gu et al., "CRUXEval: A Benchmark for Code Reasoning, Understanding and Execution" (2024). MIT License.
- GSM8K: Cobbe et al., "Training Verifiers to Solve Math Word Problems" (2021), OpenAI. MIT License.
- IFEval: Zhou et al., "Instruction-Following Evaluation for Large Language Models" (2023), Google. Apache License 2.0. The checks in `src/bench/ifeval.ts` follow its reference implementation.
- BFCL: Patil et al., Berkeley Function Calling Leaderboard, UC Berkeley Gorilla project. Apache License 2.0.
- SQuAD: Rajpurkar et al., "SQuAD: 100,000+ Questions for Machine Comprehension of Text" (2016). The passages come from Wikipedia. Licensed under CC BY-SA 4.0: the SQuAD items in `suite.json` (IDs starting with `squad:`) are shared under the same license, with this attribution.
