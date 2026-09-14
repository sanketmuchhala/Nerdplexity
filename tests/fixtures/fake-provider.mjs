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
// Groq-style rate-limit headers on every successful response.
const QUOTA = {
  'x-ratelimit-limit-requests': '1000',
  'x-ratelimit-remaining-requests': '998',
  'x-ratelimit-reset-requests': '1m30s',
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
    const routerCatalog = url.pathname.startsWith('/router/');
    const path = routerCatalog ? url.pathname.slice('/router'.length) : url.pathname;
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
        .end(JSON.stringify({ data: (routerCatalog ? ROUTER_MODELS : MODELS).map((id) => ({ id })) }));
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
      else if (expression && !results.length) call('calculator', JSON.stringify({ expression }));
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
