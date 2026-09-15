import { describe, expect, it } from 'vitest';
import { readDocument } from './documents';
import { attachmentFromFile, buildContext, exportConversation, parseConversation, workbenchSettings } from './workbench';
import type { Conversation } from './db';

describe('document ingestion and model context', () => {
  it('reads UTF-16 and extensionless text, preserving non-English text', async () => {
    const bytes = new Uint8Array([255, 254, ...Array.from('Budget: £42').flatMap(c => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8])]);
    expect(await readDocument(new File([bytes], 'budget.txt'))).toBe('Budget: £42');
    expect(await readDocument(new File(['FROM node:22\n'], 'Dockerfile'))).toBe('FROM node:22');
    expect(await readDocument(new File(['项目预算: 42'], 'notes.txt'))).toBe('项目预算: 42');
  });

  it('rejects empty, binary, oversized, and legacy documents with useful errors', async () => {
    await expect(readDocument(new File([], 'empty.txt'))).rejects.toThrow('empty');
    await expect(readDocument(new File(['\0\x01binary'], 'disguised.txt'))).rejects.toThrow('binary');
    await expect(readDocument(new File([new Uint8Array(20_000_001)], 'large.pdf'))).rejects.toThrow('20 MB');
    await expect(readDocument(new File(['legacy'], 'old.doc'))).rejects.toThrow('Export');
  });

  it('reads rich text with Unicode, escaped characters, tables, and hidden metadata', async () => {
    const rtf = String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl{\f0 Arial;}}{\*\generator Hidden metadata;}Budget: \'a342\par Owner\cell Amira\row Unicode: \uc1\u39033?\u30446?\par Escaped: \{ok\} \\ {\v secret}{\pict\bin3 {}x}{\field{\*\fldinst HYPERLINK "secret"}{\fldrslt Website}}}`;
    expect(await readDocument(new File([rtf], 'notes.rtf'))).toBe('Budget: £42\nOwner\tAmira\nUnicode: 项目\nEscaped: {ok} \\ Website');
    await expect(readDocument(new File([String.raw`{\rtf1 broken`], 'broken.rtf'))).rejects.toThrow('damaged groups');
    await expect(readDocument(new File(['plain text'], 'invalid.rtf'))).rejects.toThrow('valid RTF');
  });

  it('decodes multibyte RTF escapes and skips Unicode fallback characters', async () => {
    const rtf = String.raw`{\rtf1\ansi\ansicpg65001 \'e9\'a1\'b9\'e7\'9b\'ae \uc2\u39033\'3f\'3f\u30446??}`;
    expect(await readDocument(new File([rtf], 'unicode.rtf', { type: 'text/rtf' }))).toBe('项目 项目');
  });

  it('finds a fact deep in a large file without overflowing a small model context', async () => {
    const content = `${'General background information.\n'.repeat(6000)}\nThe cobalt launch code is ZEBRA-729.\n${'More background.\n'.repeat(4000)}`;
    const attachment = await attachmentFromFile(new File([content], 'large-report.txt'), []);
    const settings = { ...workbenchSettings(), contextBudget: 4096, maxTokens: 512 };
    const result = buildContext([], 'What is the cobalt launch code?', settings, undefined, undefined, [attachment]);
    expect(result.warnings).toEqual([]);
    expect(result.estimatedTokens + result.effective.maxTokens!).toBeLessThanOrEqual(4096);
    expect(JSON.stringify(result.messages)).toContain('ZEBRA-729');
    expect(JSON.stringify(result.messages)).toContain('full document is not included');
    expect(result.notices.join(' ')).toContain('selected excerpts');
    expect(attachment.content).toContain(content.trim());
  });

  it('keeps every small document and balances excerpts from multiple large documents', async () => {
    const files = await Promise.all(['one', 'two', 'three'].map(name => attachmentFromFile(new File([`${'背景信息'.repeat(30_000)}\n${name} cobalt code: 42\n`], `${name}.txt`), [])));
    const small = await attachmentFromFile(new File(['Keep this complete.'], 'small.txt'), []);
    const result = buildContext([], 'Find cobalt code in each file', { ...workbenchSettings(), contextBudget: 4096, maxTokens: 512 }, undefined, undefined, [...files, small]);
    expect(result.warnings).toEqual([]);
    const text = JSON.stringify(result.messages);
    for (const name of ['one', 'two', 'three']) expect(text).toContain(`${name} cobalt code: 42`);
    expect(text).toContain('Keep this complete.');
  });

  it('keeps the recent conversation alongside large-document excerpts for follow-up questions', async () => {
    const attachment = await attachmentFromFile(new File([
      `${'Background notes.\n'.repeat(20_000)}\nCobalt launch code: ZEBRA-729.`,
    ], 'report.txt'), []);
    const recent = [
      { role: 'user' as const, content: 'Review the cobalt launch. ' + 'Focus on launch readiness. '.repeat(35) },
      { role: 'assistant' as const, content: 'The launch needs a code check. ' + 'Confirm the release checklist. '.repeat(35) },
    ];
    const history = [{ role: 'user' as const, content: 'Old unrelated discussion. '.repeat(1000) }, ...recent];
    const result = buildContext(history, 'What is its code?', { ...workbenchSettings(), contextBudget: 4096, maxTokens: 512 }, undefined, undefined, [attachment]);
    expect(result.warnings).toEqual([]);
    expect(result.estimatedTokens + result.effective.maxTokens!).toBeLessThanOrEqual(4096);
    for (const message of recent) expect(result.messages).toContainEqual(message);
    expect(JSON.stringify(result.messages)).toContain('ZEBRA-729');
    expect(result.omittedMessages).toBe(1);
  });

  it('round-trips larger extracted attachments through thread export', async () => {
    const attachment = await attachmentFromFile(new File(['Detailed notes.\n'.repeat(15_000)], 'notes.txt'), []);
    const conversation = { title: 'Documents', messages: [], attachments: [attachment] } as unknown as Conversation;
    expect(parseConversation(exportConversation(conversation)).attachments?.[0].content).toBe(attachment.content);
  });
});
