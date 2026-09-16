import { describe, expect, it } from 'vitest';
import { readDocument } from './documents';
import { attachmentFromFile, exportConversation, parseConversation } from './workbench';
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

  it('round-trips larger extracted attachments through thread export', async () => {
    const attachment = await attachmentFromFile(new File(['Detailed notes.\n'.repeat(15_000)], 'notes.txt'), []);
    const conversation = { title: 'Documents', messages: [], attachments: [attachment] } as unknown as Conversation;
    expect(parseConversation(exportConversation(conversation)).attachments?.[0].content).toBe(attachment.content);
  });
});
