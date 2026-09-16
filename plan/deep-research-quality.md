# Deep Research: good, accurate, and current

Status: plan, written 2026-09-16, after PR #19. It continues [`deep-research.md`](deep-research.md) (which defined R0–R5 and is still the origin document) and replaces its R2–R4 with a worked-out design. The engine as built is described in [`backend/docs/deep-research.md`](../backend/docs/deep-research.md).

This plan answers three questions in order: what is wrong today, why, and in what order to fix it.

## Contents

1. [The short version](#1-the-short-version)
2. [What is wrong today](#2-what-is-wrong-today)
3. [Three root causes](#3-three-root-causes)
4. [Phase 0: measure before changing](#4-phase-0-measure-before-changing)
5. [Phase A: freshness and correct Exa usage](#5-phase-a-freshness-and-correct-exa-usage)
6. [Phase B: reading quality](#6-phase-b-reading-quality)
7. [Phase C: synthesis correctness](#7-phase-c-synthesis-correctness)
8. [Phase D: the second round](#8-phase-d-the-second-round)
9. [Phase E: control and visibility](#9-phase-e-control-and-visibility)
10. [Phase F: evaluation](#10-phase-f-evaluation)
11. [What a run costs, before and after](#11-what-a-run-costs-before-and-after)
12. [Risks](#12-risks)
13. [Open questions the probe settles](#13-open-questions-the-probe-settles)

---

## 1. The short version

The pipeline's shape is right. Plan from perspectives, search, have several models read pages and quote them, keep only what the page says, outline, write with citations, check. That is the STORM-shaped design the research recommended, and the deterministic quote check is the right instinct.

Three things are wrong with it.

**It has no clock.** Nothing in the pipeline knows what today's date is. Not the planner writing queries, not the reader dating a fact, not the writer saying "currently". Free models fill that gap with their training cutoff, so a report written today can silently describe 2024. The one freshness control that exists, `recencySince`, fires only when the question happens to contain a word like "latest", applies one blunt 18-month window to every query in the run, and does it with a hard filter that also throws away every page Exa has no published date for.

**It uses Exa as a page-text pipe.** It sends two parameters Exa deprecated in February 2026, asks for three times more text than Exa will return, pays for the contents of every search result while reading 40% of them, and ignores every part of the API that exists to make research better: `maxAgeHours` for freshness, `summary` with a schema for structured extraction, `category` for steering, `/contents` for pages the search had no text for, and `costDollars` for telling the user what they spent.

**Every stage throws away what the next stage needs.** The plan knows which sub-question each query serves and the report never learns it. The outline assigns notes to sections and the writer gets only the headings. Two sources saying the same thing is corroboration, and the pipeline deletes the second one as a duplicate. And the two checks that make the report trustworthy check the wrong things: the quote check validates wording but not the claim, and the citation check validates numbering but not support.

The plan below fixes those in six phases, each shippable on its own, each with tests, measured against a small evaluation set built in Phase 0 so "better" means a number and not a feeling.

---

## 2. What is wrong today

Ordered by how much it costs the user. Line numbers are on `main` at b43f572.

### Freshness

| # | Defect | Where | Effect |
| --- | --- | --- | --- |
| F-1 | No step is told today's date | every prompt in `research.ts` | The writer says "currently" about its training data; the planner writes queries for the wrong year; a fact dated in the source loses its date on the way to the report |
| F-2 | Freshness is decided once for the whole run, from a regex on the question | `research.ts:126-133` | "How do heat pumps work, and what do they cost now?" either dates every query (starving the background sub-question of good older sources) or none (leaving the price sub-question to 2019 pages) |
| F-3 | `startPublishedDate` is a hard filter | `research.ts:519`, `webSearch.ts:45` | Pages Exa holds no published date for cannot satisfy it, so official docs and reference pages drop out of exactly the searches that most need them. There is no retry when a dated search comes back thin |
| F-4 | No `maxAgeHours`, so Exa serves whatever it cached | `webSearch.ts:43-47` | A page that changed yesterday is read as it was whenever Exa last crawled it, and nothing anywhere records how old the copy is |
| F-5 | The published date reaches the writer but never the user's eye, and is never used to rank or to warn | `research.ts:583`, `useRun.ts:161` | A 2019 source and a 2026 source look identical in the sources list, and the report never says what it is current as of |
| F-6 | 18 months is one hard-coded window for every kind of question | `research.ts:130` | Too long for prices and releases, too short for policy history |

### Exa

| # | Defect | Where | Effect |
| --- | --- | --- | --- |
| E-1 | Sends `numSentences` and `highlightsPerUrl`, deprecated 2026-02-02 in favour of `maxCharacters` | `webSearch.ts:46` | Highlight length is not actually being controlled; the parameters are on a removal path |
| E-2 | Asks for 30,000 characters of text; the documented range is 1–10,000 | `research.ts:22`, `webSearch.ts:46` | We get at most 10,000, so `relevantSlice`'s 12,000-character budget never binds and the careful "read the part about the question" code is dead for search-fetched text |
| E-3 | Text and highlights are bought for every search result, then 40% are read | `research.ts:515-534` | On a standard run, 30 pages are billed for contents and 12 are read |
| E-4 | `summary` with a JSON schema is unused | — | Exa will run its own model over a page for $0.001 and return structured claims. That is a second, more reliable reader than a 7B free model, and it is the direct fix for the "Kept 0 notes" failure |
| E-5 | `category` is never set | — | A current-events sub-question and a scholarly one get the same generic search |
| E-6 | No retry, no broadening | `research.ts:527-532` | One 429, or one query that returns nothing, silently kills a whole sub-question |
| E-7 | `/contents` is never called | — | A picked page Exa returned no text for is read from a 3-sentence highlight, when one live-crawl request would have fetched it |
| E-8 | `costDollars` is read in `exaSearch` and ignored in `exaPages` | `webSearch.ts:92` vs `36-66` | Exa is not free. The user has no idea a deep run spends about 10 cents of a $10 monthly allowance |
| E-9 | Queries are shaped as keyword piles | `research.ts:86-124` | `topicAnchor` joins bare entity words. Exa's neural search is documented to work best on a natural-language description of the page you want, which is the opposite shape |

### Accuracy

| # | Defect | Where | Effect |
| --- | --- | --- | --- |
| A-1 | The quote check validates wording, not the claim | `research.ts:313-330` | `quoteFromPage` will accept a reworded quote when it maps onto a page sentence sharing enough distinctive words. A model that invents a number and keeps the surrounding words passes the check. This is the largest correctness hole in the pipeline |
| A-2 | The citation check validates numbering, not support | `research.ts:429-447` | `[3]` is checked to be a source that exists. Whether source 3 says what the sentence claims is never checked by anything |
| A-3 | The same fact from a second source is deleted as a duplicate | `research.ts:573-586` | Corroboration, the strongest signal a research report has, is thrown away. The report cannot say "three sources agree", and the one surviving source looks like the only evidence |
| A-4 | The outline's note assignments never reach the writer | `research.ts:612` | The outliner decides which notes belong in which section; the writer is handed the headings and improvises the rest. The outline step is decorative |
| A-5 | Coverage per sub-question is computed and discarded | `research.ts:370` | The reader returns the sub-question index for each note, it is stored on the note, and nothing ever reads it. So we cannot tell which sub-question went unanswered, cannot search again for it, and cannot tell the user what the research failed to find |
| A-6 | The fallback writes pseudo-facts | `research.ts:378-387` | "From the page: <first sentence>" becomes a citable note with the same standing as a real extracted fact |
| A-7 | The relevance gate has no floor | `research.ts:202` | PR #19's `pageRelevant` filter runs on both the capped and uncapped passes. If its lexical test is too strict for a topic, the run reads nothing and there is no third pass without it |
| A-8 | Every source is equally authoritative | `research.ts:192-215` | A forum thread and a statistics agency are interchangeable to the picker and to the writer |
| A-9 | The note pile decides the writer pool | `research.ts:609-624` | 12 sources times 6 notes is roughly 16k tokens before the conversation. Every free model too small for that is excluded from writing, so the note budget quietly picks the writer |
| A-10 | One round | `research.ts:511-534` | All searches are issued from the plan before any page is read. Nothing adapts to what was found |

---

## 3. Three root causes

**No clock.** A research tool's core promise is that it knows something you do not, which is usually something recent. Nothing downstream of the question knows the date, so the system cannot prefer recent evidence, date a claim, notice that its best source is three years old, or tell the user what the report is current as of.

**Exa is treated as a search-and-scrape endpoint.** It is a research API with a freshness control, a structured extractor, category steering, and a cost meter. Using it properly is not tuning; it removes two whole classes of defect (weak readers, stale caches) that would otherwise have to be worked around with more free-model calls.

**Each stage is a funnel, not a pipeline.** Sub-question, date, corroboration, section assignment, and reader confidence are all computed and then dropped before the stage that needs them. Most of Phase C is not new machinery; it is carrying the information that already exists one stage further.

---

## 4. Phase 0: measure before changing

Two artefacts, both cheap, both prerequisites for calling any later phase a success.

### 0.1 An Exa probe

`backend/scripts/exa-probe.ts`, run once by hand with a real key (`npm run exa:probe -- --key <key>`), printing a table. It settles what the documentation does not say (section 13). Each probe is one search and costs about a cent:

1. Ask for `text.maxCharacters: 30000` and report what comes back. Confirms E-2.
2. Run the same query with and without `startPublishedDate`; report how many results the dated run loses and how many of the lost ones have no `publishedDate`. Confirms F-3.
3. Run with `maxAgeHours: 0`, `24`, and omitted; report latency and whether the text differs. Sizes the cost of freshness in seconds.
4. Run with `summary: { query, schema }` on five pages; print the structured output. Decides whether Exa's extraction is good enough to be a second reader (Phase B).
5. Run with `category: "news"` and without; report the overlap and the date spread.
6. Print `costDollars` for each shape, so the cost model in section 11 comes from the meter rather than the price list.

The probe writes `plan/research/exa-probe.md` with the results and the date. Nothing in Phases A or B is tuned from the price page when a measured number is available.

### 0.2 A baseline evaluation set

`backend/eval/research/` with 12 questions to start (expanded to 30 in Phase F), each a JSON file:

```json
{
  "id": "gpu-price-2026",
  "question": "What does an NVIDIA H100 80GB cost to rent per hour right now, and how has that changed over the past year?",
  "kind": "time-sensitive",
  "asOf": "2026-09-16",
  "expect": { "numbers": [{ "unit": "usd_per_hour", "between": [0.5, 12] }], "mustMention": ["per hour"] },
  "freshness": { "medianSourceAgeDaysBelow": 400 }
}
```

Four kinds, three questions each: **time-sensitive** (the answer changed in the last year, so a stale pipeline fails it), **multi-hop** (needs two sources combined), **comparative** (needs several sources weighed), **timeless** (must not be damaged by freshness work).

Grading is deterministic wherever possible and runs without a model:

- **Accuracy**: does the report contain the expected number in range, or match the expected regexes.
- **Citation support**: the share of cited sentences that pass the Phase C claim check.
- **Freshness**: median age of cited sources against the question's window; share of sources with no date.
- **Coverage**: share of the plan's sub-questions with at least one note.
- **Cost**: Exa dollars from `costDollars`, model requests, wall clock.

`npm run eval:research` runs the set against a running server and writes a dated row to `plan/research/eval-log.md`. Every later phase reports its before and after row. Full set at standard depth is roughly $1.20 of Exa credit and 25 minutes.

**Done when**: the probe table exists, the baseline row is in the log, and the numbers in section 11 come from it.

---

## 5. Phase A: freshness and correct Exa usage

The highest value for the effort, and almost entirely prompt and request-shape changes. No new pipeline stages.

### A.1 Give the pipeline a clock

One `asOf` computed at the top of `researchExecutor` and threaded into every prompt.

- Planner: `Today is 2026-09-16. Write queries that will find current information. For each sub-question say whether the answer changes over time.`
- Reader: `Today is 2026-09-16. This page says it was published on 2024-03-11. When a fact is tied to a time, put that time in the fact ("in Q2 2025, X was ..."), taking it from the page and not from what you remember.`
- Outliner and writer: `Today is 2026-09-16. Say what each figure is as of. When two sources of different dates disagree, prefer the newer one, say that they differ, and cite both.`

The writer is also given the run's date span, computed deterministically: `Sources range from 2021-06 to 2026-09; 3 of 12 carry no date.`

This is small and it is the single change most likely to show up in the eval's time-sensitive questions.

### A.2 Freshness per sub-question, not per run

The planner already returns JSON. Extend the schema:

```json
{"questions":[{"question":"...","queries":["..."],"freshness":"fresh|recent|any","kind":"news|research|reference|general"}]}
```

| Label | Window | `maxAgeHours` | Meaning |
| --- | --- | ---: | --- |
| `fresh` | 6 months | 168 (a week) | Prices, releases, standings, anything that moved this year |
| `recent` | 3 years | 720 (30 days) | The current state of a field |
| `any` | none | omitted | Definitions, mechanisms, history |

Unlabelled sub-questions fall back to today's `recencySince` regex over the sub-question text (not the whole message), so the behaviour degrades to something close to current rather than to nothing. `recencySince` keeps its exported signature and gains a window argument, so its tests survive.

### A.3 Prefer recent rather than requiring it

`startPublishedDate` stays, for `fresh` and `recent` only, and gains a safety net: **when a dated search returns fewer than half the results asked for, it is re-run once without the date filter**, and those results are marked `dateUnknown` so the reader and writer prompts can say so. This keeps the recall of undated reference pages without doubling the cost of the common case, and it removes F-3 without needing to know exactly how Exa treats undated pages.

### A.4 `maxAgeHours`

Set from the freshness label (table above), with `livecrawlTimeout: 8000` so one slow site cannot stall a run. `livecrawl` is deprecated and is not used. This is what actually makes the text current; `startPublishedDate` only filters what Exa already indexed.

### A.5 Fix the request shape

In `exaPages`:

- `highlights: { query, maxCharacters: 1200 }`, dropping `numSentences` and `highlightsPerUrl`.
- `text: { maxCharacters }` clamped to Exa's documented ceiling, taken from the probe. `RESEARCH_LIMITS.fetchChars` drops to that number and `pageChars` below it, so `relevantSlice` is doing real work again.
- `category` from the sub-question's `kind`, with a guard: the `company` and `people` categories reject date filters with a 400, so those two are never combined with a window.
- `userLocation` from the app's locale when set.

### A.6 Search cheap, fetch contents for what will be read

Split the search step in two, which is both cheaper and better:

1. **Search** with `contents: { highlights: { query, maxCharacters: 1000 } }` only. Highlights are exactly what `pickSources` and `pageRelevant` need to judge a page, and they are what Exa recommends as the default output shape.
2. **Fetch** one `/contents` call for the picked URLs only, with `text`, the freshness label's `maxAgeHours`, and (Phase B) `summary`.

A page that comes back with no usable text gets one retry at `maxAgeHours: 0`, which fixes E-7. This also means the freshness control is applied to the pages we actually read, not to 30 pages we mostly discard.

### A.7 Retry and broaden

- One retry with backoff on 429 and 5xx, respecting the run's abort signal.
- A search that returns zero pages is re-run once, broadened: date filter dropped, category dropped, query shortened to its topic words. A zero-result sub-question should cost one extra search, not a hole in the report.

### A.8 Show the cost and the dates

- `exaPages` and the new contents call read `costDollars`; the run totals them; the strategy step says `12 sources, about $0.09 of Exa credit`.
- The sources list shows each source's date, or "no date".
- The citation-check step gains a freshness line: `Oldest source 2019-03, newest 2026-09; 3 carry no date.`

**Files**: `backend/src/runtime/webSearch.ts` (request shape, `/contents`, retries, cost), `backend/src/runtime/research.ts` (clock, labels, two-phase search, cost line), `backend/docs/deep-research.md`, `frontend/src/workspace/AgentActivity.tsx` (dates, cost).

**Tests**: the request body Exa receives for each freshness label; the thin-result retry without the date filter; the zero-result broadening; the 429 retry; `maxAgeHours` per label; the date span line; the cost total; `asOf` present in each prompt. All with the existing fake-fetch pattern in `webSearch.test.ts` and `research.test.ts`.

**Done when**: the eval's time-sensitive questions improve on median source age and on accuracy, and the timeless questions do not regress.

---

## 6. Phase B: reading quality

This is where "Kept 0 notes" dies, and where the largest correctness hole closes.

### B.1 Exa's summary as a second reader

For each picked page, the `/contents` call also asks for:

```json
{"summary": {"query": "<the sub-question>", "schema": {"type":"object","properties":{
  "relevant": {"type":"boolean"},
  "asOf": {"type":"string"},
  "claims": {"type":"array","items":{"type":"object","properties":{
    "claim":{"type":"string"}, "quote":{"type":"string"}, "asOf":{"type":"string"}}}}}}}}
```

The result is a second independent read of the same page, for $0.001, from a model that is better at this than most free models. Both reads go through the same `quoteInPage` check against the page text, so Exa gets no special trust.

Three uses, in order of value:

1. **Fallback that is actually a read.** When the free reader returns nothing usable, Exa's claims stand in, instead of today's "From the page: <first sentence>" pseudo-facts (A-6). Those pseudo-facts are removed.
2. **Corroboration within a page.** A note both readers produced, from the same sentence, is marked `agreed` and preferred by the note budget in Phase C.
3. **Relevance.** `relevant: false` is a much better signal than the lexical `pageRelevant` gate, and is used to replace it as the primary filter, with the lexical test kept only as a cheap pre-filter.

If the probe shows Exa's schema summaries are poor or slow, B.1 is dropped and B.2–B.4 proceed alone; nothing else depends on it.

### B.2 Facts must carry their own numbers

The cheapest large accuracy win available, and it needs no model.

Every number in a note's `fact` must appear in its `quote`: integers, decimals, percentages, currency amounts, and years, compared after normalising `1,200` to `1200`, `5 percent` to `5%`, `$1.2 billion` to `1200000000`, and unit spacing. A fact whose numbers are not in its quote is dropped and counted as `dropped (number not in the quote)`.

This closes A-1 precisely: `quoteFromPage` repairs wording, so a model that keeps the sentence's distinctive words and changes the number currently passes. After B.2 it cannot.

### B.3 Tighten and label repaired quotes

- A repaired quote must pass B.2 as well as the existing overlap test.
- A note carries `exact: true | false`. The writer's context marks paraphrase-matched notes, and the writer is told to prefer exact quotes when two notes conflict.
- The reader step's line becomes explicit: `Kept 4 notes (3 exact, 1 matched to the page); dropped 2 the page does not say, 1 whose number is not in its quote.`

### B.4 Stop asking for facts a page does not have

The reader prompt asks for "up to 6 short facts" whether or not the page has six. Rewrite it to ask for the facts the page actually contains, up to six, and to make `{"notes":[]}` an explicitly good answer for an unhelpful page. Free models fabricate under a quota; removing the quota is free.

**Files**: `backend/src/runtime/webSearch.ts` (summary schema), `backend/src/runtime/research.ts` (`numbersAgree`, note flags, reader prompt, fallback), docs.

**Tests**: numbers in a fact but not its quote (dropped); `1,200` vs `1200` and `5 percent` vs `5%` (kept); a repaired quote with a changed number (dropped); Exa's summary standing in when the reader fails; `relevant: false` filtering a page; the pseudo-fact fallback gone.

**Done when**: citation support on the eval rises and the count of notes dropped for wrong numbers is non-zero on the eval set (it should be: this catches real errors).

---

## 7. Phase C: synthesis correctness

Carrying information the pipeline already has one stage further, plus the check that matters.

### C.1 Merge corroboration instead of deleting it

`Note.source: number` becomes `Note.sources: number[]`. Notes whose quotes or facts are near-identical across sources are merged rather than dropped, keeping the best quote and listing both sources. The writer cites `[2][5]`, and the report can say two sources agree. The citation check accepts multi-source notes. The source card shows "also reported by source 5".

This converts A-3 from a bug into the report's strongest feature.

### C.2 Coverage by sub-question

Use the `question` index the reader already returns; map notes without one onto the nearest sub-question by keyword overlap. After reading, compute notes per sub-question, and:

- The panel shows coverage: `Sub-question 3 (battery cost): no sources found`.
- The writer is given a deterministic gap note: `The search found nothing for: <sub-question>. Say so; do not answer it from memory.`
- Phase D uses the same list as its second-round queries.

### C.3 Give the writer the outline it asked for

Pass the outline's note assignments through: `## Battery cost — use notes 3, 7, 12`. One line of code for the thing the outline step exists to produce.

### C.4 A note budget that picks notes, not the writer

Today the note pile is whatever survives, and its size decides which models are large enough to write (A-9). Instead, cap the notes sent to the writer (`RESEARCH_LIMITS.notesToWriter`, about 40 for standard) and choose them by: sub-question coverage first (every covered sub-question keeps its best notes before any sub-question gets a second tier), then corroborated notes, then exact quotes, then source quality, then recency. The report gets better notes and more models stay eligible to write.

### C.5 Source quality as a visible tiebreak

A small, explicit, auditable classifier in `research.ts`: standards bodies, government and statistical agencies, official documentation and filings, and peer-reviewed publications rank above established publications, which rank above blogs and forums, which rank above known content farms. It is a tiebreak in `pickSources`, an input to C.4, and a label on the source card. It is never a blocklist, and the list lives in the repo where it can be argued with.

### C.6 A floor under the relevance gate

`pickSources` gains a third pass with the relevance gate off when fewer than half the budgeted sources survive the first two, and logs that it did. A strict lexical test should cost precision, never the whole run (A-7).

### C.7 The citation check that checks support

Replace numbering-only with claim support, still deterministic, still no model:

1. Split the report into sentences that carry a citation.
2. For each, gather the notes belonging to the cited sources.
3. **Numbers first**: every number in the sentence must appear in one of those notes. This alone catches most miscitation.
4. **Then overlap**: the sentence must share enough distinctive words with at least one cited note.
5. Classify: `supported`, `unsupported`, or `no note` (the source exists but contributed nothing relevant).

The step reports `38 of 41 cited sentences are supported by their sources; 3 are not`, lists them, and the app marks them in the report. A model adjudicating the ambiguous middle is a later addition, and it goes second, after the deterministic pass, as the research argued.

### C.8 An honest opening and an honest ending

- With no usable sources, the report opens with a plain sentence saying so, rather than a status line the user may not see.
- The report always ends with what was not covered, filled from C.2 rather than left to the writer's discretion.

**Files**: `backend/src/runtime/research.ts`, `shared/src/runs.ts` (`ResearchSource` gains `quality` and `agreedWith`; notes gain `sources`), `frontend/src/workspace/AgentActivity.tsx`, `frontend/src/workspace/useRun.ts`, docs.

**Tests**: merged corroboration cited as `[2][5]`; coverage computed and the gap note emitted; outline note numbers reaching the writer; the note budget preferring coverage over volume; the third pass when relevance filters too hard; supported and unsupported sentences classified; the no-sources opening line.

**Done when**: citation support on the eval rises materially, coverage is reported for every run, and no eval report claims a number that is not in a cited note.

---

## 8. Phase D: the second round

R2 of the original plan, scoped so it cannot run away with the budget.

**When it runs**: only when round one leaves a sub-question with no notes, or with a single uncorroborated note on a time-sensitive sub-question. An easy question stays a one-round question.

**What it searches**: uncovered sub-questions first, using a query rewritten from the sub-question (not the original query, which already failed). Then, if budget remains, up to two queries from one reflection step: the strongest reasoning model is given the sub-questions and a one-line summary of what was found, and asked for the queries that would close the gaps.

**Caps**: one extra round; at most 3 extra searches and 4 extra sources for standard; a wall-clock budget so a slow round cannot push the run past the run engine's limit. Round two's sources are read and checked exactly like round one's.

| Depth | Round 1 queries | Round 2 queries | Sources | Model requests |
| --- | ---: | ---: | ---: | ---: |
| quick | 3 | 0 | 6 | about 9 |
| standard | 6 | up to 3 | up to 16 | 15 to 21 |
| deep | 10 | up to 5 | up to 26 | 23 to 31 |

**Done when**: coverage on the eval set rises and wall clock stays inside the run limit at standard depth on a single provider.

---

## 9. Phase E: control and visibility

Small, and it is what makes the work above legible.

- **Depth picker.** The backend already validates `research.depth` (`runs.ts:119`); the app never sends it. A three-way control next to the Deep research switch, with the cost and time of each written plainly.
- **Plan preview.** The planner's sub-questions are already emitted as the planner step's text; show them at the top of the panel while the searches run, so the user can see the research going in the wrong direction early. Editing the plan before it runs stays deferred.
- **Progress.** `Reading source 4 of 12`, from counts the executor already has.
- **The sources panel** shows date, quality label, note count, corroboration, and whether the page was live-crawled.
- **Cost.** Exa dollars for the run, and a running monthly total, so a user on the $10 free allowance can see it.
- **Freshness banner** on the report: `Researched 2026-09-16. Sources from 2021-06 to 2026-09.`

---

## 10. Phase F: evaluation

Grow Phase 0's 12 questions to 30, add a model-graded coverage score for the questions deterministic grading cannot settle, and run the set before and after each phase. The log in `plan/research/eval-log.md` is the record of whether any of this worked.

Targets, to be set properly from the Phase 0 baseline:

| Measure | Baseline | Target |
| --- | --- | --- |
| Accuracy (expected fact present and correct) | to measure | +20 points |
| Cited sentences supported by their source | to measure | above 90% |
| Median source age, time-sensitive questions | to measure | under 12 months |
| Sub-questions with at least one note | to measure | above 85% |
| Exa cost per standard run | about $0.10 | no higher |
| Wall clock, standard, one provider | to measure | no higher |

---

## 11. What a run costs, before and after

Exa prices, 2026-09-16: $7 per 1,000 searches, $1 per 1,000 pages for each of text, highlights, and summary. A new account gets $20 of credit and $10 a month while the free tier lasts.

| | Today (standard) | After Phase A | After Phase B |
| --- | ---: | ---: | ---: |
| Searches | 6 | 6 to 8 | 6 to 8 |
| Pages billed for contents | 30 (text + highlights) | 30 highlights + 12 text | 30 highlights + 12 text + 12 summary |
| Exa cost | about $0.10 | about $0.09 | about $0.10 |
| Model requests | about 15 | about 15 | about 15 |

Phase A pays for itself: fetching text only for pages that will be read funds the retries, the broadening, and the live-crawls. Phase B buys a second reader for a cent a run, which is the best value in this document.

This also means the app should stop implying Deep Research is free. It runs free models on a paid search API, and the user should see the meter.

---

## 12. Risks

1. **Live-crawling is slow.** `maxAgeHours: 0` can add seconds per page. Mitigated by applying it only to picked pages, only for `fresh` sub-questions, with `livecrawlTimeout`, and by measuring it in Phase 0 before committing.
2. **Exa changes again.** Two parameters were deprecated in February and two more in July 2026. Mitigation: one place builds the request (`webSearch.ts`), the probe script is re-runnable, and the tests assert the exact request body so a drift is a test failure and not a silent quality loss.
3. **The number check drops good notes.** A page that writes "one and a half million" and a fact that writes "1.5 million" must not be dropped. Mitigation: normalise words to digits for common magnitudes, and count drops in the eval so an over-strict rule shows up as a coverage loss.
4. **A second round pushes runs past the run limit.** Mitigation: hard caps, a wall-clock budget, and round two skipped entirely when coverage is already good.
5. **More structure, more for a small free model to get wrong.** Every schema extension to the planner and reader prompts is another thing a 7B model fumbles. Mitigation: every new field is optional with a deterministic fallback, exactly as `fallbackQueries` does today, and no new field is ever required for the run to proceed.
6. **Measuring with free models is noisy.** Two runs of the same question can pick different models. Mitigation: the eval grades deterministically where it can, runs each question twice, and reports both.

---

## 13. Open questions the probe settles

The documentation does not answer these, and none of Phase A should be built on a guess:

1. What does Exa return when asked for 30,000 characters of text? (Sets `fetchChars`.)
2. Does `startPublishedDate` exclude pages Exa holds no published date for, and how many results does a typical dated search lose? (Decides how hard A.3's safety net has to work.)
3. What does `maxAgeHours: 0` cost in latency, and how often does it actually change the text? (Decides the default per freshness label.)
4. Are Exa's schema summaries good enough to stand in for a free-model reader, and do their quotes survive `quoteInPage`? (Decides whether B.1 ships.)
5. Does `category: "news"` improve the date spread enough to be worth the steering? (Decides A.5's category mapping.)
6. What does each request shape actually cost, per `costDollars`? (Replaces the price-list arithmetic in section 11.)

---

## Order of work

| Phase | Ships | Depends on |
| --- | --- | --- |
| 0 | Probe results, eval baseline | a real Exa key |
| A | Freshness, correct Exa usage, cost | 0 |
| B | Exa summary reader, number check, honest reader prompt | A (the `/contents` call) |
| C | Corroboration, coverage, note budget, support check | B (note flags) |
| D | Second round | C (coverage) |
| E | Depth, plan preview, progress, dates, cost | A, C |
| F | Full evaluation | 0 |

One branch and one pull request per phase, CI green on both runs before merging, `plan/pending.md` and `backend/docs/deep-research.md` updated with each.
