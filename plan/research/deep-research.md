# Deep research: Gemini research output

Requested 2026-09-15 with the prompt in [`plan/deep-research.md`](../deep-research.md). Pasted by the owner the same day. The text below is Gemini's, with headings and tables restored after pasting; wording unchanged.

## Review notes (Claude, 2026-09-15)

Read before relying on anything below.

**No sources.** The prompt asked for a URL and date for every claim; the output has none. Nothing below has been checked against a primary source, so every number is unverified.

**Probably outdated or wrong:**

- Gemini 1.5 Pro/Flash with 2 million tokens and 1,500 free requests a day (section 4.3). The 1.5 models were retired; current free-tier models, context sizes, and limits are different. Treat the whole Google AI Studio row as outdated.
- GitHub Models recommended for final synthesis (4.4) while the same report states an 8,000-input-token limit per request (4.1). Research notes are far larger, so it cannot do that job. Claude 3.5 Sonnet on GitHub Models was already flagged as unconfirmed in `free-models.md`.
- Cerebras recommended for bulk reading (4.4). `free-models.md` records the free tier as 5 requests per minute on the listed models, which is too few for parallel page reading, whatever the token allowance.
- DuckDuckGo HTML scraping as a fallback (3.1): unofficial and likely against its terms. Not adopted.

**Unfamiliar names, not verified to exist as described:** Keirolabs, Parallel Search (5,000 free requests), Scavio, pi-web-access, FreeRideV3, TokenShift, keyless Exa through MCP, and the benchmarks DRACO, Evo-BrowseComp, and DeepSearchQA. The search-API price table (3.1) should not be used for decisions until checked.

**Consistent with published work known to me (still worth checking before quoting numbers):** STORM's outline-first, perspective-guided questioning and Co-STORM's user steering and mind map (Stanford); ALCE for citation evaluation, and low citation support on ELI5; RouteLLM's router types; DeepResearch Bench (100 PhD-level tasks, 22 fields, RACE); BrowseComp and BrowseComp-Plus; arXiv's API guidance of one request every three seconds; OpenAlex, Semantic Scholar, and Unpaywall as free academic sources; Jina Reader and Firecrawl for URL-to-Markdown.

**Missing from what was asked:** the comparison table of open-source systems with their default numbers (rounds, queries, sources); ablation evidence for what helps weak models; a concrete 20–50 question evaluation set; free models per role with faithfulness measurements (Vectara, FACTS Grounding); the requested closing sections (recommended numbers, top risks, least-certain claims).

**Adopted into the plan** (see `plan/deep-research.md`, "Changes after research"):

1. Outline first, from several perspectives (STORM): sub-questions come from distinct viewpoints, and the report is outlined before it is written.
2. Deterministic citation checks: a reader's quote is kept only if it appears in the page text; the report's citations are checked by matching, before any model-based check (6.1, 6.3).
3. Never put an unverified citation in a model's context (6.2): only checked quotes reach the writer.
4. Interleaved citing: the writer names the note it uses before each claim (RECLAIM, 6.3).
5. Live transparency and steering: a running log of what each model is doing, and later the user can redirect a run (8.1, 8.2).
6. Academic sources for scholarly questions: OpenAlex, then Semantic Scholar, arXiv (one request every three seconds), and Unpaywall for open PDFs (3.3).
7. Page reading through a reader service (Jina Reader) when the search API returns no text (3.2).
8. Pacing per provider, so parallel readers queue within each provider's per-minute limit instead of hitting it (5.3).

**Not adopted:** semantic response caching (research needs fresh results), provider prompt caching (not offered by the free providers used), trained predictive routers (Bench already measures models; revisit later), DuckDuckGo scraping.

---

# Architecture and Design of a Zero-Cost Open-Source Deep Research Engine

## 1. Introduction: The Evolution of Autonomous Research Systems

The transition from static retrieval-augmented generation (RAG) to autonomous, long-horizon information seeking marks a profound architectural shift in artificial intelligence. This emerging paradigm, characterized as "deep research," endows large language models with the capacity to orchestrate complex, multi-step workflows. Unlike conventional RAG systems that execute a single retrieval loop against a pre-indexed corpus, deep research systems operate dynamically within the digital environment. They simulate the rigorous methodologies of human analysts by autonomously planning search strategies, navigating diverse web sources, iteratively refining hypotheses based on intermediate findings, managing vast and expanding working memories, and synthesizing highly structured, citation-grounded reports. The capability to compress hours of manual desk research into minutes represents a critical frontier in deploying agentic systems for scientific, economic, and industrial applications.

The contemporary deep research landscape is dominated by proprietary implementations, most notably OpenAI's Deep Research and Google's Gemini Deep Research. These systems rely on monolithic, highly parameterized models optimized specifically for web browsing, long-context data analysis, and autonomous tool utilization. However, the computational economics inherent in these proprietary loops are severe. Recursive search, multi-step reasoning, and extensive document synthesis rapidly consume tens of thousands of tokens per task. Consequently, these capabilities are frequently gatekept behind premium enterprise subscriptions, with the direct API costs for a single comprehensive research report ranging from $0.40 to upwards of $7.00 depending on the depth of the search tree. This cost structure fundamentally limits the scalability of autonomous research in resource-constrained environments.

Constructing a production-grade, zero-cost open-source deep research engine necessitates a radical departure from monolithic architectures. It requires the precise engineering of an orchestration graph capable of arbitraging free-tier inference allocations across disparate hardware providers. This design relies on decentralized, hierarchical delegation patterns, intelligent predictive routing mechanisms, aggressive semantic and provider-level caching, and the exploitation of cost-effective or zero-configuration search APIs. The ensuing analysis provides an exhaustive technical dissection of the architecture required to build such an engine. It evaluates existing proprietary and open systems, the unit economics of web search and academic reader APIs, the strategic allocation of free-tier large language models, the mitigation of critical failure modes such as hallucinated citations, and the implementation of micro-evaluation benchmarks essential for ensuring factual fidelity.

## 2. Architectural Paradigms of Deep Research Engines

The architecture of a deep research engine fundamentally diverges from a standard synchronous chat interface. Operating across long temporal horizons requires stateful orchestration, sophisticated error handling, and the division of labor among specialized sub-agents. A comparative analysis of proprietary and open-source frameworks reveals a distinct bifurcation in design philosophies: the monolithic approach versus the modular, hierarchical delegation graph.

### 2.1 Monolithic vs. Modular Orchestration

Proprietary systems encapsulate the research workflow within massive models fine-tuned to maintain coherence over extended trajectories. OpenAI's Deep Research feature, powered by variants of the o3 model, internalizes the reasoning, planning, and execution phases. While highly effective, this approach yields significant latency, with complex tasks routinely exhibiting execution times exceeding 1,800 seconds and generating outputs that can surpass 24,000 tokens. The opacity of these models precludes granular optimization by the user.

Conversely, open-source frameworks such as LangChain's open_deep_research, HuggingFace's smolagents/open_deep_research, and Jina AI's node-DeepResearch utilize modular, graph-based orchestration. This modularity is the cornerstone of a zero-cost engine, allowing developers to decouple the intelligence layer into discrete, swappable components. By isolating the planner, the searcher, and the synthesizer, the system can route each specific task to the most economically viable inference provider, rather than utilizing a costly frontier model for the entire pipeline.

### 2.2 Hierarchical Delegation and Specialized Agent Roles

The most advanced open-source architectures divide the research workload into highly specialized roles, creating a virtual research team. This separation of concerns minimizes the context window required for any single inference call, thereby reducing token consumption and mitigating context-loss degradation.

In sophisticated implementations, particularly those designed for rigorous economic or scientific research, the architecture initiates with an Ideator agent responsible for decomposing the user's prompt into a set of discrete, testable hypotheses. The output of the Ideator is passed to a TopicCrawler or Execution Agent, which interfaces with external search tools and academic repositories to gather raw data. A Contextualizer then maps these empirical findings to established theoretical frameworks, while an Estimator executes required analytical operations. Crucially, these systems incorporate structured error escalation pathways. For example, if a DataCleaner agent encounters inconsistencies or structural breaks in retrieved data, it can autonomously trigger alternative statistical or retrieval techniques without requiring human intervention. Finally, a Publisher or Synthesis Agent aggregates the asynchronous findings into a unified, formatted report, complete with inline citations.

### 2.3 Outline-First vs. Execution-First Paradigms

Within the open-source ecosystem, the strategy for initiating research largely falls into two paradigms. Frameworks like GPT-Researcher deploy an execution-first approach, where a planner immediately generates search questions and dispatches parallel execution agents to scour the web. While efficient, this can lead to premature convergence, where the final report reflects the narrow biases of the initial search queries.

Stanford's STORM (Synthesis of Topic Outlines through Retrieval and Multi-perspective Question Asking) introduces a superior outline-first paradigm specifically designed for knowledge curation and Wikipedia-style article generation. STORM addresses the limitations of direct prompting through "Perspective-Guided Question Asking". The system initially surveys the topic to discover diverse viewpoints, utilizing these perspectives to instantiate distinct persona-driven agents (e.g., a "Quantum Physics Researcher" versus an "Industry Applications Specialist"). These agents engage in a simulated discourse with a central topic expert grounded in trusted internet sources. This adversarial exploration forces the system to map the breadth and depth of a topic comprehensively before generating a hierarchical outline, ensuring the final synthesis phase is balanced and exhaustive. Integrating STORM's pre-writing methodology is highly recommended for zero-cost engines aiming for academic rigor.

## 3. The Economics and Infrastructure of Agentic Information Acquisition

An autonomous research agent is entirely constrained by its access to high-fidelity, machine-readable information. The economics of search and extraction APIs dictate the feasibility of a zero-cost engine, as an exhaustive deep research loop may autonomously execute dozens of queries and scrape hundreds of URLs. Navigating the opaque pricing structures of these providers is essential.

### 3.1 Analyzing the Unit Economics of Search APIs

The market for search APIs optimized for AI agents exhibits extreme price variance, obfuscated by complex credit systems and endpoint-specific surcharges. Evaluating the true cost per 1,000 queries (1K) reveals significant disparities that directly impact architectural decisions.

| Search Provider | True Cost per 1,000 Queries | Core Characteristics & Free Tier Allowances |
| --- | --- | --- |
| Keirolabs | $0.10 (SERP) / $0.25 (Semantic) | Highly cost-effective; integrates semantic retrieval and SERP data; generous free entry tier. |
| Parallel Search | $1.00 (Turbo Mode) | 5,000 free requests per month; provides ~200ms latency; highly scalable for parallel agent execution. |
| Brave Search API | $5.00 | $5 monthly free credits (~1,000 queries); independent index not reliant on Google; zero data retention privacy model. |
| Tavily | $8.00 (Basic) / $16.00 (Advanced) | Optimized explicitly for AI agents with bundled Markdown extraction; high baseline cost. |
| Exa | $7.00 to $27.00+ | Neural next-link prediction; $7/1K headline rate scales drastically to $27/1K when requesting 30 results; 1,000 free queries/month. |
| Scavio | $4.28 (Entry Paid Tier) | 50 free signup credits; combines Google SERP, YouTube transcripts, and Amazon data; utilizes headless JavaScript rendering. |

A robust zero-cost engine must utilize a cascading fallback chain to maximize free allowances across multiple providers before incurring costs. Implementations such as pi-web-access demonstrate optimal fallback logic. The system first attempts to query a self-hosted, private SearXNG instance. If unsuccessful, it attempts zero-configuration endpoints like Exa via Model Context Protocol (MCP) requiring no API key, followed by authenticated calls to Brave, Parallel, Keirolabs, and Tavily. If all structured APIs exhaust their free tiers or rate limit, the system falls back to keyless DuckDuckGo HTML scraping, though this requires local decoding of redirect URLs and lacks stable recency filters.

### 3.2 Content Extraction and Semantic Noise Reduction

Raw HTML is highly inefficient for language models, consuming vast token budgets with markup tags, navigation elements, and structural noise. The engine requires deterministic extraction layers that convert target URLs into clean, LLM-ready Markdown.

Services such as Jina Reader and Firecrawl specialize in URL-to-Markdown conversion, frequently deploying headless browsers to render JavaScript-heavy dynamic sites prior to extraction. However, converting complex documents, particularly academic PDFs, requires deterministic parsing engines rather than generative approximations. Tools utilizing dedicated extraction engines preserve critical document structures—such as data tables, multi-column reading orders, and mathematical notation—with significantly higher fidelity than naive optical character recognition or generative vision models. The extraction module should also support local repository cloning (e.g., GitHub URLs) rather than shallow HTML scraping, allowing the agent to explore native file contents and directory structures.

### 3.3 Navigating Academic Literature Endpoints

For scientific and academic deep research, standard web search is insufficient, as it frequently surfaces secondary sources or paywalled abstracts. The engine must interface directly with scholarly graphs.

The Semantic Scholar Academic Graph (S2AG) provides an excellent free REST API, offering rich metadata, citation networks, and abstract access, with higher rate limits available via free registration. OpenAlex offers a highly comprehensive, free alternative that intentionally merges metadata from Crossref, PubMed, and Microsoft Academic, bypassing the need to query multiple distinct sources. For preprint access, arXiv is indispensable; however, its API enforces strict rate limits (e.g., 1 request per 3 seconds) that must be managed via global module-level locks to prevent IP bans during parallel agent execution. A sophisticated academic retrieval module sequences its queries strategically: searching OpenAlex first for merged metadata, falling back to Semantic Scholar for citation verification, targeting arXiv for preprints, and utilizing Unpaywall to resolve Digital Object Identifiers (DOIs) to open-access PDF URLs.

## 4. Arbitraging Free LLM Allocations and Compute Substrates

The most formidable barrier to deploying a zero-cost system is the massive compute requirement for language model inference. However, the aggressive competition among specialized hardware providers, API gateways, and frontier model developers has cultivated a vast ecosystem of free-tier inference. A zero-cost engine achieves viability by dynamically orchestrating tasks across these disparate providers based on the specific context, latency, and reasoning requirements of each sub-task.

### 4.1 Inference Gateways and Aggregators

Aggregators provide a unified, OpenAI-compatible API layer over dozens of underlying models, significantly simplifying integration and failover logic.

| Aggregator | Core Limitations & Allowances | Strategic Utility in Deep Research |
| --- | --- | --- |
| OpenRouter | 20 Requests Per Minute (RPM); 50 Requests Per Day (RPD) on :free variants; expands to 1,000 RPD after a one-time $10 credit purchase. | Excellent for rapid prototyping and accessing diverse open weights (Nemotron, Cohere). Free traffic is deprioritized, leading to latency spikes during peak usage. |
| Hugging Face Serverless | 1,000 requests per day for registered users; 20,000 for PRO users. Hard limits on token throughput. | Ideal for accessing niche community models or specialized embedding tasks. Not suitable for heavy production agent loops due to strict request throttling. |
| GitHub Models | 15 RPM; 150 RPD; 8,000 input tokens / 4,000 output tokens per request on the Copilot Free tier. | Provides unprecedented zero-cost access to frontier models (GPT-4o, Claude 3.5 Sonnet). Must be strictly reserved for the final synthesis phase. |
| Cloudflare Workers AI | 10,000 Neurons per day free allocation. Operates via edge-native deployments. | Highly reliable edge inference for smaller models (Llama 3 8B), though neuron accounting can deplete quickly on longer generations. |

### 4.2 High-Throughput Silicon Specialists

For the planning and execution phases—where the agent must rapidly generate dozens of search queries, filter scraped text, and maintain situational awareness—throughput and time-to-first-token are paramount.

Groq utilizes custom Language Processing Units (LPUs) to deliver unprecedented speeds, generating 300 to 500+ tokens per second on large open models like Llama 3.3 70B. The Groq free tier provides generous token limits (30,000 tokens per minute and 14,400 requests per day), making it highly attractive for deep research. However, the strict 30 RPM limit poses a critical bottleneck for agentic loops; a multi-step research agent can easily fire dozens of rapid reflection calls within seconds, instantly exhausting the per-minute quota and causing the agent to stall mid-execution.

Cerebras addresses the volume constraint by leveraging wafer-scale silicon, achieving over 2,600 tokens per second while offering a staggering free tier of 1 million tokens per day (resetting daily at 00:00 UTC). This unmatched capacity positions Cerebras as the optimal provider for the most token-intensive phase of deep research: ingesting and summarizing massive volumes of scraped web text. The primary trade-off is a slightly maturing platform that occasionally lacks support for specific OpenAI parameters (e.g., frequency_penalty), requiring careful adaptation of the agent's system prompts.

### 4.3 Context-Heavy Providers for Synthesis

The final stage of deep research—synthesizing disparate notes, extracting overarching themes, and generating a cohesive, cited report—demands massive context windows.

Google AI Studio provides the most generous free tier for context-heavy workloads, offering access to Gemini 1.5 Pro and Gemini 1.5 Flash models capable of handling up to 2 million tokens of context. The free tier permits 1,500 requests per day at zero cost. This endpoint must be allocated exclusively for the Publisher agent. Developers must note that prompts processed through the free tier may be utilized for model training depending on geographic privacy regulations, requiring data sanitization if handling sensitive proprietary information.

### 4.4 Optimized Workload Distribution Strategy

A meticulously engineered zero-cost engine distributes workloads to exploit the specific strengths of these providers:

- **Query Generation & Reflection:** Routed to Groq (Llama 3.3 70B) to leverage 500+ t/s latency for instantaneous planning.
- **Bulk Document Processing:** Routed to Cerebras (Llama 3.1 8B/70B) to consume the 1 million daily token allowance for evaluating and summarizing scraped URLs.
- **Complex Reasoning & Report Synthesis:** Routed to GitHub Models (GPT-4o) for superior instruction following on complex report formatting, or Google AI Studio (Gemini 1.5 Flash) when the aggregated research notes exceed 100,000 tokens.

## 5. Intelligent Routing and Rate-Limit Management

Deploying an architecture that relies on multiple free-tier endpoints introduces severe system fragility. The engine is constantly exposed to varying rate limits, unexpected model deprecations, IP throttling, and upstream provider errors (such as 429 Too Many Requests or 402 Payment Required). Ensuring continuous execution requires a robust intelligent routing layer and rigorous token optimization.

### 5.1 Predictive Model Routing

Hardcoding specific models for specific tasks is brittle. Advanced deep research engines employ predictive routing, automatically classifying the complexity of the incoming prompt and dynamically selecting the most efficient model that meets the required quality threshold.

Frameworks such as RouteLLM and Not Diamond optimize this process using lightweight meta-models.

- **Matrix Factorization Routers:** Inspired by collaborative filtering in recommendation systems, this approach models the routing decision as a bilinear calculation of model and query embeddings. By learning a low-rank factorization of the score matrix, the router can achieve 95% of GPT-4's performance while reducing calls to the expensive model by 74%, seamlessly directing simpler extraction tasks to local or free-tier models.
- **Classifier Models:** Fine-tuned BERT classifiers or small Causal LLMs can analyze semantic patterns indicating query difficulty in under 100 milliseconds.

A critical consideration in training these routers is the source data. While early research relied on full-feedback datasets (where every query is evaluated by every model), this is computationally prohibitive to maintain. State-of-the-art predictive routers increasingly utilize observational data from real-world deployments. However, this introduces treatment bias from historical routing policies, necessitating causal frameworks that directly minimize decision-making regret rather than relying on decoupled quality predictors.

### 5.2 Context Caching and Token Optimization

To maximize free-tier viability, the system must aggressively optimize token expenditure across the orchestration graph. Token optimization platforms (e.g., Portkey, TokenShift) provide centralized visibility, but the underlying mechanisms must be engineered into the agent's logic.

- **Provider Prompt Caching:** Providers like Anthropic and OpenAI offer steep token discounts for reusing stable prefixes. A cache read can cost as little as 0.1x the base input price, representing a 90% discount. However, writing to the cache incurs a premium (e.g., 1.25x for a 5-minute Time-To-Live). The engine's architectural rule must be structurally rigid: place all stable content (system prompts, persona definitions, schema formatting, standard few-shot examples) at the absolute beginning of the prompt, and append the highly variable content (the specific search query or retrieved text) at the very end.
- **Semantic Response Caching:** To eliminate redundant calls, libraries like GPTCache embed the user's query and compare it against a vector database of previous executions. If the cosine similarity exceeds a rigorous threshold (typically tuned between 0.75 and 0.85 to avoid false positives), the system serves the cached response, completely bypassing the LLM inference phase and reducing overall API calls by up to 68% on repetitive workloads.

### 5.3 Heat Management and Fallback Chains

When an agentic loop enters a multi-step refactoring or recursive search phase, it burns through requests rapidly, inevitably colliding with provider constraints. The failure mode is typically a stalled agent halfway through a complex thought process, destroying the session.

A dedicated "Heat Management" module, analogous to the logic found in FreeRideV3, is mandatory. The engine must maintain a real-time status registry of all configured API keys and endpoints.

- Upon encountering a RATE_LIMIT (429) or AUTH error, the module marks that specific provider/key pair as "cooling," honors the Retry-After HTTP header if present using exponential backoff, and instantly shifts the request to the next available key on the same provider.
- If a MODEL_NOT_FOUND or QUOTA_EXHAUSTED (402) error occurs, indicating a hard stop, the module abandons the provider entirely and shifts to the next provider in the configured fallback chain (e.g., failing over from Groq to Cerebras to OpenRouter).

## 6. Failure Modes, Robustness, and the Citation Crisis

As deep research systems operate with increasing autonomy, their failure modes compound. A misinterpretation during the query planning phase or a retrieval failure in the execution phase propagates exponentially through the synthesis phase, resulting in highly fluent but factually hollow reports. The most critical and insidious failure mode in deep research is unfaithful or hallucinated attribution.

### 6.1 The Crisis of Citation Verification

Deep research agents derive their utility from grounding claims in retrieved documents. However, guaranteeing that a generated claim is faithfully supported by the cited source is a mathematically and linguistically complex challenge. The ALCE (Automatic LLMs' Citation Evaluation) benchmark demonstrates that even state-of-the-art systems exhibit significant deficits; on complex datasets like ELI5, up to 50% of generated claims lack complete, faithful citation support.

Evaluating citation faithfulness using an "LLM-as-a-judge" methodology introduces severe instability. Empirical studies demonstrate that evaluating the exact same agent output across different verifier models yields unsupported-citation rates fluctuating wildly from 3% to 18%, dictated entirely by the strictness of the chosen verifier. While automated verifiers generally agree on which citations are definitively supported, they exhibit massive negative-class disagreement on which citations to flag as unsupported. Consequently, the reported unsupported-citation rate is highly verifier-dependent, meaning a single, uncalibrated number cannot be trusted for deployment metrics.

### 6.2 The Destructive Impact of Fabricated Citations

The presence of citations—whether genuine or fabricated—exerts a profound psychological and statistical pressure on the language model's generation probabilities. Research utilizing a fully balanced 2x2 factorial design (independently manipulating claim veracity and citation veracity) reveals that injecting a fabricated citation into the context window consistently and significantly increases hallucination rates across all tested models.

The most alarming finding occurs when a fabricated citation accompanies a factually correct claim. Under the authority pressure of the false citation, the model frequently capitulates, denying correct facts and adopting the hallucination. This phenomenon raises overall hallucination rates by 3 to 22 percentage points, reaching failure rates of 35% to 77% in general knowledge domains.

### 6.3 Architectural Mitigation Strategies

To combat these vulnerabilities, a zero-cost engine must enforce strict guardrails during the synthesis phase:

- **Interleaved Generation (RECLAIM):** Traditional RAG systems often generate a monolithic block of text and attempt to post-rationalize citations at the end, leading to high error rates. The engine should implement interleaved generation, forcing the model to explicitly generate a reference constraint first, followed immediately by the sentence-level claim derived from that specific reference.
- **Deterministic Re-attribution:** Given the unreliability of generative verifiers, the engine must employ deterministic algorithms (such as BM25 or exact substring matching) to map generated claims back to the exact scraped text snippets. This provides a mathematical guarantee of source provenance.
- **Split-Conformal Guards:** For enterprise deployments, implementing a distribution-free, finite-sample statistical bound on the output guarantees that the rate of truly unsupported citations slipping past the system's flagging rule remains below a mathematically defined threshold, providing a vital safety mechanism.

## 7. Micro-Evaluation Benchmarks for Deep Research

Evaluating the efficacy of a deep research engine requires specialized benchmarks that transcend traditional multiple-choice knowledge evaluations. The system must be rigorously assessed on trajectory coherence, search persistence, retrieval precision, and synthesis capability.

### 7.1 Comprehensive Benchmark Frameworks

The academic community has rapidly established evaluation frameworks specifically targeted at long-horizon agentic search:

- **DeepResearch Bench:** A foundational framework consisting of 100 PhD-level research tasks meticulously crafted by domain experts across 22 distinct fields, reflecting real-world demand patterns analyzed from over 96,000 user queries. It utilizes a Reference-based Adaptive Criteria-driven Evaluation (RACE) to assess the final report's quality, alongside metrics for effective citation count and overall citation accuracy.
- **BrowseComp and Evo-BrowseComp:** These benchmarks specifically evaluate the horizontal search capabilities of browsing agents, focusing on their persistence and creativity in locating obscure facts across the live web. To combat model data contamination, Evo-BrowseComp continuously synthesizes new questions from live-web traversal. BrowseComp-Plus further refines this by utilizing a fixed, human-verified corpus with challenging negative documents to isolate the performance of the retrieval mechanism from the language model's reasoning capabilities.
- **DRACO (Deep Research Accuracy, Completeness, and Objectivity):** Utilizing 100 complex, anonymized queries sourced directly from production deep research systems, DRACO evaluates models on factual accuracy (verifiable claims that must be correct) and the breadth and depth of analysis (the ability to synthesize sources, identify knowledge gaps, and evaluate trade-offs).
- **LiveResearchBench:** Features 100 expert-curated queries paired with highly detailed rubrics. It deliberately addresses the ambiguity of open-ended tasks by explicitly specifying the scope, target audience, and required output format, enabling precise measurement of coverage, reasoning, and presentation quality.
- **DeepSearchQA:** Focuses heavily on the agent's ability to execute complex search plans to generate exhaustive answer lists. It explicitly tests the systematic collation of fragmented information, deduplication, entity resolution, and the crucial ability of the agent to recognize stopping criteria within an open-ended search space.
- **ALCE (Automatic LLMs' Citation Evaluation):** Evaluates the end-to-end citation quality of generated text. It utilizes MAUVE to measure fluency and a Natural Language Inference (NLI) model to measure citation precision and recall, demonstrating that evaluation across these dimensions prevents systems from exploiting shortcuts.

### 7.2 Core Evaluation Metrics

A highly capable deep research engine should implement an automated evaluation loop that periodically tests its architecture against these benchmarks. The core metrics include:

- **Optimal Selection Ratio:** The proportion of queries where the predictive routing layer successfully selects the cheapest, fastest model that still produces a correct response, penalizing the unnecessary invocation of expensive frontier models.
- **Gain@b and Gap@Oracle:** Measures the performance gain relative to a standard baseline, and the remaining accuracy gap compared to an instance-wise optimal routing scenario (the theoretical "Oracle" router).

## 8. User Experience (UX) Patterns for Long-Horizon AI

The user experience (UX) of a deep research engine must reflect the temporal and computational realities of the underlying architecture. Because comprehensive research tasks execute over several minutes, deploying a traditional synchronous chat interface results in a severely degraded experience, characterized by timeout errors, perceived unresponsiveness, and lack of user control.

### 8.1 Streaming Execution and Operational Transparency

To mitigate latency anxiety, the user interface must stream the internal state of the orchestration graph in real-time. As the Planner agent generates sub-queries, as the Executors retrieve URLs, and as the Contextualizers parse content, these discrete actions should be rendered as a continuous execution log or terminal-style output. This operational transparency is critical; it builds user trust and allows for immediate human intervention if the agent begins to hallucinate a search trajectory or hyper-fixate on irrelevant sources.

### 8.2 Collaborative Discourse and Cognitive Offloading

Advanced frameworks have introduced highly effective UX patterns specifically tailored for deep knowledge curation.

- **Collaborative Discourse Protocols:** Rather than relying on a single "fire-and-forget" prompt, systems like Co-STORM engage the user in a turn-based policy. The human operator can observe the discourse between the internal agents and inject utterances to actively steer the discussion focus, correct assumptions mid-flight, or narrow the scope of the research.
- **Dynamic Mind Maps:** As information is scraped and evaluated, the system continuously updates a hierarchical concept structure (a mind map) visible to the user. This constructs a shared conceptual space between the human and the machine, significantly reducing the cognitive load required to review long, in-depth reports, while visually mapping the breadth and depth of the agent's exploration.

By embracing operational transparency, collaborative steering, and visual knowledge representation, the UX transforms the deep research engine from a black-box oracle into an interactive, highly controllable research assistant.
