// Deterministic OpenAI-compatible provider for browser tests of the run engine.
// Each model name selects a behavior. GET /_log reports what each prompt did upstream.
import http from 'node:http';

const port = Number(process.env.FAKE_PROVIDER_PORT) || 5299;
const log = [];
const exaLog = [];
const MODELS = [
  'fast-model',
  'slow-model',
  'restart-model',
  'limit-model',
  'busy-model',
  'broken-model',
  'reasoning-model',
  'tool-model',
];
// Under /router/v1 the catalog lists two sizes, so the Free Router tries the larger one first.
// A "-70b"-style suffix selects the same behavior as the plain name.
const ROUTER_MODELS = ['limit-model-70b', 'fast-model-8b'];
// Under /agent/v1, three sizes of one model for the Free Agent: it answers as a drafter, a planner,
// a part specialist, or the final writer, depending on the system note it receives.
const AGENT_MODELS = ['agent-model-70b', 'agent-model-30b', 'agent-model-8b'];
// Groq-style rate-limit headers on every successful response.
const QUOTA = {
  'x-ratelimit-limit-requests': '1000',
  'x-ratelimit-remaining-requests': '998',
  'x-ratelimit-reset-requests': '1m30s',
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Pages the fake Exa returns with text, for Deep Research.
const RESEARCH_PAGES = {
  'fake tower height': { title: 'Tower height', url: 'https://example.com/tower-height', text: 'The tower is 300 metres tall. It sways a little in the wind.', highlights: ['The tower is 300 metres tall.'] },
  // No page text: only the search engine's extract, which still becomes a note.
  'fake tower builder': { title: 'Tower builder', url: 'https://example.com/tower-builder', text: '', highlights: ['The tower was built by a company between 1887 and 1889.'] },
};
const frame = (data) => `data: ${JSON.stringify(data)}\n\n`;
const delta = (content) => frame({ choices: [{ delta: { content } }] });

async function readJSON(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || '{}');
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const catalog = /^\/(router|agent)\//.exec(url.pathname)?.[1];
    const path = catalog ? url.pathname.slice(catalog.length + 1) : url.pathname;
    if (url.pathname === '/_log') {
      const prompt = url.searchParams.get('prompt');
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(
          JSON.stringify(prompt ? log.filter((e) => e.prompt === prompt) : log),
        );
      return;
    }
    // Stand-in for Exa's search API (the test backend sets EXA_API_URL to /exa).
    if (url.pathname === '/_exa_log') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(exaLog));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/exa/search') {
      const search = await readJSON(req);
      exaLog.push({ key: req.headers['x-api-key'], body: search });
      if (req.headers['x-api-key'] !== 'exa-test-key-000001') {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Invalid API key', tag: 'INVALID_API_KEY' }));
        return;
      }
      // Deep Research asks for page text: one page per query.
      if (search.contents?.text) {
        const page = RESEARCH_PAGES[search.query];
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ requestId: 'fake', results: page ? [{ ...page, publishedDate: '2026-03-01T00:00:00.000Z' }] : [] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        requestId: 'fake', costDollars: { total: 0.007 },
        results: [
          { title: 'Nerdplexity 2.0 released', url: 'https://example.com/nerdplexity-2', publishedDate: '2026-09-10T00:00:00.000Z', highlights: ['Version 2.0 adds tools.'] },
          { title: 'Unsafe', url: 'javascript:alert(1)', highlights: ['dropped'] },
        ],
      }));
      return;
    }
    if (req.method === 'GET' && path === '/v1/models') {
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ data: (catalog === 'router' ? ROUTER_MODELS : catalog === 'agent' ? AGENT_MODELS : MODELS).map((id) => ({ id })) }));
      return;
    }
    if (req.method !== 'POST' || path !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }

    const body = await readJSON(req);
    const model = String(body.model).replace(/-\d+b$/, '');
    const userContent = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const prompt = Array.isArray(userContent)
      ? userContent.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
      : userContent;
    const entry = {
      prompt,
      model: body.model,
      messages: body.messages,
      temperature: body.temperature,
      maxTokens: body.max_tokens ?? body.max_completion_tokens,
      tools: (body.tools ?? []).map((t) => t.function?.name),
      aborted: false,
      completed: false,
      tokens: 0,
      startedAt: Date.now(),
      endedAt: 0,
    };
    log.push(entry);
    res.on('close', () => {
      entry.endedAt = Date.now();
      if (!entry.completed) entry.aborted = true;
    });

    if (model === 'agent-model') {
      const system = body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      const page = String(body.messages.at(-1)?.content ?? '');
      const text = system.includes('You plan web research')
        ? JSON.stringify({ perspectives: ['An engineer', 'A historian'], questions: [{ question: 'How tall is the tower?', queries: ['fake tower height'] }, { question: 'Who built it?', queries: ['fake tower builder'] }] })
        : system.includes('You read one web page')
          // Lines rather than JSON: one fact quoting the page, and one invention that is dropped.
          ? [
            `- Fact from ${body.model} -- "${page.split('\n\n').at(-1).split('. ')[0]}"`,
            '- Invented -- "This sentence is nowhere on the page at all, in any form."',
          ].join('\n')
          : system.includes('You outline a research report')
            ? JSON.stringify({ sections: [{ heading: 'Height', notes: [1] }, { heading: 'Builder', notes: [2] }] })
            : system.includes('You write a research report')
              ? `Research report from ${body.model}: the tower is 300 metres tall [1], and it was built by a company [2].`
              : system.includes("Split the user's message")
        ? JSON.stringify({ parts: [{ task: 'Explain what an API is', kind: 'general' }, { task: 'Write a haiku about APIs', kind: 'writing' }] })
        : system.includes('final writer') ? `Checked final answer from ${body.model}.`
          : system.includes('Answer only this part') ? `Part answer from ${body.model}.`
            : `Draft from ${body.model}.`;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // "slowly" in the message: drafts think, write half, pause, then finish, so a test can watch
      // them live. Short, because models on this machine share one queue with every other test.
      const last = [...body.messages].reverse().find((m) => m.role === 'user');
      if (JSON.stringify(last?.content ?? '').includes('slowly') && text.startsWith('Draft')) {
        res.write(frame({ choices: [{ delta: { reasoning: `Considering it as ${body.model}.` } }] }));
        await sleep(500);
        res.write(delta(`${text} Working through each step`));
        await sleep(1500);
        res.write(delta(' with care before the check.'));
      } else {
        res.write(delta(text));
      }
      res.write(frame({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3 } }));
      entry.completed = true;
      res.end('data: [DONE]\n\n');
      return;
    }
    if (model === 'limit-model') {
      res
        .writeHead(429, {
          'content-type': 'application/json',
          'retry-after': '30',
        })
        .end(
          JSON.stringify({
            error: { message: 'Rate limit reached for limit-model.' },
          }),
        );
      entry.completed = true;
      return;
    }
    // busy-model: the first request for a prompt is rate limited briefly, then succeeds.
    if (
      model === 'busy-model' &&
      log.filter((e) => e.prompt === prompt).length === 1
    ) {
      res
        .writeHead(429, {
          'content-type': 'application/json',
          'retry-after': '1',
        })
        .end(
          JSON.stringify({ error: { message: 'Busy, try again shortly.' } }),
        );
      entry.completed = true;
      return;
    }
    // tool-model: calls tools by prompt. "[[expr]]" uses the calculator, "malformed" sends
    // broken arguments, "notes" searches then reads a document. Answers from the results.
    if (model === 'tool-model') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const lastUser = body.messages.map((m) => m.role).lastIndexOf('user');
      const results = body.messages
        .slice(lastUser + 1)
        .filter((m) => m.role === 'tool')
        .map((m) => JSON.parse(m.content));
      const call = (name, args) => {
        res.write(frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${results.length + 1}`, type: 'function', function: { name, arguments: args } }] } }] }));
        res.write(frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }));
      };
      const say = (text) => {
        res.write(delta(text));
        res.write(frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
      };
      const expression = /\[\[(.+?)\]\]/.exec(prompt)?.[1];
      const last = results.at(-1);
      if (!body.tools?.length) say('No tools were enabled.');
      else if (expression && !results.length) {
        res.write(delta('I will calculate this exactly.'));
        call('calculator', JSON.stringify({ expression }));
      }
      else if (/malformed/.test(prompt) && !results.length) call('calculator', '{"expression":');
      else if (/search the web/.test(prompt) && !results.length) call('web_search', JSON.stringify({ query: 'nerdplexity release' }));
      else if (/search the web/.test(prompt)) say(last.error ? `Search failed: ${last.error}` : `Found ${last.results.length} page: ${last.results[0].title} (${last.results[0].url}).`);
      else if (/notes/.test(prompt) && results.length === 0) call('search_documents', JSON.stringify({ query: 'owner' }));
      else if (/notes/.test(prompt) && results.length === 1) call('read_document', JSON.stringify({ id: results[0][0]?.id ?? 'missing' }));
      else if (/notes/.test(prompt)) say(`According to ${last.title}: ${last.content}`);
      else if (last?.error) say(`The tool reported an error: ${last.error}`);
      else say(`The result is ${last?.result}.`);
      res.write(frame({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 1 } }));
      entry.completed = true;
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', ...QUOTA });
    const send = async (text, ms = 0) => {
      if (res.destroyed) return false;
      res.write(text);
      entry.tokens++;
      if (ms) await sleep(ms);
      return !res.destroyed;
    };

    if (model === 'slow-model') {
      for (let i = 0; i < 30; i++)
        if (!(await send(delta(`token-${i} `), 100))) return;
    } else if (model === 'restart-model') {
      // Reach persisted partial output quickly, then leave a deterministic reload window.
      for (let i = 0; i < 30; i++)
        if (!(await send(delta(`token-${i} `), i < 3 ? 50 : 500))) return;
    } else if (model === 'broken-model') {
      await send(delta('partial-a '), 50);
      await send(delta('partial-b'), 50);
      res.destroy();
      return;
    } else if (model === 'reasoning-model') {
      await send(
        frame({
          choices: [
            { delta: { reasoning_content: '## Analysis\n\n' } },
          ],
        }),
        250,
      );
      await send(frame({ choices: [{ delta: { reasoning_content: '1. Considering the question.\n' } }] }), 250);
      await send(frame({ choices: [{ delta: { reasoning_content: '2. Checking the conclusion.' } }] }), 250);
      await send(delta('Reasoned answer.'));
    } else if (model === 'busy-model') {
      await send(delta('Answered after waiting.'));
    } else {
      // Split the answer mid-character to exercise chunk reassembly end to end.
      const bytes = Buffer.from(
        delta('Hello from fast-model: café, naïve, \u{1F642}.'),
      );
      for (let i = 0; i < bytes.length; i += 3) {
        if (res.destroyed) return;
        res.write(bytes.subarray(i, i + 3));
      }
    }
    res.write(frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
    res.write(
      frame({
        choices: [],
        usage: { prompt_tokens: 5, completion_tokens: entry.tokens },
      }),
    );
    entry.completed = true;
    res.end('data: [DONE]\n\n');
  })
  .listen(port, '127.0.0.1', () => console.log(`fake provider on ${port}`));
