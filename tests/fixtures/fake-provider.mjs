// Deterministic OpenAI-compatible provider for browser tests of the run engine.
// Each model name selects a behavior. GET /_log reports what each prompt did upstream.
import http from 'node:http';

const port = Number(process.env.FAKE_PROVIDER_PORT) || 5299;
const log = [];
const MODELS = [
  'fast-model',
  'slow-model',
  'restart-model',
  'limit-model',
  'busy-model',
  'broken-model',
  'reasoning-model',
];
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
    if (url.pathname === '/_log') {
      const prompt = url.searchParams.get('prompt');
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(
          JSON.stringify(prompt ? log.filter((e) => e.prompt === prompt) : log),
        );
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ data: MODELS.map((id) => ({ id })) }));
      return;
    }
    if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }

    const body = await readJSON(req);
    const prompt =
      [...body.messages].reverse().find((m) => m.role === 'user')?.content ??
      '';
    const entry = {
      prompt,
      model: body.model,
      messages: body.messages,
      temperature: body.temperature,
      maxTokens: body.max_tokens ?? body.max_completion_tokens,
      aborted: false,
      completed: false,
      tokens: 0,
    };
    log.push(entry);
    res.on('close', () => {
      if (!entry.completed) entry.aborted = true;
    });

    if (body.model === 'limit-model') {
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
      body.model === 'busy-model' &&
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
    res.writeHead(200, { 'content-type': 'text/event-stream', ...QUOTA });
    const send = async (text, ms = 0) => {
      if (res.destroyed) return false;
      res.write(text);
      entry.tokens++;
      if (ms) await sleep(ms);
      return !res.destroyed;
    };

    if (body.model === 'slow-model') {
      for (let i = 0; i < 30; i++)
        if (!(await send(delta(`token-${i} `), 100))) return;
    } else if (body.model === 'restart-model') {
      // Reach persisted partial output quickly, then leave a deterministic reload window.
      for (let i = 0; i < 30; i++)
        if (!(await send(delta(`token-${i} `), i < 3 ? 50 : 500))) return;
    } else if (body.model === 'broken-model') {
      await send(delta('partial-a '), 50);
      await send(delta('partial-b'), 50);
      res.destroy();
      return;
    } else if (body.model === 'reasoning-model') {
      await send(
        frame({
          choices: [
            { delta: { reasoning_content: 'Considering the question. ' } },
          ],
        }),
        20,
      );
      await send(delta('Reasoned answer.'));
    } else if (body.model === 'busy-model') {
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
