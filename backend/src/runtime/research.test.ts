import { describe, expect, it } from 'vitest';
import type { AgentStep, RunMessage } from '@app/types';
import { resolveTarget } from './destinations.js';
import type { ProgressPayload } from './runs.js';
import { RouterHealth, type RouteCandidate } from './router.js';
import { checkCitations, extractNotes, fallbackQueries, parseResearchPlan, pickSources, quoteInPage, readNotes, recencySince, researchExecutor, searchPhrase } from './research.js';
import { validateRunRequest } from '../routes/runs.js';

const target = resolveTarget({ kind: 'openrouter', apiKey: 'sk-or-test-key' });
const candidate = (model: string): RouteCandidate => ({ connectionId: 'or', model, target, capabilities: { tools: true, vision: false }, contextLength: 131_072 });
const models = () => [candidate('meta-llama/llama-3.3-70b-instruct:free'), candidate('qwen/qwen3-32b:free'), candidate('google/gemma-3-27b-it:free')];
const user = (content: string): RunMessage[] => [{ role: 'user', content }];

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
    { title: 'Extract only', url: 'https://extract.example.com/', highlights: ['Tickets to the summit cost 29.40 euros for adults in 2026.'] },
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

  it('takes sources in turn from each search, once each', () => {
    const page = (url: string) => ({ title: url, url, text: 'x', highlights: [] });
    const picked = pickSources([[page('https://a.com/1?utm_source=z'), page('https://a.com/2')], [page('https://www.a.com/1/#top'), page('https://b.com/1')]], 10);
    expect(picked.map(p => p.url)).toEqual(['https://a.com/1?utm_source=z', 'https://a.com/2', 'https://b.com/1']);
    expect(pickSources([[page('https://a.com/1'), page('https://a.com/2')], [page('https://b.com/1')]], 2).map(p => p.url)).toEqual(['https://a.com/1', 'https://b.com/1']);
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
    expect(world.searches[0].contents).toEqual({ text: { maxCharacters: 12_000 }, highlights: { query: 'eiffel height', numSentences: 3, highlightsPerUrl: 5 } });
    expect(world.searches[0].startPublishedDate).toBeUndefined();
    // Four distinct pages with text were read (the duplicate and the textless page were not), by different models first.
    const readers = world.calls.filter(c => c.role === 'reader');
    expect(readers).toHaveLength(5);
    expect(new Set(readers.map(r => r.model)).size).toBeGreaterThan(1);
    expect(final('read-1')).toMatchObject({ status: 'done', task: 'Eiffel Tower facts', url: 'https://example.com/eiffel?utm_source=x', reason: 'Kept 1 note; dropped 1 the page does not say' });

    // Only checked notes reach the writer, grouped under renumbered sources.
    const writerNote = world.calls.find(c => c.role === 'writer')!.body.messages.find((m: any) => m.role === 'system').content as string;
    expect(writerNote).toContain('[1] Eiffel Tower facts (https://example.com/eiffel?utm_source=x, 2026-01-02)');
    expect(writerNote).toContain('330 m tall');
    expect(writerNote).not.toContain('solid gold');
    expect(writerNote).toContain('Outline:\n1. Height\n2. Visitors');
    // Sources come in turn from each search, so the third search's first page comes before the first search's second.
    // Every page gives a note: one quote copied as it is, one matched back to the page, one from the extract.
    expect(result.agent?.sources?.map(s => [s.n, s.title, s.notes])).toEqual([
      [1, 'Eiffel Tower facts', 1], [2, 'Extract only', 1], [3, 'Paris guide', 1], [4, 'An unrelated blog', 1], [5, 'Visitor numbers', 1],
    ]);
    expect(final('read-2')?.reason).toContain('from the search extract');
    expect(final('read-3')?.reason).toContain('1 quote matched to the page text');
    expect(final('read-4')?.reason).toContain('from the search extract');

    // The report streams as the answer; the citation check finds the citation that names no source.
    expect(text).toContain('It is 330 m tall [1].');
    expect(final('check')).toMatchObject({ role: 'checker', status: 'failed', reason: expect.stringContaining('[9] names no source') });
    expect(events).toContainEqual({ type: 'status', message: 'Some citations name no source: [9].' });

    // Steps in order, and every model request counted.
    const order = [...new Set(steps.map(s => s.id.replace(/-\d+$/, '')))];
    expect(order).toEqual(['strategy', 'planner', 'search', 'read', 'outline', 'writer', 'check']);
    expect(result.agent).toMatchObject({ mode: 'research', calls: 1 + 5 + 1 + 1 });
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
    expect(result.agent?.calls).toBe(1 + 5 + 1 + 3);
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
