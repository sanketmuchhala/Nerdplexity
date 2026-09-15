import { describe, expect, it } from 'vitest';
import type { AgentStep, RunMessage } from '@app/types';
import { resolveTarget } from './destinations.js';
import type { ProgressPayload } from './runs.js';
import { RouterHealth, type RouteCandidate } from './router.js';
import { checkCitations, parseResearchPlan, pickSources, quoteInPage, researchExecutor } from './research.js';
import { validateRunRequest } from '../routes/runs.js';

const target = resolveTarget({ kind: 'openrouter', apiKey: 'sk-or-test-key' });
const candidate = (model: string): RouteCandidate => ({ connectionId: 'or', model, target, capabilities: { tools: true, vision: false }, contextLength: 131_072 });
const models = () => [candidate('meta-llama/llama-3.3-70b-instruct:free'), candidate('qwen/qwen3-32b:free'), candidate('google/gemma-3-27b-it:free')];
const user = (content: string): RunMessage[] => [{ role: 'user', content }];

const sse = (text: string) => new Response(
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`,
  { headers: { 'content-type': 'text/event-stream' } },
);

const PAGES: Record<string, { title: string; url: string; text?: string }[]> = {
  'eiffel height': [
    { title: 'Eiffel Tower facts', url: 'https://example.com/eiffel?utm_source=x', text: 'The Eiffel Tower is 330 metres tall, including its antennas. It was completed in 1889.' },
    { title: 'Paris guide', url: 'https://travel.example.org/paris', text: 'Paris has many landmarks. The tower draws about seven million visitors a year.' },
  ],
  'eiffel history': [
    { title: 'Eiffel Tower facts (again)', url: 'https://www.example.com/eiffel/', text: 'Duplicate page.' },
    { title: 'An unrelated blog', url: 'https://blog.example.net/post', text: 'Nothing about towers here at all.' },
  ],
  'eiffel visitors': [
    { title: 'No text page', url: 'https://empty.example.com/' },
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
      return new Response(JSON.stringify({ results: pages.map(p => ({ title: p.title, url: p.url, publishedDate: '2026-01-02', ...(p.text ? { text: p.text } : {}) })) }), { headers: { 'content-type': 'application/json' } });
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
      if (page.includes('seven million')) return sse(JSON.stringify({ notes: [{ fact: 'About 7 million visit each year.', quote: '“The tower draws about seven million visitors a year.”', question: 2 }] }));
      if (page.includes('6.3 million')) return sse(JSON.stringify({ notes: [{ fact: '6.3 million visited in 2023.', quote: 'In 2023 the monument welcomed ... 6.3 million visitors', question: 2 }] }));
      return sse('{"notes":[]}');
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
      { question: 'One?', queries: ['q1a', 'q1b'] }, { question: 'Two?', queries: ['q2a', 'Q1A'] }, { question: 'Three?', queries: ['q3a'] },
    ] });
    expect(parseResearchPlan(reply, 'x', 3).questions.map(q => q.queries)).toEqual([['q1a'], ['q2a'], ['q3a']]);
    expect(parseResearchPlan(reply, 'x', 4).questions.map(q => q.queries)).toEqual([['q1a', 'q1b'], ['q2a'], ['q3a']]);
    expect(parseResearchPlan('no json here', 'What is up?', 5)).toEqual({ perspectives: [], questions: [{ question: 'What is up?', queries: ['What is up?'] }] });
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
    const page = (url: string) => ({ title: url, url, text: 'x' });
    const picked = pickSources([[page('https://a.com/1?utm_source=z'), page('https://a.com/2')], [page('https://www.a.com/1/#top'), page('https://b.com/1')]], 10);
    expect(picked.map(p => p.url)).toEqual(['https://a.com/1?utm_source=z', 'https://a.com/2', 'https://b.com/1']);
    expect(pickSources([[page('https://a.com/1'), page('https://a.com/2')], [page('https://b.com/1')]], 2).map(p => p.url)).toEqual(['https://a.com/1', 'https://b.com/1']);
  });

  it('reads citations like [2], [2][5], [2, 5], and [2-4], and ignores Markdown links', () => {
    expect(checkCitations('A [1]. B [2][3]. C [2, 4]. D [3-5]. E [9]. [link](https://x.y) F [6](https://z)', 5))
      .toEqual({ count: 6, cited: [1, 2, 3, 4, 5], invalid: [9], uncited: [] });
    expect(checkCitations('No citations.', 2)).toEqual({ count: 0, cited: [], invalid: [], uncited: [1, 2] });
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
    expect(world.searches[0].contents).toEqual({ text: { maxCharacters: 12_000 } });
    // Four distinct pages with text were read (the duplicate and the textless page were not), by different models first.
    const readers = world.calls.filter(c => c.role === 'reader');
    expect(readers).toHaveLength(4);
    expect(new Set(readers.map(r => r.model)).size).toBeGreaterThan(1);
    expect(final('read-1')).toMatchObject({ status: 'done', task: 'Eiffel Tower facts', url: 'https://example.com/eiffel?utm_source=x', reason: 'Kept 1 note; dropped 1 whose quote is not on the page' });

    // Only checked notes reach the writer, grouped under renumbered sources.
    const writerNote = world.calls.find(c => c.role === 'writer')!.body.messages.find((m: any) => m.role === 'system').content as string;
    expect(writerNote).toContain('[1] Eiffel Tower facts (https://example.com/eiffel?utm_source=x, 2026-01-02)');
    expect(writerNote).toContain('330 m tall');
    expect(writerNote).not.toContain('solid gold');
    expect(writerNote).toContain('Outline:\n1. Height\n2. Visitors');
    // Sources come in turn from each search, so the third search's first page comes before the first search's second.
    expect(result.agent?.sources?.map(s => [s.n, s.title, s.notes])).toEqual([[1, 'Eiffel Tower facts', 1], [2, 'Visitor numbers', 1], [3, 'Paris guide', 1]]);

    // The report streams as the answer; the citation check finds the citation that names no source.
    expect(text).toContain('It is 330 m tall [1].');
    expect(final('check')).toMatchObject({ role: 'checker', status: 'failed', reason: expect.stringContaining('[9] names no source') });
    expect(events).toContainEqual({ type: 'status', message: 'Some citations name no source: [9].' });

    // Steps in order, and every model request counted.
    const order = [...new Set(steps.map(s => s.id.replace(/-\d+$/, '')))];
    expect(order).toEqual(['strategy', 'planner', 'search', 'read', 'outline', 'writer', 'check']);
    expect(result.agent).toMatchObject({ mode: 'research', calls: 1 + 4 + 1 + 1 });
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
