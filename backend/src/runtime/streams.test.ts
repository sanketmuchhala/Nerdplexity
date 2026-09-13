import { describe, expect, it } from 'vitest';
import { readLines } from './streams.js';

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
  });
}

async function collect(chunks: Uint8Array[]) {
  const lines: string[] = [];
  for await (const line of readLines(streamOf(chunks))) lines.push(line);
  return lines;
}

describe('readLines', () => {
  const records = [{ message: { content: 'naïve café \u{1F642}' } }, { message: { content: 'a\\b "quoted"\n' } }, { done: true }];
  const bytes = new TextEncoder().encode(records.map(r => JSON.stringify(r)).join('\n') + '\n');

  it('reassembles records and multi-byte characters split at every byte boundary', async () => {
    for (let size = 1; size <= 7; size++) {
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
      const lines = await collect(chunks);
      expect(lines.map(line => JSON.parse(line))).toEqual(records);
    }
  });

  it('keeps a final record without a trailing newline and strips CRLF', async () => {
    const lines = await collect([new TextEncoder().encode('data: one\r\n\r\ndata: two')]);
    expect(lines).toEqual(['data: one', 'data: two']);
  });
});
