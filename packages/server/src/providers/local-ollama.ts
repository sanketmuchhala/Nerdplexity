import { ChatRequest, ChatResponse, ProviderAdapter } from '../types.js';
import http from 'http';
import https from 'https';

export type OllamaMsg = { role: "system" | "user" | "assistant"; content: string };

// Keep-alive agents for connection reuse
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 4,
  timeout: 5000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 4,
  timeout: 5000
});

function agentFor(url: string) {
  return url.startsWith('https') ? httpsAgent : httpAgent;
}

type NodeFetchInit = RequestInit & {
  agent?: http.Agent | https.Agent;
};

// Enhanced gemma2 detection
function isGemma2(model?: string): boolean {
  return !!(model && /^gemma2/i.test(model));
}

// Prewarming functionality
let prewarmed = false;
async function prewarm(baseURL: string, model: string): Promise<void> {
  if (prewarmed || !isGemma2(model)) return;

  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 5000);

    const init: NodeFetchInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '.' }],
        stream: false,
        options: { num_predict: 1 }
      }),
      agent: agentFor(baseURL),
      signal: ac.signal
    };

    await fetch(`${baseURL}/api/chat`, init).catch(() => {}); // Ignore errors during prewarming

    clearTimeout(timeout);
    prewarmed = true;
  } catch {
    // Prewarming failure is non-critical
  }
}

// Performance defaults for gemma2
const GEMMA2_PERFORMANCE_DEFAULTS = {
  temperature: 0.2,
  top_p: 0.9,
  top_k: 40,
  num_ctx: 1024,
  num_predict: 128,
  num_thread: 6,
  use_mmap: true,
  use_mlock: false,
  repeat_penalty: 1.05,
  stream: true,
  num_batch: 256,
  low_vram: true,
  flash_attention: true
};

type OllamaPerformanceDefaults = Partial<typeof GEMMA2_PERFORMANCE_DEFAULTS>;

export type OllamaConfig = {
  baseURL?: string;
  model: string;
  temperature?: number;
  max_tokens?: number; // -> num_predict
  num_ctx?: number;
  top_p?: number;
  top_k?: number;
  num_thread?: number;
  use_mmap?: boolean;
  use_mlock?: boolean;
  stream?: boolean;
  performanceMode?: boolean; // new flag
  quantization?: 'q4_K_M' | 'q8_0' | 'fp16' | 'default';
  num_gpu?: number;
  flash_attention?: boolean;
};

function normBaseURL(u?: string) {
  let v = (u || "http://localhost:11434").trim();
  if (v.endsWith("/")) v = v.slice(0, -1);
  if (!/^https?:\/\//i.test(v)) throw new Error(`Invalid baseURL: ${v}`);
  return v;
}

export async function pingOllama(baseURL?: string) {
  const url = `${normBaseURL(baseURL)}/api/tags`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 5000);
  try {
    const r = await fetch(url, { method: "GET", signal: ac.signal });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  } finally { 
    clearTimeout(t); 
  }
}

export async function chatWithOllama(opts: {
  config: OllamaConfig;
  messages: OllamaMsg[];
  signal?: AbortSignal;
}) {
  const baseURL = normBaseURL(opts.config.baseURL);
  const pm = opts.config.performanceMode !== false; // default ON
  const stream = opts.config.stream ?? true; // DEFAULT STREAMING ON for local

  // Enhanced gemma2 detection and prewarming
  const isGemmaModel = isGemma2(opts.config.model);

  // Prewarm the model for faster first response
  await prewarm(baseURL, opts.config.model);

  // Use performance defaults for gemma2, fallback to existing logic
  const baseDefaults: OllamaPerformanceDefaults = isGemmaModel && pm ? GEMMA2_PERFORMANCE_DEFAULTS : {};

  const options: any = {
    temperature: opts.config.temperature ?? baseDefaults.temperature ?? 0.7,
    // Context window - aggressive optimization for gemma2
    num_ctx: opts.config.num_ctx ?? baseDefaults.num_ctx ?? (pm ? 1024 : 2048),
    // Token generation limits
    ...(typeof opts.config.max_tokens === "number"
        ? { num_predict: Math.min(opts.config.max_tokens, baseDefaults.num_predict ?? (pm ? 128 : 256)) }
        : { num_predict: baseDefaults.num_predict ?? (pm ? 128 : 256) }),
    // Sampling parameters
    top_p: opts.config.top_p ?? baseDefaults.top_p ?? 0.9,
    top_k: opts.config.top_k ?? baseDefaults.top_k ?? 40,
    // Thread optimization
    num_thread: opts.config.num_thread ?? baseDefaults.num_thread ?? (pm ? 4 : 6),
    // Memory optimizations
    use_mmap: opts.config.use_mmap ?? baseDefaults.use_mmap ?? true,
    use_mlock: opts.config.use_mlock ?? baseDefaults.use_mlock ?? false,
    // Batch processing
    num_batch: baseDefaults.num_batch ?? (pm ? 256 : 512),
    repeat_penalty: baseDefaults.repeat_penalty ?? 1.1,
    // GPU settings
    num_gpu: opts.config.num_gpu ?? 1,
    // Memory optimization flags
    low_vram: baseDefaults.low_vram ?? true,
    // Flash attention for gemma2
    flash_attention: opts.config.flash_attention ?? baseDefaults.flash_attention ?? isGemmaModel
  };

  const body: any = {
    model: opts.config.model,
    messages: opts.messages,
    options,
    stream
  };

  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 30_000);
    try {
      const init: NodeFetchInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        agent: agentFor(baseURL),
        signal: opts.signal || ac.signal
      };
      const res = await fetch(`${baseURL}/api/chat`, init);
      clearTimeout(timeout);
      
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Ollama HTTP ${res.status}: ${txt.slice(0, 240)}`);
      }
      
      if (stream) {
        // Handle streaming response by aggregating chunks
        let text = "";
        const reader = res.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            
            // Decode the chunk and parse streaming JSON responses
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
              try {
                const json = JSON.parse(line);
                if (json.message?.content) {
                  text += json.message.content;
                }
              } catch {
                // Skip invalid JSON lines
              }
            }
          }
          // Fix escaped characters and line breaks for proper display
          const cleanedText = text.replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
          return { text: cleanedText, usage: null, raw: null };
        }
        // Fallback if no reader available
        const txt = await res.text();
        return { text: txt, usage: null, raw: null };
      }
      
      const json = await res.json() as { message?: { content?: string } };
      const rawText = json?.message?.content ?? "";
      // Fix escaped characters and line breaks for proper display
      const text = rawText.replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
      return { text, usage: null, raw: json };
      
    } catch (e: any) {
      clearTimeout(timeout);
      lastErr = e;
      const msg = String(e?.message || e);
      if (msg.includes("ECONNREFUSED") || msg.includes("connect") || 
          msg.includes("Failed to fetch") || msg.includes("aborted")) {
        await new Promise(r => setTimeout(r, 300));
        continue;
      }
      throw e;
    }
  }
  throw new Error(`Cannot reach Ollama at ${baseURL}: ${String(lastErr?.message || lastErr)}`);
}

// Legacy adapter for existing ChatRequest interface
export const localOllamaProvider: ProviderAdapter = {
  name: 'Local (Ollama)',
  
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { 
      messages, 
      model, 
      temperature = 0.2, 
      max_tokens,
      baseURL = 'http://localhost:11434',
      num_ctx,
      performanceMode = true
    } = request;

    const ollamaMessages: OllamaMsg[] = messages.map(m => ({ 
      role: m.role as "system" | "user" | "assistant", 
      content: m.content 
    }));

    const config: OllamaConfig = {
      baseURL,
      model,
      temperature,
      max_tokens,
      num_ctx,
      performanceMode,
      stream: false
    };

    try {
      const result = await chatWithOllama({
        config,
        messages: ollamaMessages
      });

      return {
        message: {
          role: 'assistant',
          content: result.text,
          timestamp: Date.now()
        },
        usage: result.usage || undefined
      };
    } catch (error: any) {
      if (error.message.includes('Cannot reach Ollama')) {
        throw { 
          code: 'CONNECTION', 
          provider: 'local-ollama', 
          message: `Ollama not reachable at ${baseURL}. Make sure Ollama is running with 'ollama serve'.` 
        };
      }
      throw { 
        code: 'API_ERROR', 
        provider: 'local-ollama', 
        message: error.message
      };
    }
  }
};
