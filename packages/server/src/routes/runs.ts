import { Router } from 'express';
import type { RunEnvelope, RunMessage, ToolName } from '@app/types';
import { resolveTarget, ResolvedTarget } from '../runtime/destinations.js';
import { ModelRequest, streamModel } from '../runtime/adapters.js';
import { DOCUMENT_TOOLS, TOOL_NAMES, WorkspaceDocument } from '../runtime/tools.js';
import { runWithTools } from '../runtime/toolLoop.js';
import { RunExecutor, RunRegistry } from '../runtime/runs.js';

type FetchFn = typeof fetch;

interface ValidRun {
  key: string;
  request: ModelRequest;
  tools: ToolName[];
  documents: WorkspaceDocument[];
  search?: { apiKey: string };
}

const LIMITS = [['temperature', 0, 2, false], ['maxTokens', 1, 128_000, true], ['numCtx', 1024, 1_048_576, true]] as const;

export function validateRunRequest(body: any): ValidRun {
  if (!body || typeof body !== 'object') throw new Error('Request body is required.');
  if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.idempotencyKey)) throw new Error('A valid idempotency key is required.');
  const target: ResolvedTarget = resolveTarget(body.target);
  if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 200) throw new Error('Select a model.');
  const messages = body.messages;
  const contentValid = (message: any) => typeof message.content === 'string' || (message.role === 'user' && Array.isArray(message.content) && message.content.length > 0 && message.content.length <= 5 && message.content.every((part: any) => part && (part.type === 'text' ? typeof part.text === 'string' : part.type === 'image' && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(part.mimeType) && typeof part.data === 'string' && part.data.length > 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(part.data))));
  if (!Array.isArray(messages) || !messages.length || messages.length > 200 || messages.some((m: any) => !m || !['user', 'assistant', 'system'].includes(m.role) || !contentValid(m))) throw new Error('Provide 1–200 valid text or image messages.');
  const textLength = messages.reduce((n: number, m: any) => n + (typeof m.content === 'string' ? m.content.length : m.content.reduce((sum: number, part: any) => sum + (part.type === 'text' ? part.text.length : 0), 0)), 0);
  const imageBytes = messages.reduce((n: number, m: any) => n + (Array.isArray(m.content) ? m.content.reduce((sum: number, part: any) => sum + (part.type === 'image' ? Math.floor(part.data.length * 3 / 4) : 0), 0) : 0), 0);
  if (textLength > 200_000) throw new Error('This conversation is too long. Start a new thread.');
  if (imageBytes > 5_000_000) throw new Error('Images exceed the 5 MB request limit.');
  const settings = body.settings ?? {};
  if (typeof settings !== 'object') throw new Error('Settings must be an object.');
  for (const [name, min, max, integer] of LIMITS) {
    const value = settings[name];
    if (value !== undefined && (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))) throw new Error(`Invalid ${name}: use ${min}–${max}.`);
  }
  const tools: ToolName[] = body.tools ?? [];
  if (!Array.isArray(tools) || tools.some(name => !TOOL_NAMES.includes(name)) || new Set(tools).size !== tools.length) throw new Error(`Choose tools from: ${TOOL_NAMES.join(', ')}.`);
  const documents = body.documents ?? [];
  if (!Array.isArray(documents) || documents.length > 20 || documents.some((d: any) => !d || typeof d.id !== 'string' || typeof d.title !== 'string' || d.title.length > 200 || typeof d.content !== 'string' || d.content.length > 100_000)) throw new Error('Attach up to 20 text documents, each under 100,000 characters.');
  if (documents.reduce((n: number, d: any) => n + d.content.length, 0) > 400_000) throw new Error('Attached documents exceed 400,000 characters.');
  let search: ValidRun['search'];
  if (tools.includes('web_search')) {
    const key = body.search?.apiKey;
    if (body.search?.provider !== 'exa' || typeof key !== 'string' || !/^[\x21-\x7e]{8,200}$/.test(key)) throw new Error('Web search needs an Exa API key. Add one in Connections.');
    search = { apiKey: key };
  }
  const documentTools = tools.some(name => DOCUMENT_TOOLS.has(name));
  if (documentTools) {
    if (!documents.length) throw new Error('Add a document in Workspace before enabling document tools.');
    if (target.execution !== 'local') throw new Error('Document tools run only on models on this machine. Documents are not sent to remote endpoints.');
  }
  return {
    key: body.idempotencyKey,
    request: {
      target, model: body.model,
      messages: messages.map(({ role, content }: RunMessage) => ({ role, content: structuredClone(content) })),
      temperature: settings.temperature, maxTokens: settings.maxTokens, numCtx: settings.numCtx,
    },
    tools,
    // Documents reach the model only through document tool calls.
    documents: documentTools ? documents : [],
    ...(search ? { search } : {}),
  };
}

function executorFor(run: ValidRun, fetchImpl: FetchFn): RunExecutor {
  return async ({ signal, emit }) => {
    const events = run.tools.length
      ? runWithTools(run.request, run.tools, run.documents, signal, fetchImpl, run.search)
      : streamModel(run.request, signal, fetchImpl);
    for await (const event of events) {
      if (event.type === 'done') return { usage: event.usage, finishReason: event.finishReason, ...(event.loadMs !== undefined ? { loadMs: event.loadMs } : {}) };
      emit(event);
    }
    throw new Error('The model stream ended without a result.');
  };
}

export function runsRouter(registry: RunRegistry, fetchImpl: FetchFn = fetch): Router {
  const router = Router();

  router.post('/', (req, res) => {
    let run: ValidRun;
    try { run = validateRunRequest(req.body); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    const started = registry.start(run.key, run.request.target.execution === 'local', executorFor(run, fetchImpl));
    res.status(started.existing ? 200 : 201).json(started);
  });

  // NDJSON stream of run envelopes. `after` resumes following the last sequence the client saw.
  router.get('/:id/events', (req, res) => {
    const after = Number(req.query.after ?? 0);
    if (!Number.isInteger(after) || after < 0) { res.status(400).json({ error: 'after must be a non-negative integer.' }); return; }
    const write = (envelope: RunEnvelope) => {
      res.write(JSON.stringify(envelope) + '\n');
      if (envelope.event.type === 'completed' || envelope.event.type === 'failed' || envelope.event.type === 'canceled') res.end();
    };
    const result = registry.subscribe(req.params.id, after, write);
    if (result.status === 'unknown') { res.status(404).json({ error: 'This run is no longer available on the server.', code: 'unknown-run' }); return; }
    if (result.status === 'expired') { res.status(410).json({ error: 'The missing part of this run can no longer be replayed.', code: 'replay-unavailable' }); return; }
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    for (const envelope of result.replay) write(envelope);
    if (result.terminal) { if (!res.writableEnded) res.end(); return; }
    // Closing the stream does not cancel the run; the client may reconnect.
    res.on('close', result.unsubscribe);
  });

  router.post('/:id/cancel', (req, res) => {
    const state = registry.cancel(req.params.id, 'user');
    if (!state) { res.status(404).json({ error: 'This run is no longer available on the server.', code: 'unknown-run' }); return; }
    res.json({ state });
  });

  return router;
}
