import { describe, expect, it } from 'vitest';
import type { Connection, ModelDescriptor } from '@app/types';
import type { Conversation } from './db';
import {
  attachmentFromFile,
  buildContext,
  exportConversation,
  parseConversation,
  settingsErrors,
  workbenchSettings,
} from './workbench';

const history = [
  { role: 'system' as const, content: 'Imported instruction' },
  { role: 'user' as const, content: 'First question' },
  { role: 'assistant' as const, content: 'First answer' },
  { role: 'user' as const, content: 'Second question' },
  { role: 'assistant' as const, content: 'Second answer' },
];
const settings = workbenchSettings();

describe('explicit request context', () => {
  it('keeps literal contents and never silently truncates over-budget history', () => {
    const input = [
      ...history,
      {
        role: 'user' as const,
        content: 'literal \\n\n```ts\n' + 'x'.repeat(8000),
      },
    ];
    const before = structuredClone(input);
    const preview = buildContext(input, 'Next', {
      ...settings,
      contextBudget: 1024,
    });
    expect(preview.messages).toEqual([
      ...input,
      { role: 'user', content: 'Next' },
    ]);
    expect(preview.omittedMessages).toBe(0);
    expect(preview.warnings.join(' ')).toContain('exceeds the context budget');
    expect(input).toEqual(before);
  });

  it('trims only when requested, at a complete turn boundary, retaining system instructions', () => {
    const preview = buildContext(history, 'Next', {
      ...settings,
      history: 'recent',
      recentTurns: 1,
      systemPrompt: 'Be brief',
    });
    expect(preview.messages.map((m) => m.content)).toEqual([
      'Imported instruction',
      'Be brief',
      'Second question',
      'Second answer',
      'Next',
    ]);
    expect(preview.omittedMessages).toBe(2);
    expect(history).toHaveLength(5);
  });

  it('distinguishes unknown model limits and default temperature from configured values', () => {
    const unknown = buildContext([], 'Hello', settings);
    expect(unknown.limitKnown).toBe(false);
    expect(unknown.effective).toEqual({ maxTokens: 2048 });
    const model = {
      contextLength: 4096,
      maxOutputTokens: 1000,
      capabilities: { temperature: false },
    } as ModelDescriptor;
    const known = buildContext(
      [],
      'Hello',
      { ...settings, temperatureMode: 'custom' },
      model,
      { kind: 'ollama' } as Connection,
    );
    expect(known.limitKnown).toBe(true);
    expect(known.budget).toBe(4096);
    expect(known.effective.numCtx).toBe(4096);
    expect(known.warnings.join(' ')).toContain('maximum output');
    expect(known.warnings.join(' ')).toContain('does not accept temperature');
  });

  it('adds bounded attachments as visibly delimited user context', async () => {
    const attachment = await attachmentFromFile(new File(['const value = 42;'], 'example.ts', { type: 'text/typescript' }), []);
    const preview = buildContext([], 'Explain it', settings, undefined, undefined, [attachment]);
    expect(preview.messages).toEqual([
      { role: 'system', content: expect.stringContaining('--- BEGIN FILE: example.ts ---') },
      { role: 'user', content: 'Explain it' },
    ]);
    expect(preview.messages[0].content).toContain('const value = 42;');
    await expect(attachmentFromFile(new File(['x'.repeat(100_001)], 'large.txt'), [])).rejects.toThrow('100 KB');
    await expect(attachmentFromFile(new File(['x'], 'archive.zip', { type: 'application/zip' }), [])).rejects.toThrow('supported');
    const image = await attachmentFromFile(new File(['image-bytes'], 'image.png', { type: 'image/png' }), []);
    const blocked = buildContext([], 'Describe it', settings, { capabilities: { vision: false } } as ModelDescriptor, undefined, [image]);
    expect(blocked.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'Describe it' }, expect.objectContaining({ type: 'image', mimeType: 'image/png' })]);
    expect(blocked.warnings.join(' ')).toContain('not confirmed to accept images');
  });

  it.each([
    { maxTokens: 0 },
    { contextBudget: 1 },
    { maxTokens: NaN },
    { recentTurns: 0 },
    { temperature: 3 },
    { maxTokens: 1.5 },
  ])('rejects invalid stored settings: %j', (invalid) => {
    expect(settingsErrors({ ...settings, ...invalid }).length).toBeGreaterThan(
      0,
    );
  });
});

describe('portable thread imports', () => {
  const conversation = {
    id: 'existing-id',
    title: 'Example',
    connectionId: 'destination',
    model: 'model',
    allowCharges: true,
    settings: { apiKey: 'secret' },
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        content: 'Literal \\n and <script>plain text</script>',
        createdAt: 1,
        provenance: { connectionId: 'old-connection', modelId: 'old-model' },
        metadata: { reasoning: 'A reason' },
        runId: 'private-run',
      },
    ],
  } as unknown as Conversation;

  it('exports transcript/provenance without route settings, credentials, or spending permission', () => {
    const text = exportConversation(conversation);
    expect(text).not.toMatch(
      /secret|destination|allowCharges|existing-id|private-run/,
    );
    const parsed = parseConversation(text);
    expect(parsed.title).toBe('Example');
    expect(parsed.messages[0]).toMatchObject({
      content: conversation.messages[0].content,
      provenance: conversation.messages[0].provenance,
      metadata: { reasoning: 'A reason' },
    });
    expect(parsed.messages[0].id).not.toBe('m1');
    expect(parsed.messages[0].id).not.toBe(
      parseConversation(text).messages[0].id,
    );
    expect(Object.keys(parsed).sort()).toEqual(['attachments', 'messages', 'title']);
  });

  it('round-trips attachments without exporting a connection or charge permission', () => {
    const source = { ...conversation, attachments: [{ id: 'private-file-id', name: 'notes.md', mimeType: 'text/markdown', size: 7, content: '# Notes', kind: 'text' as const, createdAt: 2 }] };
    const text = exportConversation(source);
    expect(text).not.toMatch(/private-file-id|destination|allowCharges/);
    expect(parseConversation(text).attachments).toMatchObject([{ name: 'notes.md', content: '# Notes' }]);
  });

  it('ignores injected routing fields and refuses unsupported messages or excessive data', () => {
    const data = JSON.parse(exportConversation(conversation));
    expect(
      parseConversation(
        JSON.stringify({
          ...data,
          id: 'overwrite',
          connectionId: 'hostile',
          allowCharges: true,
        }),
      ),
    ).not.toHaveProperty('connectionId');
    expect(() => parseConversation('{bad')).toThrow('valid JSON');
    expect(() =>
      parseConversation(
        JSON.stringify({ ...data, messages: [{ role: 'tool', content: 'x' }] }),
      ),
    ).toThrow('invalid');
    expect(() => parseConversation('x'.repeat(8_000_001))).toThrow('8 MB');
  });
});
