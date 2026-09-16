#!/usr/bin/env node
/**
 * Run Deep Research from the command line against a running Nerdplexity server, and print what every
 * model did. The app keeps keys in the browser, which is right for the app and useless for
 * debugging: this reads them from a .env instead, so a run can be reproduced, watched, and compared
 * without a browser.
 *
 *   node backend/scripts/research-run.mjs --question "..." --depth standard
 *
 * Keys come from the first .env found, or --env <path>: OPENROUTER_API_KEY and EXA_API_KEY are
 * required; GROQ_API_KEY, CEREBRAS_API_KEY, GEMINI_API_KEY and MISTRAL_API_KEY are used when set,
 * which is the point of the exercise: a second provider is what stops one account's limit ending a
 * run. Keys are never printed, and anything key-shaped is redacted from provider messages.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

// ---------------------------------------------------------------------------
// Arguments and environment

function args(argv) {
  const out = { depth: 'standard', server: 'http://127.0.0.1:5175', question: '', env: '', json: '', quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--question' || arg === '-q') out.question = next();
    else if (arg === '--depth' || arg === '-d') out.depth = next();
    else if (arg === '--server' || arg === '-s') out.server = next();
    else if (arg === '--env') out.env = next();
    else if (arg === '--json') out.json = next();
    else if (arg === '--quiet') out.quiet = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (!out.question) out.question = arg;
  }
  return out;
}

const ENV_CANDIDATES = [
  resolve(REPO, '.env'),
  resolve(REPO, 'backend/.env'),
  resolve(REPO, '../free-router/.env'),
  resolve(REPO, '../Nerdplexity/.env'),
];

/** Parse a .env without adding a dependency. Values may be quoted; `export` and comments are ignored. */
function loadEnv(explicit) {
  const paths = explicit ? [resolve(explicit)] : ENV_CANDIDATES;
  const found = {};
  const files = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    files.push(path);
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const value = match[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
      // An earlier file wins, so --env and the repo's own .env beat a neighbour's.
      if (value && found[match[1]] === undefined) found[match[1]] = value;
    }
  }
  return { env: { ...found, ...Object.fromEntries(Object.entries(process.env).filter(([k, v]) => /_API_KEY$/.test(k) && v)) }, files };
}

// ---------------------------------------------------------------------------
// Output

const C = process.stdout.isTTY
  ? { dim: s => `[2m${s}[0m`, red: s => `[31m${s}[0m`, green: s => `[32m${s}[0m`, yellow: s => `[33m${s}[0m`, bold: s => `[1m${s}[0m` }
  : { dim: s => s, red: s => s, green: s => s, yellow: s => s, bold: s => s };

/** Never let a key reach the terminal or the JSON file, whatever a provider echoes back. */
let secrets = [];
const redact = text => secrets.reduce((s, key) => s.split(key).join('[redacted]'), String(text ?? ''));

const clock = start => `${String(((Date.now() - start) / 1000).toFixed(1)).padStart(6)}s`;

// ---------------------------------------------------------------------------
// Catalogs

const PROVIDERS = [
  { kind: 'openrouter', envKey: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/api/v1/models', auth: false },
  { kind: 'groq', envKey: 'GROQ_API_KEY', url: 'https://api.groq.com/openai/v1/models', auth: true },
  { kind: 'cerebras', envKey: 'CEREBRAS_API_KEY', url: 'https://api.cerebras.ai/v1/models', auth: true },
  { kind: 'mistral', envKey: 'MISTRAL_API_KEY', url: 'https://api.mistral.ai/v1/models', auth: true },
];

const zeroPriced = model => {
  const price = model.pricing;
  if (!price) return /:free$/.test(model.id ?? '');
  return Number(price.prompt ?? 0) === 0 && Number(price.completion ?? 0) === 0;
};

/** The free models one provider offers, as route models the server can rank. */
async function catalog(provider, key) {
  const response = await fetch(provider.url, { headers: provider.auth ? { authorization: `Bearer ${key}` } : {} });
  if (!response.ok) throw new Error(`${provider.kind} catalog returned ${response.status}`);
  const body = await response.json();
  const list = Array.isArray(body.data) ? body.data : [];
  // Only OpenRouter publishes prices here; the other free tiers are free by account, not per model.
  const free = provider.kind === 'openrouter' ? list.filter(zeroPriced) : list;
  return free.filter(m => typeof m.id === 'string').map(m => ({
    connectionId: provider.kind,
    model: m.id,
    ...(m.name ? { displayName: String(m.name).slice(0, 200) } : {}),
    capabilities: { tools: null, vision: null },
    ...(Number.isInteger(m.context_length) ? { contextLength: m.context_length } : {}),
    ...(Number.isInteger(m.top_provider?.max_completion_tokens) ? { maxOutputTokens: m.top_provider.max_completion_tokens } : {}),
  }));
}

// ---------------------------------------------------------------------------
// The run

async function main() {
  const options = args(process.argv);
  if (options.help) {
    console.log(`Usage: node backend/scripts/research-run.mjs --question "..." [--depth quick|standard|deep]
                   [--server http://127.0.0.1:5175] [--env path/to/.env] [--json out.json] [--quiet]`);
    return 0;
  }
  const question = options.question || 'How do cold-climate heat pumps perform below minus 15 C, and what do they cost to install now?';
  const { env, files } = loadEnv(options.env);
  secrets = Object.entries(env).filter(([k]) => /_API_KEY$/.test(k)).map(([, v]) => v).filter(v => v.length > 8);

  if (!env.OPENROUTER_API_KEY && !env.GROQ_API_KEY && !env.CEREBRAS_API_KEY && !env.MISTRAL_API_KEY) {
    console.error(C.red('No provider key found.'), `Looked in: ${(options.env ? [options.env] : ENV_CANDIDATES).join(', ')}`);
    console.error('Add OPENROUTER_API_KEY=... to a .env, or pass --env <path>.');
    return 2;
  }
  if (!env.EXA_API_KEY) {
    console.error(C.red('No EXA_API_KEY found.'), 'Deep Research searches with Exa; add EXA_API_KEY=... to the same .env.');
    return 2;
  }
  console.log(C.dim(`env: ${files.join(', ') || '(process environment only)'}`));

  // Build the model pool from every provider whose key is present.
  const connections = [];
  const models = [];
  for (const provider of PROVIDERS) {
    const key = env[provider.envKey];
    if (!key) continue;
    try {
      const found = await catalog(provider, key);
      if (!found.length) { console.log(C.yellow(`${provider.kind}: no free models listed`)); continue; }
      connections.push({ id: provider.kind, target: { kind: provider.kind, apiKey: key } });
      models.push(...found);
      console.log(C.dim(`${provider.kind}: ${found.length} free models`));
    } catch (error) {
      console.log(C.yellow(`${provider.kind}: ${redact(error.message)}`));
    }
  }
  if (!models.length) { console.error(C.red('No free models available from any connected provider.')); return 2; }

  const body = {
    idempotencyKey: `cli-research-${Date.now()}`,
    messages: [{ role: 'user', content: question }],
    settings: { maxTokens: 8000 },
    route: { strategy: 'research', connections, models, research: { depth: options.depth } },
    search: { provider: 'exa', apiKey: env.EXA_API_KEY },
  };

  console.log(`\n${C.bold('Question')}  ${question}`);
  console.log(`${C.bold('Depth')}     ${options.depth}   ${C.bold('Pool')} ${models.length} models across ${connections.length} provider(s)\n`);

  const created = await fetch(`${options.server}/v1/runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const createdBody = await created.json().catch(() => ({}));
  if (!created.ok) { console.error(C.red(`The server refused the run (${created.status}):`), redact(createdBody.error ?? '')); return 1; }
  const runId = createdBody.id ?? createdBody.runId;
  if (!runId) { console.error(C.red('The server did not return a run id.'), JSON.stringify(createdBody).slice(0, 300)); return 1; }
  console.log(C.dim(`run ${runId}`));

  return follow(options, runId, question);
}

/** Follow the run's NDJSON events, printing a line per step and collecting a summary. */
async function follow(options, runId, question) {
  const start = Date.now();
  const response = await fetch(`${options.server}/v1/runs/${runId}/events?after=0`);
  if (!response.ok) { console.error(C.red(`Cannot follow the run (${response.status}).`)); return 1; }

  const state = {
    question, runId, steps: [], calls: [], statuses: [], searches: [], sources: [],
    report: '', outcome: 'running', error: '', errorCategory: '',
  };
  const lastStatus = new Map();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let envelope;
      try { envelope = JSON.parse(line); } catch { continue; }
      handle(envelope.event, state, lastStatus, start, options.quiet);
    }
  }
  report(state, start, options);
  return state.outcome === 'completed' ? 0 : 1;
}

function handle(event, state, lastStatus, start, quiet) {
  if (!event) return;
  if (event.type === 'delta') { state.report += event.text; return; }
  if (event.type === 'agent_output') return;
  if (event.type === 'status') {
    state.statuses.push(event.message);
    if (!quiet) console.log(`${C.dim(clock(start))} ${C.yellow('note')}   ${redact(event.message)}`);
    return;
  }
  if (event.type === 'agent') {
    const { id, role, status, model, reason } = event;
    state.steps.push({ id, role, status, model, reason, at: Date.now() - start });
    if (status === 'running' && model) state.calls.push({ id, role, model });
    if (role === 'searcher' && status === 'done') state.searches.push({ query: event.task, reason });
    // One line per transition, but do not repeat an identical line.
    const key = `${id}|${status}|${model ?? ''}`;
    if (lastStatus.get(id) === key) return;
    lastStatus.set(id, key);
    if (quiet && status === 'running') return;
    const mark = status === 'failed' ? C.red('FAIL') : status === 'done' ? C.green(' ok ') : C.dim(' .. ');
    const who = model ? ` ${model}` : '';
    const why = reason ? C.dim(` | ${redact(reason).slice(0, 150)}`) : '';
    console.log(`${C.dim(clock(start))} ${mark} ${String(id).padEnd(10)}${who}${why}`);
    return;
  }
  if (event.type === 'completed') {
    state.outcome = 'completed';
    state.sources = event.agent?.sources ?? [];
    state.usage = event.usage;
    state.finishReason = event.finishReason;
    return;
  }
  if (event.type === 'failed') {
    state.outcome = 'failed';
    state.error = redact(event.error?.message ?? '');
    state.errorCategory = event.error?.category ?? '';
    return;
  }
  if (event.type === 'canceled') state.outcome = 'canceled';
}

function report(state, start, options) {
  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  const byModel = new Map();
  for (const step of state.steps) {
    if (!step.model || step.status === 'running') continue;
    const entry = byModel.get(step.model) ?? { ok: 0, failed: 0, why: new Set() };
    if (step.status === 'done') entry.ok++;
    else { entry.failed++; if (step.reason) entry.why.add(redact(step.reason).slice(0, 90)); }
    byModel.set(step.model, entry);
  }

  console.log(`\n${C.bold('=== summary ===')}`);
  console.log(`  outcome        : ${state.outcome === 'completed' ? C.green('completed') : C.red(state.outcome)}${state.error ? `\n                   ${state.error}` : ''}`);
  if (state.errorCategory) console.log(`  error category : ${state.errorCategory}`);
  console.log(`  wall clock     : ${seconds}s`);
  console.log(`  model calls    : ${state.calls.length}   searches: ${state.searches.length}   sources cited: ${state.sources.length}`);
  console.log(`  report length  : ${state.report.length} characters`);

  if (byModel.size) {
    console.log(`\n${C.bold('  models')}`);
    for (const [model, entry] of [...byModel].sort((a, b) => (b[1].ok + b[1].failed) - (a[1].ok + a[1].failed))) {
      const line = `    ${entry.ok ? C.green(String(entry.ok) + ' ok') : '    '}  ${entry.failed ? C.red(String(entry.failed) + ' failed') : '        '}  ${model}`;
      console.log(line);
      for (const why of entry.why) console.log(C.dim(`         ${why}`));
    }
  }
  if (state.searches.length) {
    console.log(`\n${C.bold('  searches')}`);
    for (const search of state.searches) console.log(`    ${redact(search.query ?? '')} ${C.dim(`- ${redact(search.reason ?? '')}`)}`);
  }
  if (state.sources.length) {
    console.log(`\n${C.bold('  sources')}`);
    for (const source of state.sources) {
      console.log(`    [${source.n}] ${source.published ?? C.yellow('no date')}  ${source.notes} notes  ${source.title.slice(0, 70)}`);
      console.log(C.dim(`         ${source.url}`));
    }
    const dated = state.sources.filter(s => s.published).map(s => s.published).sort();
    if (dated.length) console.log(C.dim(`    dates ${dated[0]} to ${dated.at(-1)}; ${state.sources.length - dated.length} undated`));
  }
  const check = [...state.steps].reverse().find(s => s.id === 'check');
  if (check) console.log(`\n  citation check : ${check.status === 'failed' ? C.red(redact(check.reason)) : redact(check.reason)}`);

  if (options.json) {
    writeFileSync(options.json, JSON.stringify({ ...state, seconds: Number(seconds) }, null, 2));
    console.log(C.dim(`\n  written to ${options.json}`));
  }
}

main().then(code => process.exit(code ?? 0)).catch(error => {
  console.error(C.red('The harness failed:'), redact(error?.stack ?? error));
  process.exit(1);
});
