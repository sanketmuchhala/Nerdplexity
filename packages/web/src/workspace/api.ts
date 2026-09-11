import type { RunRecord } from '../lib/db';

export type RunEvent =
  | { type: 'status'; message: string }
  | { type: 'delta'; text: string }
  | ({ type: 'tool' } & RunRecord['tools'][number])
  | { type: 'done'; usage?: RunRecord['usage']; duration_ms: number; ttft_ms?: number }
  | { type: 'error'; message: string };

export const sizeLabel = (bytes?: number) => bytes === undefined ? 'Size not reported' : `${(bytes / 1024 ** 3).toFixed(1)} GB`;
export const tokensLabel = (n?: number) => n === undefined ? undefined : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`;

export async function consumeRun(response: Response, onEvent: (event: RunEvent) => void) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  if (!response.body) throw new Error('The runtime returned no stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as RunEvent;
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'done') completed = true;
    onEvent(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
      if (done) break;
    }
    consume(buffer);
    if (!completed) throw new Error('The connection ended before the run finished.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function exportText(name: string, text: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
