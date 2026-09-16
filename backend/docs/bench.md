# Bench

[Back to the backend documentation index](README.md)

Bench measures your free models on graded questions from published datasets and saves the results. The [Free Router](free-router.md) uses those results to rank models for each kind of message, so it learns which of *your* models are good at code, math, following instructions, tool calls, and reading, instead of guessing from model names.

Code: `backend/src/bench/` (suite, graders, runner), `backend/src/routes/bench.ts` (API), `backend/src/store/bench.ts` (database), `frontend/src/workspace/Bench.tsx` (page).

## Contents

1. [Using Bench](#1-using-bench)
2. [The questions](#2-the-questions)
3. [How answers are graded](#3-how-answers-are-graded)
4. [How a job runs](#4-how-a-job-runs)
5. [Results and storage](#5-results-and-storage)
6. [How the Free Router uses results](#6-how-the-free-router-uses-results)
7. [API](#7-api)
8. [Rebuilding or extending the suite](#8-rebuilding-or-extending-the-suite)
9. [Limitations](#9-limitations)

---

## 1. Using Bench

1. Open **Bench** in the sidebar.
2. **Models:** tick the models to test. Only local or catalog-verified $0 models from the Free Router pool are offered. OpenRouter Bench calls also carry the zero-price ceiling.
3. **Questions:** choose categories (all five by default) and how many questions per category: 1, 3, 5, 10, or 20.
4. Read the estimate below the settings: total requests, requests per connection, and a warning when a connection's documented daily free limit would be exceeded:
   - OpenRouter: 50 free-model requests a day (1,000 after buying $10 of credit).
   - SambaNova: 20 requests a day.
5. **Run Bench** and keep the page open. The progress bar shows answers graded and requests skipped; the status line shows the latest result or why something was skipped. **Stop** cancels the job; everything graded so far is kept.
6. The **Results** table shows, per model, passed out of graded answers for each category, the overall pass rate, and the mean answer time. **This run's answers** lists each graded answer with why it failed.

A good start is 3–5 models at 3 questions per category: 15 requests per model. The router counts Bench once a model has 3 graded answers for the kind of task at hand, and trusts results more as they add up.

**Clear results** deletes all your results. The API can also delete one model's results.

## 2. The questions

`backend/bench/suite.json` holds 100 questions, 20 per category, sampled from five openly licensed datasets. Every item records its dataset, split, row, license, and URL.

| Category | Dataset | License | What the model must do |
| --- | --- | --- | --- |
| **code** | [CRUXEval](https://huggingface.co/datasets/cruxeval-org/cruxeval), output prediction (800 items) | MIT | Say what a short Python function returns for a given input, without running it. |
| **math** | [GSM8K](https://huggingface.co/datasets/openai/gsm8k), test split (1,319 items) | MIT | Solve a grade-school word problem and give the number. |
| **instructions** | [IFEval](https://huggingface.co/datasets/google/IFEval) (541 items) | Apache-2.0 | Write a response that follows every formatting rule in the prompt (for example "no commas", "exactly 2 paragraphs separated by ***", "include the keywords…"). |
| **tools** | [Berkeley Function Calling Leaderboard](https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard), `BFCL_v3_simple` (400 items) | Apache-2.0 | Call the one provided function with correct arguments. |
| **facts** | [SQuAD 1.1](https://huggingface.co/datasets/rajpurkar/squad), validation split (10,570 items) | CC BY-SA 4.0 | Answer a question with a short phrase from a given Wikipedia passage. |

### How items were chosen

For each dataset, 20 rows at evenly spaced positions: row ⌊(i + 0.5) × N ÷ 20⌋ for i = 0…19. The same sources always give the same suite. A job with *k* questions per category uses the first *k* of each category.

Two filters apply to IFEval: only items whose every instruction can be checked exactly are kept (section 3), and items asking for more than 300 words are left out to save free quota. BFCL function names have dots replaced by underscores (`math.factorial` → `math_factorial`), since providers reject dots in tool names, and BFCL's Python type names become JSON Schema types (`dict` → `object`, `float` → `number`, `tuple` → `array`, `any` removed).

### Prompts

| Category | Prompt sent (one user message) |
| --- | --- |
| code | "What does this Python function return for the input below? Work it out without running it." + the code + `f(<input>)` + "End with a final line in the form "Answer: <the returned value as a Python literal>"." |
| math | The problem + "Solve it step by step, then end with a final line in the form "Answer: <number>"." |
| instructions | The IFEval prompt, unchanged |
| tools | The BFCL question, with the function definition sent as a tool |
| facts | "Context:" + passage + "Question:" + question + "Answer with the shortest phrase from the context that answers the question, and nothing else." |

### Why CRUXEval and not HumanEval

HumanEval is graded by running the code a model writes. That would mean executing untrusted model output on your computer. CRUXEval tests the same skill, reading and reasoning about code, and is graded by comparing text, so Bench never executes anything a model produced.

## 3. How answers are graded

Every grader is deterministic: no model judges another model's answer. Code: `backend/src/bench/grade.ts` and `backend/src/bench/ifeval.ts`.

### Math (`number`)

1. Take the text after the last "Answer:" (also "answer :" and the full-width colon).
2. Remove thousands separators (`1,234` → `1234`) and read the first number there. With no "Answer:" line, the last number anywhere in the reply is used.
3. Pass if it equals the dataset's answer (the number after `####` in GSM8K), within 10⁻⁶.

Fail detail: "expected 18, got 17" or "got no number".

### Code (`literal`)

1. Take the text after the last "Answer:". No such line → fail ("no "Answer:" line").
2. Strip backticks, asterisks, surrounding spaces, and a trailing period; accept `f(...) == value` as well as a bare value.
3. Compare with the expected Python value after removing all whitespace and turning `"` into `'`.

So `[(4,1), (2, 3)]` equals `[(4, 1), (2, 3)]`, and `",saw"` equals `',saw'`. A known looseness: two strings that differ only in their spaces compare equal.

### Instructions (`ifeval`)

Every instruction in the item must hold, using IFEval's **strict** rules (no response rewriting). Implemented checks, with how many suite items use each:

| Instruction | Check | Items |
| --- | --- | ---: |
| `keywords:frequency` | A word appears fewer than / at least N times | 5 |
| `keywords:existence` | Every keyword appears (case-insensitive) | 3 |
| `length_constraints:number_words` | Word count (`\w+`) is less than / at least N | 3 |
| `detectable_format:title` | A non-empty title in `<<double angle brackets>>` | 3 |
| `length_constraints:number_paragraphs` | Exactly N paragraphs separated by `***`, none empty in the middle | 2 |
| `detectable_content:postscript` | A postscript starting with the marker (P.S. / P.P.S) | 2 |
| `punctuation:no_comma` | No commas | 2 |
| `keywords:forbidden_words` | None of the words appears as a whole word | 2 |
| `keywords:letter_frequency` | A letter appears fewer than / at least N times | 2 |
| `change_case:english_capital` | The whole response is uppercase | 1 |
| `detectable_format:number_highlighted_sections` | At least N `*highlighted*` sections | 1 |
| `startend:quotation` | The whole response is wrapped in double quotes | 1 |
| `detectable_format:number_bullet_lists` | Exactly N bullet lines (`*` or `-`) | 1 |
| `detectable_format:json_format` | The response (optionally in a ```json fence) parses as JSON | 1 |
| `detectable_content:number_placeholders` | At least N `[placeholders]` | 1 |

Also implemented but not in the current suite: `change_case:english_lowercase`, `change_case:capital_word_frequency`, `detectable_format:multiple_sections`, `detectable_format:constrained_response`, `startend:end_checker`. Not implemented, and their items are left out: language detection, sentence counts, first word of the Nth paragraph, repeating the prompt, two responses. An unknown instruction always fails.

Fail detail: "did not follow punctuation:no_comma, …".

### Tools (`tool-call`)

Follows BFCL's matching for single calls:

1. There must be a tool call ("no tool call" otherwise). Only the first call is graded.
2. Its name must be the expected function ("called area, expected calculate_area").
3. Its arguments must be valid JSON ("arguments were not valid JSON").
4. No argument outside the expected set ("unexpected argument color").
5. Each expected argument either appears with one of the accepted values, or is omitted when `""` is among the accepted values ("wrong value for height", "missing height").

Values are compared like BFCL: strings ignoring case, spaces, and `, . / - _ * ^`, and quote style (`"San Francisco, CA"` equals `"san francisco CA"`); numbers must be numbers (5 is not "5"; an integer is fine where a float is expected); lists element by element; nested objects key by key with their own accepted values.

### Facts (`span`)

Using SQuAD's normalization (lowercase, punctuation to spaces, articles a/an/the removed, spaces collapsed):

- Pass if the reply equals any accepted answer, or
- the reply contains an accepted answer and is short: at most max(12, 3 × the answer's words) words.

So "The Denver Broncos." and "It was the Denver Broncos who won." pass for "Denver Broncos"; a long paragraph that mentions it does not.

### Refusals

A refusal (a provider's `refused` error, such as a safety stop) counts as a **failed** answer with the detail "The model refused to answer." The questions are harmless, so refusing them is a quality problem, not an outage.

## 4. How a job runs

Code: `backend/src/bench/runner.ts`. A job is a normal run in the [run registry](run-harness.md), so events, replay, reconnect, cancel, and ownership work as for chat runs.

### Order

- **Connections run side by side**; requests to one connection go **one at a time**.
- **Items go to every model before the next item**: item 1 to models A, B, C, then item 2 to A, B, C. A job that is stopped or cut short still compares models on the same questions.

### Pacing

Between two requests to one connection, Bench waits 66,000 ÷ (requests per minute) ms, about 10% under the provider's documented free per-minute limit:

| Provider | Free requests per minute | Gap between requests |
| --- | ---: | ---: |
| Cerebras | 5 | 13.2 s |
| Gemini | 10 | 6.6 s |
| OpenRouter | 20 | 3.3 s |
| SambaNova | 20 | 3.3 s |
| Groq | 30 | 2.2 s |
| Mistral | 60 | 1.1 s |
| Hugging Face | 60 | 1.1 s |
| Any other remote endpoint | 20 | 3.3 s |
| Models on this machine | none | 0 (they wait in the local queue instead) |

A 5-model OpenRouter job with 15 questions each is 75 requests, about 4 minutes at 3.3 s apart.

### Requests

Each request is one user message with `temperature: 0` and an output limit per category: code 1,024 tokens, math 1,024, instructions 1,200, tools 512, facts 256. Tools items also send their function as a tool. The adapter's own short rate-limit waits are turned off, so every wait is Bench's and is shown.

### Limits and failures

| What happens | Bench does | Saved as a result? |
| --- | --- | --- |
| Answer received | Grades it | Yes: `passed` or `failed` |
| Refusal | Counts it as wrong | Yes: `failed` |
| Rate limited, reset within 60 s | Waits it out once ("*model* is rate limited; waiting 5 s"), then retries | Only the retry's outcome |
| Rate limited for longer, or a second time | Skips the rest of that model's questions | No |
| Account-wide limit (OpenRouter's daily free quota, 402 no credits) | Skips every model on that connection | No |
| Key rejected (401/403) | Skips every model on that connection | No |
| Other failure (outage, time-out, bad request) | Records it | Yes: `error` |
| Three failures in a row for one model | Skips the rest of that model's questions | The three errors |

Rate limits are never saved as answers: running out of free quota says nothing about how good a model is. `error` results are shown in the table ("2 failed") but never count for or against a model. Skipped questions still advance the progress bar, so it reaches the total; the count of skipped questions is shown.

### Time limit and the page

A job may run up to **3 hours** (chat runs: 10 minutes). Like every run, it is canceled if no page has been following it for 60 seconds, so keep the Bench page open. A reload does not reattach to a running job, but every result graded before that is saved.

## 5. Results and storage

Each graded answer is one row in the `bench_results` table (migration `backend/drizzle/0001_bench_results.sql`), saved as soon as it is graded:

| Column | Meaning |
| --- | --- |
| `user_id`, `id` | Owner and row ID (primary key together; cascades when the user is deleted) |
| `connection_id`, `model` | Which model, on which of your connections |
| `item_id`, `category` | Which question (for example `gsm8k:32`, `math`) |
| `status` | `passed`, `failed`, or `error` |
| `detail` | Why it failed (up to 300 characters) |
| `latency_ms`, `ttft_ms` | Time to the full answer and to the first text |
| `at` | When (milliseconds since the epoch) |

No keys, prompts, or answers are stored: only the outcome and the reason it failed. Every query takes the user's ID, so one user can never see another's results. On a hosted server results are in Postgres; locally, in PGlite under `backend/data`.

`GET /v1/bench/results` returns:

- `scores`: per model and category, the counts of `passed`, `failed`, and `errors`, the mean `latencyMs` of answered items, and `lastAt`. Every saved result counts; nothing expires.
- `recent`: the latest 200 results.

## 6. How the Free Router uses results

At the start of every routed run, the server loads the user's scores and gives each candidate an adjustment for the kind of message (for example, math questions use the `math` category; general questions use `facts` and `instructions`; with tools on, `tools` is added). With at least 3 graded answers:

```
adjustment = graded / (graded + 3) × 1.2 × ((passed + 1) / (graded + 2) − 0.5)
```

Three answers that all pass or all fail move a model by ±0.18, enough to reverse a size-based guess between an 8B and a 70B model. The full mapping, the table of adjustments, and a worked example are in [Free Router, section 10](free-router.md#10-how-bench-changes-the-ranking).

## 7. API

All routes require a signed-in user on a hosted server. Types: `shared/src/bench.ts`.

### `GET /v1/bench/suite`

```json
{
  "generatedAt": "2026-09-14",
  "categories": [
    { "category": "code", "count": 20, "dataset": "cruxeval-org/cruxeval", "license": "MIT", "url": "https://huggingface.co/datasets/cruxeval-org/cruxeval" }
  ]
}
```

### `POST /v1/bench`

```json
{
  "idempotencyKey": "bench_12345678",
  "connections": [{ "id": "openrouter", "target": { "kind": "openrouter", "apiKey": "<key>" } }],
  "models": [{ "connectionId": "openrouter", "model": "meta-llama/llama-3.3-70b-instruct:free" }],
  "categories": ["code", "math", "instructions", "tools", "facts"],
  "perCategory": 3
}
```

Validation: a valid idempotency key; 1–12 connections, each passing the destination policy; 1–30 models, each naming one of the connections, no duplicates; categories from `code`, `math`, `instructions`, `tools`, `facts`, no duplicates; `perCategory` an integer 1–20. Only connections a model uses are contacted.

Response `201` (or `200` for a repeated idempotency key): `{ "runId": "…", "existing": false, "total": 15 }`, where `total` is questions × models.

Follow with `GET /v1/runs/:runId/events?after=N` and stop with `POST /v1/runs/:runId/cancel`, as for any run. Events:

| Event | Fields | Meaning |
| --- | --- | --- |
| `bench` | `result`, `done`, `total` | One answer graded and saved |
| `bench` | `skipped`, `done`, `total` | This many planned questions were skipped |
| `status` | `message` | Why Bench is waiting or skipping |
| `completed` / `canceled` / `failed` | as usual | The job ended |

### `GET /v1/bench/results`

`{ "scores": BenchScore[], "recent": BenchResult[] }`, described in section 5.

### `DELETE /v1/bench/results`

With no body, deletes all your results. With `{ "connectionId": "openrouter", "model": "…" }`, deletes that model's. Response: `{ "removed": 15 }`.

## 8. Rebuilding or extending the suite

**Rebuild** from the datasets (needs network access to huggingface.co):

```sh
pnpm --filter @app/server bench:sample
```

The sampler is `backend/src/scripts/bench-sample.ts`. It reads rows through Hugging Face's dataset API (and BFCL's raw files), applies the filters in section 2, and writes `backend/bench/suite.json`. Commit the new file; the server reads it at start.

**Change a grader:** edit `backend/src/bench/grade.ts` or `ifeval.ts` and extend `backend/src/bench/grade.test.ts`. The suite tests there check that every item's instructions have a check and every tool name is valid.

**Add a category:**

1. Add it to `BenchCategory` in `shared/src/bench.ts` and to `BENCH_CATEGORIES` in `backend/src/routes/bench.ts`.
2. Add a sampler function and, if needed, a grader kind (`Grader` in `backend/src/bench/suite.ts`).
3. Give it an output limit in `MAX_TOKENS` (`runner.ts`) and a label in `CATEGORY_LABEL` (`Bench.tsx`).
4. Map it to task kinds in `TASK_BENCH` (`backend/src/runtime/router.ts`) so the Free Router uses it.
5. Record the dataset and license in `backend/bench/README.md`. Share-alike sources (like SQuAD's CC BY-SA 4.0) must keep their license and attribution for the items taken from them.

## 9. Limitations

- **Small samples.** 20 questions per category are enough to separate good from bad models, not to rank close ones. The router's confidence term accounts for this.
- **Five skills only.** Long context, image input, multi-turn conversations, and multi-step tool use are not measured.
- **Well-known datasets.** GSM8K, SQuAD, and the others are public and may appear in models' training data, which can inflate scores for some models.
- **Results do not expire.** A model that improves or degrades keeps its old results until you clear them.
- **The page must stay open.** A job stops when no page follows it for a minute, and a reload does not reattach.
- **Daily caps are shown, not tracked.** The estimate warns about OpenRouter's and SambaNova's documented daily caps, but Bench does not know how much of today's quota you have already used; it stops a connection when the provider says the quota is gone.
- **Per connection.** Results belong to a connection ID and model; the same model on another provider starts with no results.

### Code and tests

| File | Contents |
| --- | --- |
| `backend/bench/suite.json`, `README.md` | The questions; sources, licenses, attribution |
| `backend/src/bench/suite.ts` | Item and grader types, loading, selection |
| `backend/src/bench/grade.ts`, `ifeval.ts` | Graders |
| `backend/src/bench/runner.ts` | Job execution, pacing, limits |
| `backend/src/routes/bench.ts` | API and validation |
| `backend/src/store/bench.ts` | Saving, scoring, listing, deleting |
| `backend/src/scripts/bench-sample.ts` | Building the suite |
| `frontend/src/workspace/Bench.tsx` | The Bench page |
| `backend/src/bench/grade.test.ts` | Every grader and suite integrity |
| `backend/src/bench/runner.test.ts` | Order, pacing, short and long rate limits, account limits, errors, tools |
| `backend/src/routes/bench.test.ts` | Over HTTP with a real database: validation, grading, per-user isolation, deleting, the Free Router preferring the model that passed |
| `tests/browser/bench.spec.ts` | The page through the real backend: run, results after reload, clear |
