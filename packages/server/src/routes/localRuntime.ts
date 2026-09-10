import { Router } from 'express';
import { once } from 'events';
import os from 'os';
import { discoverModels, LocalRequest, RunEvent, RuntimeKind, runtimeURL, streamChat } from '../runtime/local.js';
import { runWorkspaceAgent, WorkspaceDocument } from '../runtime/agent.js';
import { enqueueLocal } from '../queue/localQueue.js';

export const localRuntime: Router = Router();

function kind(value: unknown): RuntimeKind {
  if (value !== 'ollama' && value !== 'openai-compatible') throw new Error('Choose Ollama or an OpenAI-compatible local runtime.');
  return value;
}

export function validateLocalRequest(body: any): { request: LocalRequest; documents: WorkspaceDocument[]; agent: boolean } {
  if (!body || typeof body !== 'object') throw new Error('Request body is required.');
  const runtime = kind(body.runtime);
  if (body.baseURL !== undefined && typeof body.baseURL !== 'string') throw new Error('Runtime URL must be text.');
  const baseURL = runtimeURL(runtime, body.baseURL);
  if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 200) throw new Error('Select an installed model.');
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 200 || body.messages.some((m: any) => !m || !['user', 'assistant', 'system'].includes(m.role) || typeof m.content !== 'string')) throw new Error('Provide 1–200 text messages.');
  if (body.messages.reduce((n: number, m: any) => n + m.content.length, 0) > 200_000) throw new Error('This conversation is too long. Start a new thread.');
  for (const [key, min, max] of [['temperature', 0, 2], ['max_tokens', 1, 32768], ['num_ctx', 1024, 131072]] as const) {
    if (body[key] !== undefined && (!Number.isFinite(body[key]) || body[key] < min || body[key] > max || (key !== 'temperature' && !Number.isInteger(body[key])))) throw new Error(`Invalid ${key}: use ${min}–${max}.`);
  }
  if (body.agent !== undefined && typeof body.agent !== 'boolean') throw new Error('Agent mode must be true or false.');
  const documents = body.documents ?? [];
  if (!Array.isArray(documents) || documents.length > 20 || documents.some((d: any) => !d || typeof d.id !== 'string' || typeof d.title !== 'string' || d.title.length > 200 || typeof d.content !== 'string' || d.content.length > 100_000)) throw new Error('Attach up to 20 text documents, each under 100,000 characters.');
  if (documents.reduce((n: number, d: any) => n + d.content.length, 0) > 400_000) throw new Error('Attached documents exceed 400,000 characters.');
  if (body.agent && !documents.length) throw new Error('Add a document in Workspace before starting a document agent.');
  return { request: { runtime, baseURL, model: body.model, messages: body.messages.map(({ role, content }: any) => ({ role, content })), temperature: body.temperature, max_tokens: body.max_tokens, num_ctx: body.num_ctx }, documents, agent: body.agent === true };
}

localRuntime.get('/models', async (req, res) => {
  try {
    const runtime = kind(req.query.runtime || 'ollama');
    const baseURL = runtimeURL(runtime, req.query.baseURL as string | undefined);
    const models = await discoverModels(runtime, baseURL);
    res.json({ runtime, baseURL, models, host: { platform: os.platform(), arch: os.arch(), memory: os.totalmem(), freeMemory: os.freemem(), cpus: os.cpus().length } });
  } catch (error) {
    res.status(502).json({ error: (error as Error).message.includes('fetch failed') ? 'Local runtime is offline. Start Ollama or your model server, then reconnect.' : (error as Error).message });
  }
});

localRuntime.post('/run', async (req, res) => {
  let input: ReturnType<typeof validateLocalRequest>;
  try { input = validateLocalRequest(req.body); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Run exceeded the 10-minute limit.')), 600_000);
  const disconnected = () => controller.abort();
  res.on('close', disconnected);
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const emit = async (event: RunEvent) => {
    controller.signal.throwIfAborted();
    if (!res.write(JSON.stringify(event) + '\n')) await once(res, 'drain', { signal: controller.signal });
  };
  try {
    await emit({ type: 'status', message: 'Queued for local inference' });
    await enqueueLocal(async () => {
      controller.signal.throwIfAborted();
      const events = input.agent ? runWorkspaceAgent(input.request, input.documents, controller.signal) : streamChat(input.request, controller.signal);
      for await (const event of events) await emit(event);
    });
  } catch (error) {
    if (!res.destroyed) res.write(JSON.stringify({ type: 'error', message: controller.signal.aborted ? 'Run stopped or timed out.' : (error as Error).message }) + '\n');
  } finally {
    clearTimeout(timer);
    res.off('close', disconnected);
    res.end();
  }
});
