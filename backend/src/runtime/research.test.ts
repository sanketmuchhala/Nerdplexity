import { describe, expect, it } from 'vitest';
import type { AgentStep, RunMessage } from '@app/types';
import { resolveTarget } from './destinations.js';
import type { ProgressPayload } from './runs.js';
import { RouterHealth, type RouteCandidate } from './router.js';
import { checkCitations, extractNotes, fallbackQueries, hasNotes, hasPlan, jsonIn, pageRelevant, parseResearchPlan, pickSources, quoteInPage, readNotes, recencySince, relevantSlice, researchExecutor, searchPhrase } from './research.js';
import { validateRunRequest } from '../routes/runs.js';

const target = resolveTarget({ kind: 'openrouter', apiKey: 'sk-or-test-key' });
const candidate = (model: string): RouteCandidate => ({ connectionId: 'or', model, target, capabilities: { tools: true, vision: false }, contextLength: 131_072 });
const models = () => [candidate('meta-llama/llama-3.3-70b-instruct:free'), candidate('qwen/qwen3-32b:free'), candidate('google/gemma-3-27b-it:free')];
const user = (content: string): RunMessage[] => [{ role: 'user', content }];

/** A reply the model was cut off in the middle of, as a provider reports it. */
const truncated = (text: string) => new Response(
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
  { headers: { 'content-type': 'text/event-stream' } },
);

const sse = (text: string) => new Response(
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
  { headers: { 'content-type': 'text/event-stream' } },
);

const PAGES: Record<string, { title: string; url: string; text?: string; highlights?: string[] }[]> = {
  'eiffel height': [
    { title: 'Eiffel Tower facts', url: 'https://example.com/eiffel?utm_source=x', text: 'The Eiffel Tower is 330 metres tall, including its antennas. It was completed in 1889.' },
    { title: 'Paris guide', url: 'https://travel.example.org/paris', text: 'Paris has many landmarks. The tower draws about seven million visitors a year.' },
  ],
  'eiffel history': [
    { title: 'Eiffel Tower facts (again)', url: 'https://www.example.com/eiffel/', text: 'Duplicate page.' },
    { title: 'An unrelated blog', url: 'https://blog.example.net/post', text: 'Nothing about towers here at all.' },
  ],
  'eiffel visitors': [
    // No page text, but the search engine's own extract of it.
    { title: 'Eiffel Tower summit tickets', url: 'https://extract.example.com/', highlights: ['Tickets to the summit cost 29.40 euros for adults in 2026.'] },
    { title: 'Visitor numbers', url: 'https://stats.example.com/visits', text: 'In 2023 the monument welcomed 6.3 million visitors, most of them from abroad.' },
  ],
};

type Role = 'planner' | 'reader' | 'outliner' | 'writer';

/** Exa and every model, faked. Readers quote the page truthfully, plus one invented quote. */
function fakeWorld(options: { writer?: (note: string) => string; noPages?: boolean } = {}) {
  const calls: { role: Role; model: string; body: any }[] = [];
  const searches: any[] = [];
  const fn = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body));
    if (String(url).includes('api.exa.ai')) {
      searches.push(body);
      const pages = options.noPages ? [] : PAGES[body.query] ?? [];
      return new Response(JSON.stringify({ results: pages.map(p => ({
        title: p.title, url: p.url, publishedDate: '2026-01-02', ...(p.text ? { text: p.text } : {}), ...(p.highlights ? { highlights: p.highlights } : {}),
      })) }), { headers: { 'content-type': 'application/json' } });
    }
    const system = body.messages.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n');
    const role: Role = system.includes('You plan web research') ? 'planner' : system.includes('You read one web page') ? 'reader'
      : system.includes('You outline a research report') ? 'outliner' : 'writer';
    calls.push({ role, model: body.model, body });
    if (role === 'planner') {
      return sse(JSON.stringify({
        perspectives: ['Engineer', 'Tourist'],
        questions: [{ question: 'How tall is it?', queries: ['eiffel height', 'eiffel history'] }, { question: 'How many visit?', queries: ['eiffel visitors'] }],
      }));
    }
    if (role === 'reader') {
      const page: string = body.messages.at(-1).content;
      if (page.includes('330 metres')) return sse(JSON.stringify({ notes: [
        { fact: 'It is 330 m tall.', quote: 'The Eiffel Tower is 330  metres tall', question: 1 },
        { fact: 'It is made of gold.', quote: 'The tower is made of solid gold.', question: 1 },
      ] }));
      // Lines instead of JSON, with the quote reworded: it is matched back to the page's own sentence.
      if (page.includes('seven million')) return sse('- About 7 million visit each year -- "the tower attracts roughly seven million visitors annually"');
      if (page.includes('6.3 million')) return sse(JSON.stringify({ notes: [{ fact: '6.3 million visited in 2023.', quote: 'In 2023 the monument welcomed ... 6.3 million visitors', question: 2 }] }));
      // Nothing usable from the reader: the search extract stands in.
      return sse('I could not find anything relevant on this page.');
    }
    if (role === 'outliner') return sse(JSON.stringify({ sections: [{ heading: 'Height', notes: [1] }, { heading: 'Visitors', notes: [2, 3, 99] }] }));
    const note = body.messages.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n');
    return sse(options.writer ? options.writer(note) : 'It is 330 m tall [1]. About 6 to 7 million people visit a year [2][3]. Some say more [9].');
  }) as typeof fetch;
  return { fn, calls, searches };
}

async function runResearch(fetchImpl: typeof fetch, messages = user('How tall is the Eiffel Tower and how many people visit it?'), depth: 'quick' | 'standard' = 'standard') {
  const events: ProgressPayload[] = [];
  const executor = researchExecutor(
    { owner: 'u', candidates: models(), request: { maxTokens: 512 }, messages, tools: [], documents: [], search: { apiKey: 'exa-key-123456' }, research: { depth } },
    { health: new RouterHealth(), fetchImpl, enqueue: task => task() },
  );
  const result = await executor({ signal: new AbortController().signal, emit: e => events.push(e) });
  const steps = events.filter((e): e is Extract<ProgressPayload, { type: 'agent' }> => e.type === 'agent');
  const final = (id: string) => [...steps].reverse().find(s => s.id === id) as AgentStep | undefined;
  return { result, events, steps, final, text: events.flatMap(e => e.type === 'delta' ? [e.text] : []).join('') };
}

describe('Deep Research parts', () => {
  it('plans within the search budget, first query of every sub-question before any second one', () => {
    const reply = JSON.stringify({ perspectives: ['A', 'B'], questions: [
      { question: 'One?', queries: ['heat pump cold climate', 'heat pump field study'] },
      { question: 'Two?', queries: ['heat pump payback period', 'HEAT PUMP COLD CLIMATE'] },
      { question: 'Three?', queries: ['heat pump rebates 2026'] },
    ] });
    expect(parseResearchPlan(reply, 'x', 3).questions.map(q => q.queries)).toEqual([['heat pump cold climate'], ['heat pump payback period'], ['heat pump rebates 2026']]);
    expect(parseResearchPlan(reply, 'x', 4).questions.map(q => q.queries)).toEqual([['heat pump cold climate', 'heat pump field study'], ['heat pump payback period'], ['heat pump rebates 2026']]);
  });

  it('keeps a quote only when it is on the page, forgiving case, spacing, curly quotes, and ellipses', () => {
    const page = 'The Eiffel Tower is 330 metres tall, including its antennas. It was “completed” in 1889.';
    expect(quoteInPage('the eiffel tower is 330   metres TALL', page)).toBe(true);
    expect(quoteInPage('It was "completed" in 1889', page)).toBe(true);
    expect(quoteInPage('The Eiffel Tower is ... including its antennas', page)).toBe(true);
    expect(quoteInPage('including its antennas ... The Eiffel Tower is', page)).toBe(false);
    expect(quoteInPage('The tower is made of solid gold.', page)).toBe(false);
    expect(quoteInPage('330 metres', page)).toBe(false);
  });

  it('takes sources in turn from each search, once each, and spreads them across websites', () => {
    const page = (url: string) => ({ title: url, url, text: 'x', highlights: [] });
    const search = (query: string, ...pages: ReturnType<typeof page>[]) => ({ query, question: `about ${query}`, pages });
    const picked = pickSources([
      search('one', page('https://a.com/1?utm_source=z'), page('https://a.com/2')),
      search('two', page('https://www.a.com/1/#top'), page('https://b.com/1')),
    ], 10);
    expect(picked.map(p => p.page.url)).toEqual(['https://a.com/1?utm_source=z', 'https://a.com/2', 'https://b.com/1']);
    // Each source remembers the search that found it, for its reader.
    expect(picked[2]).toMatchObject({ query: 'two', question: 'about two' });
    expect(pickSources([search('one', page('https://a.com/1'), page('https://a.com/2')), search('two', page('https://b.com/1'))], 2).map(p => p.page.url))
      .toEqual(['https://a.com/1', 'https://b.com/1']);

    // At most two from one website while others remain; the rest of the budget is filled anyway.
    const oneSite = [search('q', page('https://a.com/1'), page('https://a.com/2'), page('https://a.com/3'), page('https://a.com/4')), search('r', page('https://b.com/1'))];
    expect(pickSources(oneSite, 3).map(p => p.page.url)).toEqual(['https://a.com/1', 'https://b.com/1', 'https://a.com/2']);
    expect(pickSources(oneSite, 5).map(p => p.page.url)).toHaveLength(5);
  });

  it('reads the part of a long page that is about the question', () => {
    const filler = 'Unrelated background about the building trade and its history. '.repeat(40);
    const wanted = 'Tickets to the summit cost 29.40 euros for adults, and the lift runs every ten minutes.';
    const page = `An introduction to the tower.\n\n${filler}\n\n${wanted}\n\n${filler}`;
    const slice = relevantSlice(page, 'What do summit tickets cost?', 1200);
    expect(slice).toContain(wanted);
    expect(slice).toContain('An introduction to the tower.');
    expect(slice.length).toBeLessThanOrEqual(1200);
    expect(slice).toContain('[...]');
    // A page that already fits is left alone.
    expect(relevantSlice('short page', 'anything', 1200)).toBe('short page');
  });

  it('reads citations like [2], [2][5], [2, 5], and [2-4], and ignores Markdown links', () => {
    expect(checkCitations('A [1]. B [2][3]. C [2, 4]. D [3-5]. E [9]. [link](https://x.y) F [6](https://z)', 5))
      .toEqual({ count: 6, cited: [1, 2, 3, 4, 5], invalid: [9], uncited: [] });
    expect(checkCitations('No citations.', 2)).toEqual({ count: 0, cited: [], invalid: [], uncited: [1, 2] });
  });

  it('never searches with the whole message: a plan that fails becomes short queries from its questions', () => {
    const long = [
      'I am evaluating heat pumps for a cold-climate retrofit and need the evidence.',
      'How do air-source heat pumps perform below -20C?',
      'What do field studies report about seasonal efficiency in Maine and Minnesota?',
    ].join('\n\n');
    // The message's own questions become the queries; its opening statement is not one.
    const queries = fallbackQueries(long, 6);
    expect(queries).toHaveLength(2);
    expect(queries.every(q => q.length <= 180 && q.split(' ').length <= 14)).toBe(true);
    expect(queries[0]).toContain('below -20C');
    expect(queries.join(' ')).not.toContain('I am evaluating');
    // The planner's own queries are shortened the same way.
    const wordy = JSON.stringify({ questions: [{ question: 'Q', queries: [`${'word '.repeat(40)}end`] }] });
    expect(parseResearchPlan(wordy, long, 6).questions[0].queries[0].split(' ').length).toBe(14);
    expect(searchPhrase('## **Heat pumps** in `cold` climates')).toBe('Heat pumps in cold climates');
  });

  it('turns a long structured comparison into topic-specific fallback searches', () => {
    const prompt = [
      'Perform a comprehensive, comparative deep research analysis detailing the operational, technological, regulatory, and economic divergence between Waymo (Alphabet) and Tesla in the autonomous mobility / robotaxi race.',
      'Your analysis must explicitly cover the following four domains, utilizing the most up-to-date data available up to 2026:',
      '1. HARDWARE SUITE, COMPUTE STACK & SENSOR BOM:',
      '- Compare Waymo\u2019s 6th-generation Driver on the Zeekr platform versus Tesla\u2019s Vision-only architecture.',
      '2. SAFETY GOVERNANCE, CRASH METRICS & REGULATORY PERMITTING:',
      '3. FLEET OPERATIONS, DEPLOYMENT SCALE & GO-TO-MARKET:',
      '4. UNIT ECONOMICS, TCO & THE PATH TO PROFITABILITY:',
    ].join('\n');
    const queries = fallbackQueries(prompt, 6);
    expect(queries).toHaveLength(5);
    expect(queries.every(query => /waymo/i.test(query) && /tesla/i.test(query))).toBe(true);
    expect(queries).toEqual(expect.arrayContaining([
      expect.stringMatching(/hardware.*compute.*sensor.*bom/i),
      expect.stringMatching(/safety.*crash.*regulatory.*permitting/i),
      expect.stringMatching(/fleet.*operations.*deployment.*scale/i),
      expect.stringMatching(/unit.*economics.*tco.*path.*profitability/i),
    ]));
    expect(queries.join(' ')).not.toMatch(/perform a comprehensive|your analysis must/i);

    // A planner that copies an instruction fragment is discarded in favor of these fallbacks.
    const copied = JSON.stringify({ questions: [{ question: 'Do the research', queries: ['Perform a comprehensive comparative deep research analysis'] }] });
    expect(parseResearchPlan(copied, prompt, 6).questions.flatMap(q => q.queries)).toEqual(queries);
  });

  it('asks for recent pages only when the question is about now', () => {
    const now = new Date(Date.UTC(2026, 8, 16));
    expect(recencySince('What is the latest on heat pump rebates?', now)).toBe('2025-03-16');
    expect(recencySince('What happened in 2026?', now)).toBe('2025-03-16');
    expect(recencySince('How does a heat pump work?', now)).toBeUndefined();
  });

  it('keeps notes a reader writes as lines, repairs a reworded quote, and drops what the page does not say', () => {
    const page = { title: 'T', url: 'https://e.com', text: 'The tower draws about seven million visitors a year. It opened in 1889.', highlights: [] };
    const lines = readNotes('- About 7 million visit each year -- "the tower attracts roughly seven million visitors annually"\n- It is gold -- "the tower is solid gold"', page);
    expect(lines.kept).toEqual([{ fact: 'About 7 million visit each year', quote: 'The tower draws about seven million visitors a year.' }]);
    expect({ repaired: lines.repaired, dropped: lines.dropped, fromExtract: lines.fromExtract }).toEqual({ repaired: 1, dropped: 1, fromExtract: false });
    // JSON in a code fence still parses.
    expect(readNotes('```json\n{"notes":[{"fact":"It opened in 1889.","quote":"It opened in 1889."}]}\n```', page).kept).toHaveLength(1);
  });

  it('falls back to the search extract when a reader finds nothing', () => {
    const page = { title: 'T', url: 'https://e.com', text: '', highlights: ['Tickets cost 29.40 euros for adults in 2026.', 'The lift runs every ten minutes.'] };
    const found = readNotes('I could not find anything relevant.', page);
    expect(found.fromExtract).toBe(true);
    expect(found.kept.map(n => n.quote)).toEqual(['Tickets cost 29.40 euros for adults in 2026.', 'The lift runs every ten minutes.']);
    expect(extractNotes({ ...page, highlights: [] }).length).toBe(0);
    const unrelated = { title: 'Neobank market report', url: 'https://e.com/bank', text: '', highlights: ['Digital banks gained customers in Europe.'] };
    expect(pageRelevant(unrelated, 'Waymo Tesla robotaxi fleet operations')).toBe(false);
    expect(readNotes('{"notes":[]}', unrelated, 'Waymo Tesla robotaxi fleet operations').kept).toEqual([]);
  });

  it('needs an Exa key, defaults to standard depth, and never adds an automatic search on top', () => {
    const route = { strategy: 'research', connections: [{ id: 'or', target: { kind: 'openrouter', apiKey: 'sk-or-test-key' } }], models: [{ connectionId: 'or', model: 'm' }] };
    expect(() => validateRunRequest({ idempotencyKey: 'research-1', messages: user('Hi'), route })).toThrow(/Deep research needs an Exa API key/);
    const run = validateRunRequest({ idempotencyKey: 'research-2', messages: user('Hi'), route: { ...route, research: { depth: 'bogus' } }, search: { provider: 'exa', apiKey: 'exa-key-123456', auto: true } });
    expect(run.route).toMatchObject({ strategy: 'research', research: { depth: 'standard' } });
    expect(run.search).toEqual({ apiKey: 'exa-key-123456', auto: false });
  });
});

describe('Deep Research runs', () => {
  it('plans, searches, reads in parallel, keeps only quotes on the page, outlines, and writes a cited report', async () => {
    const world = fakeWorld();
    const { result, steps, final, text, events } = await runResearch(world.fn);

    // Three searches, asking Exa for page text.
    expect(world.searches.map(s => s.query)).toEqual(['eiffel height', 'eiffel history', 'eiffel visitors']);
    expect(world.searches[0].contents).toEqual({ text: { maxCharacters: 30_000 }, highlights: { query: 'eiffel height', numSentences: 3, highlightsPerUrl: 5 } });
    expect(world.searches[0].startPublishedDate).toBeUndefined();
    // Four relevant pages were read (the duplicate and unrelated result were skipped), by different models first.
    const readers = world.calls.filter(c => c.role === 'reader');
    expect(readers).toHaveLength(4);
    expect(new Set(readers.map(r => r.model)).size).toBeGreaterThan(1);
    expect(final('read-1')).toMatchObject({ status: 'done', task: 'Eiffel Tower facts', url: 'https://example.com/eiffel?utm_source=x', reason: 'Kept 1 note; dropped 1 the page does not say' });

    // Only checked notes reach the writer, grouped under renumbered sources.
    const writerNote = world.calls.find(c => c.role === 'writer')!.body.messages.find((m: any) => m.role === 'system').content as string;
    expect(writerNote).toContain('[1] Eiffel Tower facts (https://example.com/eiffel?utm_source=x, 2026-01-02)');
    expect(writerNote).toContain('330 m tall');
    expect(writerNote).not.toContain('solid gold');
    expect(writerNote).toContain('Outline:\n1. Height\n2. Visitors');
    // Sources come in turn from each search, so the third search's first page comes before the first search's second.
    // Every page gives a note: copied quotes, one quote matched back to the page, and one search extract.
    expect(result.agent?.sources?.map(s => [s.n, s.title, s.notes])).toEqual([
      [1, 'Eiffel Tower facts', 1], [2, 'Eiffel Tower summit tickets', 1], [3, 'Paris guide', 1], [4, 'Visitor numbers', 1],
    ]);
    expect(final('read-2')?.reason).toContain('from the search extract');
    expect(final('read-3')?.reason).toContain('1 quote matched to the page text');
    expect(final('read-4')?.reason).toContain('Kept 1 note');

    // The report streams as the answer; the citation check finds the citation that names no source.
    expect(text).toContain('It is 330 m tall [1].');
    expect(final('check')).toMatchObject({ role: 'checker', status: 'failed', reason: expect.stringContaining('[9] names no source') });
    expect(events).toContainEqual({ type: 'status', message: 'Some citations name no source: [9].' });

    // Steps in order, and every model request counted.
    const order = [...new Set(steps.map(s => s.id.replace(/-\d+$/, '')))];
    expect(order).toEqual(['strategy', 'planner', 'search', 'read', 'outline', 'writer', 'check']);
    expect(result.agent).toMatchObject({ mode: 'research', calls: 1 + 4 + 1 + 1 });
  });

  it('tells each reader which search found its page, and keeps one copy of a repeated fact', async () => {
    // Both pages say the same sentence; the tower page also says something of its own.
    const world = fakeWorld();
    const readerPrompts: string[] = [];
    const shared = 'The tower is 330 metres tall, including its antennas.';
    const fn = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body));
      if (String(url).includes('api.exa.ai')) {
        const pages = body.query === 'eiffel height'
          ? [{ title: 'Height', url: 'https://a.example/height', text: `${shared} It was completed in 1889.` }]
          : [{ title: 'Copy', url: 'https://b.example/copy', text: `${shared} Nothing else here.` }];
        return new Response(JSON.stringify({ results: pages }), { headers: { 'content-type': 'application/json' } });
      }
      const system = body.messages.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n');
      if (system.includes('You read one web page')) {
        readerPrompts.push(system);
        const notes = [{ fact: 'It is 330 m tall.', quote: shared }];
        if (String(body.messages.at(-1).content).includes('1889')) notes.push({ fact: 'Completed in 1889.', quote: 'It was completed in 1889.' });
        return sse(JSON.stringify({ notes }));
      }
      return world.fn(url, init);
    }) as typeof fetch;

    const { result, steps } = await runResearch(fn);
    // Each reader was told the search and the sub-question behind its page.
    expect(readerPrompts).toHaveLength(2);
    expect(readerPrompts[0]).toContain('This page was found by searching for "eiffel height", for the sub-question: How tall is it?');
    expect(readerPrompts[1]).toContain('This page was found by searching for "eiffel history"');
    const sources = result.agent?.sources ?? [];
    // The second page repeated the first page's sentence, so it gave nothing new and is not a source.
    expect(sources.map(s => [s.title, s.notes])).toEqual([['Height', 2]]);
    expect(steps.some(step => step.role === 'reader' && /Kept 1 note|Kept 2 notes/.test(step.reason))).toBe(true);
  });

  it('continues a report that stops at the output limit, and says so', async () => {
    let turn = 0;
    const world = fakeWorld({ writer: () => '' });
    const fn = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body));
      const system = String(body.messages?.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n') ?? '');
      if (!String(url).includes('api.exa.ai') && system.includes('You write a research report')) {
        turn++;
        const piece = turn === 1 ? 'Start of the report [1]. | Column |' : turn === 2 ? ' | --- | rest of the table [2]. ' : 'The end.';
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: turn < 3 ? 'length' : 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 4 } })}\n\ndata: [DONE]\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }
      return world.fn(url, init);
    }) as typeof fetch;

    const { result, final, text } = await runResearch(fn);
    expect(text).toBe('Start of the report [1]. | Column | | --- | rest of the table [2]. The end.');
    expect(result.finishReason).toBe('stop');
    expect(final('writer')?.reason).toContain('Continued 2 times after reaching the output limit');
    // The continuation asks for the rest, with what was written so far as context.
    const asked = world.calls.filter(c => c.role === 'writer');
    expect(asked).toHaveLength(0);
    expect(turn).toBe(3);
    expect(result.agent?.calls).toBe(1 + 4 + 1 + 3);
  });

  it('says why when no model can take the request at all', async () => {
    const world = fakeWorld();
    const tiny = models().map(m => ({ ...m, contextLength: 500 }));
    const executor = researchExecutor(
      { owner: 'u', candidates: tiny, request: { maxTokens: 512 }, messages: user('How tall is the Eiffel Tower?'), tools: [], documents: [], search: { apiKey: 'exa-key-123456' }, research: { depth: 'standard' } },
      { health: new RouterHealth(), fetchImpl: world.fn, enqueue: task => task() },
    );
    await expect(executor({ signal: new AbortController().signal, emit: () => undefined }))
      .rejects.toThrow(/No free model can take this request\. Left out: 3 context too small\./);
  });

  it('writes with small models by asking them for less, not by refusing the request', async () => {
    const world = fakeWorld();
    const events: ProgressPayload[] = [];
    // Every free model holds 8,192 tokens, less than the report's 8,000-token request plus the notes.
    const small = models().map(m => ({ ...m, contextLength: 8192 }));
    const executor = researchExecutor(
      { owner: 'u', candidates: small, request: { maxTokens: 512 }, messages: user('How tall is the Eiffel Tower?'), tools: [], documents: [], search: { apiKey: 'exa-key-123456' }, research: { depth: 'standard' } },
      { health: new RouterHealth(), fetchImpl: world.fn, enqueue: task => task() },
    );
    const result = await executor({ signal: new AbortController().signal, emit: e => events.push(e) });
    expect(result.agent?.mode).toBe('research');
    const writer = world.calls.find(c => c.role === 'writer')!;
    expect(writer.body.max_tokens).toBeLessThan(8000);
    expect(writer.body.max_tokens).toBeGreaterThan(256);
    expect(events.some(e => e.type === 'delta')).toBe(true);
  });

  it('writes from what the models know, and says so, when the search finds nothing', async () => {
    const world = fakeWorld({ noPages: true, writer: note => note.includes('no usable sources') ? 'No sources were found. It is about 330 m.' : 'wrong prompt' });
    const { result, final, events, text } = await runResearch(world.fn, user('How tall is the Eiffel Tower?'), 'quick');
    expect(text).toBe('No sources were found. It is about 330 m.');
    expect(events).toContainEqual({ type: 'status', message: 'No usable sources were found, so this answer comes from what the models know.' });
    expect(result.agent?.sources).toEqual([]);
    expect(final('check')).toBeUndefined();
    expect(world.calls.map(c => c.role)).toEqual(['planner', 'writer']);
  });
});

describe('a research run that has already done the work', () => {
  // A standard run spends minutes searching, reading, and checking quotes. Losing all of it because
  // the account is sixty seconds into OpenRouter's free per-minute limit is the worst outcome
  // available, so the report waits for the pool once instead of failing with the notes in hand.
  const freeLimit = () => new Response(
    JSON.stringify({ error: { message: 'Rate limit exceeded: free-models-per-day', code: 429 } }),
    { status: 429, headers: { 'content-type': 'application/json' } },
  );

  it('waits out a short rate limit rather than throwing away its checked notes', async () => {
    const world = fakeWorld();
    let writerCalls = 0;
    const fetchImpl = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body ?? '{}'));
      const system = (body.messages ?? []).filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n');
      const isWriter = !String(url).includes('api.exa.ai') && /research report that answers/.test(system);
      if (isWriter && ++writerCalls === 1) return freeLimit();
      return world.fn(url, init);
    }) as typeof fetch;

    // A clock the fake wait moves forward, so the cooldown really expires without a real minute.
    let now = Date.now();
    const slept: number[] = [];
    const events: ProgressPayload[] = [];
    const executor = researchExecutor(
      { owner: 'u', candidates: models(), request: { maxTokens: 512 }, messages: user('How tall is the Eiffel Tower and how many people visit it?'), tools: [], documents: [], search: { apiKey: 'exa-key-123456' }, research: { depth: 'standard' } },
      { health: new RouterHealth(() => now), fetchImpl, enqueue: t => t(), sleep: async ms => { slept.push(ms); now += ms; } },
    );
    const result = await executor({ signal: new AbortController().signal, emit: e => events.push(e) });

    const text = events.flatMap(e => e.type === 'delta' ? [e.text] : []).join('');
    expect(text).toMatch(/330 m tall \[1\]/);
    expect(result.agent?.mode).toBe('research');
    // It waited once, for about the cooldown, and said so.
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThan(50_000);
    expect(events.some(e => e.type === 'status' && /Waiting \d+s for a free model/.test(e.message))).toBe(true);
    const steps = events.filter((e): e is Extract<ProgressPayload, { type: 'agent' }> => e.type === 'agent');
    expect(steps.some(s => s.id === 'writer' && /Waiting rather than losing the \d+ checked notes/.test(s.reason ?? ''))).toBe(true);
  });

  it('does not wait when there are no notes to save', async () => {
    const world = fakeWorld({ noPages: true });
    const fetchImpl = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body ?? '{}'));
      const system = (body.messages ?? []).filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n');
      // Everything that is not a search, a plan, a read, or an outline is the report.
      const other = /You plan web research|You read one web page|You outline a research report/.test(system);
      if (!String(url).includes('api.exa.ai') && !other) return freeLimit();
      return world.fn(url, init);
    }) as typeof fetch;
    let now = Date.now();
    const slept: number[] = [];
    const executor = researchExecutor(
      { owner: 'u', candidates: models(), request: { maxTokens: 512 }, messages: user('How tall is the Eiffel Tower?'), tools: [], documents: [], search: { apiKey: 'exa-key-123456' }, research: { depth: 'standard' } },
      { health: new RouterHealth(() => now), fetchImpl, enqueue: t => t(), sleep: async ms => { slept.push(ms); now += ms; } },
    );
    await expect(executor({ signal: new AbortController().signal, emit: () => {} })).rejects.toThrow();
    expect(slept).toEqual([]);
  });
});

describe('a reply the model was cut off in the middle of', () => {
  // What nvidia/nemotron-3-ultra-550b-a55b actually returned as a planner, with 718 of its 800
  // tokens spent on a chain of thought: three sub-questions written, the third cut mid-query.
  const truncatedPlan = `{
  "perspectives": ["Automotive OEMs", "Battery researchers"],
  "questions": [
    {
      "question": "What is the current technology readiness level of solid-state batteries?",
      "queries": ["solid-state battery technology readiness level EV"]
    },
    {
      "question": "Which automakers have announced production timelines?",
      "queries": ["automaker solid-state battery production timeline announcement"]
    },
    {
      "question": "What are the key technical challenges?",
      "queries": ["solid-state battery commercialization challenges`;

  it('keeps the entries the model finished, and drops the one it did not', () => {
    const parsed = jsonIn(truncatedPlan);
    expect(parsed.questions).toHaveLength(2);
    expect(parsed.perspectives).toEqual(['Automotive OEMs', 'Battery researchers']);
    expect(parsed.questions[1].queries).toEqual(['automaker solid-state battery production timeline announcement']);
  });

  it('plans from what survived rather than falling back to the question itself', () => {
    const plan = parseResearchPlan(truncatedPlan, 'Where are solid-state batteries up to?', 6);
    expect(plan.questions.map(q => q.queries[0])).toEqual([
      'solid-state battery technology readiness level EV',
      'automaker solid-state battery production timeline announcement',
    ]);
  });

  it('adds structure back but never content', () => {
    expect(jsonIn('{"notes":[{"fact":"a","quote":"b"},{"fact":"c"')).toEqual({ notes: [{ fact: 'a', quote: 'b' }] });
    expect(jsonIn('not json at all')).toBeUndefined();
    expect(jsonIn('{"a":1}')).toEqual({ a: 1 });
    // A brace inside a string is not a bracket, and must not be counted as one.
    expect(jsonIn('{"notes":[{"fact":"the } character","quote":"x"}]}')).toEqual({ notes: [{ fact: 'the } character', quote: 'x' }] });
  });
});

describe('whether a step can use what a model replied', () => {
  it('accepts a reader that read the page and found nothing, and refuses one that was cut off', () => {
    expect(hasNotes('{"notes":[]}')).toBe(true);
    expect(hasNotes('Berlin is the capital -- "Berlin is the capital of Germany."')).toBe(true);
    expect(hasNotes('{"notes":[{"fact":"a","quote":')).toBe(false);
    expect(hasNotes('')).toBe(false);
  });

  it('refuses a plan the planner never actually wrote', () => {
    expect(hasPlan('{"questions":[{"question":"q","queries":["a real search phrase"]}]}')).toBe(true);
    expect(hasPlan('{"questions":[]}')).toBe(false);
    expect(hasPlan('Sure, I can help you plan that research!')).toBe(false);
    // A question with no query of its own leaves nothing to search for.
    expect(hasPlan('{"questions":[{"question":"q","queries":[]}]}')).toBe(false);
  });
});


describe('a model that breaks off mid-reply', () => {
  it('hands the page to the next model, and keeps its notes', async () => {
    const world = fakeWorld();
    const cutOff: string[] = [];
    // The first model to see each page runs out of output halfway through its JSON.
    const seen = new Set<string>();
    const fn = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body));
      if (String(url).includes('api.exa.ai')) return world.fn(url, init);
      const system = body.messages.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n');
      if (system.includes('You read one web page')) {
        const page = String(body.messages.at(-1).content);
        if (!seen.has(page)) {
          seen.add(page);
          cutOff.push(body.model);
          return truncated('{"notes":[{"fact":"It is 330 m tall.","quote":"The Eiffel Tow');
        }
      }
      return world.fn(url, init);
    }) as typeof fetch;

    const { result, steps } = await runResearch(fn);
    // Every page was read twice: once by the model that broke off (counted in cutOff, which answers
    // before the fake world sees it), once by the model that replaced it.
    const readers = world.calls.filter(c => c.role === 'reader');
    expect(cutOff).toHaveLength(4);
    expect(readers).toHaveLength(4);
    for (const [i, replacement] of readers.entries()) expect(replacement.model).not.toBe(cutOff[i]);
    expect(steps.filter(s => s.role === 'reader' && s.status === 'failed').map(s => s.reason))
      .toContain('The model did not return anything it had read, having reached its output limit. Trying another model.');
    // And the notes still arrive, from the second model rather than the search extract.
    expect(result.agent?.sources?.length).toBeGreaterThan(0);
    expect(steps.find(s => s.id === 'read-1' && s.status === 'done')?.reason).toContain('Kept 1 note');
  });

  it('leaves a model that read the page and found nothing alone', async () => {
    const world = fakeWorld();
    await runResearch(world.fn);
    // The fixture's third page gets a prose "nothing relevant here", which finishes normally: it is
    // an answer, so the page is not handed to another model and the extract stands in.
    expect(world.calls.filter(c => c.role === 'reader')).toHaveLength(4);
  });
});
