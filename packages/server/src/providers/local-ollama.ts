import { ChatRequest, ChatResponse, ProviderAdapter } from '../types.js';
import { requestCompletion } from '../runtime/local.js';
import { discover } from '../runtime/discovery.js';

export type OllamaMsg = { role: 'system' | 'user' | 'assistant'; content: string };
export type OllamaConfig = {
  baseURL?: string; model: string; temperature?: number; max_tokens?: number;
  num_ctx?: number; stream?: boolean; performanceMode?: boolean;
};

export async function pingOllama(baseURL?: string) {
  const result = await discover({ kind: 'ollama', baseURL: baseURL || 'http://127.0.0.1:11434' });
  return result.ok ? { ok: true } : { ok: false, error: result.error.message };
}

// The compatibility endpoint shares generation options with the workspace.
export async function chatWithOllama(opts: { config: OllamaConfig; messages: OllamaMsg[]; signal?: AbortSignal }) {
  const request = { ...opts.config, runtime: 'ollama' as const, messages: opts.messages };
  const signal = opts.signal || AbortSignal.timeout(600_000);
  // Streaming runs use the run engine (/v1/runs); this legacy path returns whole responses.
  const result = await requestCompletion(request, signal);
  return { text: result.message.content || '', usage: result.usage, raw: result.message };
}

export const localOllamaProvider: ProviderAdapter = {
  name: 'Local (Ollama)',
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const result = await chatWithOllama({ config: { baseURL: request.baseURL, model: request.model, temperature: request.temperature, max_tokens: request.max_tokens, num_ctx: request.num_ctx, stream: false }, messages: request.messages });
    return { message: { role: 'assistant', content: result.text, timestamp: Date.now() }, usage: result.usage };
  },
};
