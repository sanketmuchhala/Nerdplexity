import type { RunEnvelope, RunStartRequest, RunStartResponse, TerminalPayload } from '@app/types';
import { apiUrl } from '../lib/backend';

/** The server no longer has this run (restart, expiry) or cannot replay what the client missed. */
export class RunUnavailable extends Error {}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

const isTerminal = (envelope: RunEnvelope): envelope is RunEnvelope & { event: TerminalPayload } =>
  envelope.event.type === 'completed' || envelope.event.type === 'failed' || envelope.event.type === 'canceled';

/**
 * Start a run. Network failures are retried with the same idempotency key,
 * so the server starts the model request at most once.
 */
export async function startRun(request: RunStartRequest, signal: AbortSignal): Promise<RunStartResponse> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(apiUrl('/v1/runs'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal });
    } catch (error) {
      if (signal.aborted || attempt >= 2) throw signal.aborted ? error : new Error('The Nerdplexity backend is not responding. Start it with pnpm dev.');
      await sleep(400 * (attempt + 1), signal);
      continue;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `The run could not start (${response.status}).`);
    return data;
  }
}

/**
 * Follow a run's events after `after`, reconnecting on dropped connections.
 * Resolves with the terminal event; replayed events are never delivered twice.
 */
export async function followRun(runId: string, after: number, onEnvelope: (envelope: RunEnvelope) => void, signal: AbortSignal): Promise<TerminalPayload> {
  let last = after;
  let failures = 0;
  while (true) {
    signal.throwIfAborted();
    let response: Response | undefined;
    try {
      response = await fetch(apiUrl(`/v1/runs/${encodeURIComponent(runId)}/events?after=${last}`), { signal });
      if (response.status === 404 || response.status === 410) {
        const data = await response.json().catch(() => ({}));
        throw new RunUnavailable(data.error || 'This run is no longer available.');
      }
      if (!response.ok || !response.body) throw new Error(`Event stream failed (${response.status}).`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          let index: number;
          while ((index = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            if (!line.trim()) continue;
            const envelope = JSON.parse(line) as RunEnvelope;
            if (envelope.seq <= last) continue;
            last = envelope.seq;
            failures = 0;
            onEnvelope(envelope);
            if (isTerminal(envelope)) return envelope.event;
          }
          if (done) break;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof RunUnavailable || signal.aborted) throw error;
    }
    // The stream ended or dropped before a terminal event; resume after the last sequence.
    if (++failures > 6) throw new RunUnavailable('Lost the connection to this run.');
    await sleep(Math.min(250 * 2 ** (failures - 1), 4000), signal);
  }
}

export async function cancelRun(runId: string) {
  await fetch(apiUrl(`/v1/runs/${encodeURIComponent(runId)}/cancel`), { method: 'POST' }).catch(() => undefined);
}
