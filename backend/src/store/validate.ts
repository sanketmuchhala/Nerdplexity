import { z } from 'zod';

// Shapes the server checks before storing a record. Fields it indexes are checked strictly; the
// rest of a record (settings, workbench, tool traces) is stored as the web app wrote it.

export const id = z.string().min(1).max(200);
export const time = z.number().int().min(0).max(8.64e15);
const json = z.record(z.string(), z.unknown());
const text = (max: number) => z.string().max(max);

export const modelRef = z.object({ connectionId: text(200), modelId: text(300) });

export const message = z.object({
  id,
  role: z.enum(['user', 'assistant', 'system']),
  content: text(2_000_000),
  createdAt: time,
  metadata: json.optional(),
  provenance: modelRef.optional(),
  runId: text(200).optional(),
  runStatus: z.enum(['canceled', 'failed', 'interrupted']).optional(),
  finishReason: text(100).optional(),
  feedback: z.enum(['helpful', 'unhelpful']).optional(),
});
export type MessageInput = z.infer<typeof message>;

export const pdfBase64 = z.string().max(26_666_668).refine(value => {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length <= 20_000_000 && bytes.toString('base64') === value && bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'));
}, 'Choose a PDF smaller than 20 MB.');
export const pdfSource = z.object({ pdfBase64 });

export const attachment = z.object({
  id,
  name: text(500),
  mimeType: text(200),
  size: z.number().int().min(0),
  content: text(20_000_000),
  kind: z.enum(['text', 'image']),
  pdfBase64: pdfBase64.optional(),
  createdAt: time,
}).refine(file => !file.pdfBase64 || file.kind === 'text', 'Only document attachments can have a PDF original.');
export type AttachmentInput = z.infer<typeof attachment>;

/** Conversation fields with their own columns; anything else is kept in `extra`. */
export const CONVERSATION_FIELDS = ['id', 'title', 'provider', 'model', 'connectionId', 'allowCharges', 'settings', 'workbench', 'branchOf', 'createdAt', 'updatedAt', 'messages', 'attachments'] as const;

export const conversation = z.looseObject({
  id,
  title: text(1000),
  provider: text(50),
  model: text(300),
  connectionId: text(200).optional(),
  allowCharges: z.boolean().optional(),
  settings: json,
  workbench: json.optional(),
  branchOf: z.object({ conversationId: id, messageId: id }).optional(),
  createdAt: time,
  updatedAt: time,
  messages: z.array(message).max(20_000),
  attachments: z.array(attachment).max(200).optional(),
});
export type ConversationInput = z.infer<typeof conversation>;

export const conversationPatch = z.object({
  title: text(1000).optional(),
  provider: text(50).optional(),
  model: text(300).optional(),
  connectionId: text(200).nullable().optional(),
  allowCharges: z.boolean().optional(),
  settings: json.optional(),
  workbench: json.optional(),
  updatedAt: time.optional(),
});
export type ConversationPatch = z.infer<typeof conversationPatch>;

export const appendMessage = z.object({
  message,
  /** The thread's new title, when this message names it. */
  title: text(1000).optional(),
  updatedAt: time.optional(),
});

export const messagePatch = z.object({ feedback: z.enum(['helpful', 'unhelpful']).nullable() });

export const fork = z.object({
  id,
  beforeMessageId: id,
  title: text(1000),
  workbench: json.optional(),
  createdAt: time,
});
export type ForkInput = z.infer<typeof fork>;

export const document = z.object({ id, title: text(500), content: text(2_000_000), updatedAt: time });
export type DocumentInput = z.infer<typeof document>;

// Records stored whole. Only the listed fields are checked.
export const runRecord = z.looseObject({ id, conversationId: text(200), status: text(40), startedAt: time });
export const runPatch = json;
export const connection = z.looseObject({ id, kind: text(60), createdAt: time });
export const preset = z.looseObject({ id, name: text(500) });
export const comparison = z.looseObject({ id, createdAt: time });
export const settingsValue = json;

/** Fields that could hold a credential. Records never keep them, whatever the client sends. */
const SECRET_FIELDS = ['apiKey', 'apiKeys', 'key', 'token', 'password', 'secret'];

export function withoutSecrets<T extends Record<string, unknown>>(record: T): T {
  const copy = { ...record };
  for (const field of SECRET_FIELDS) delete copy[field];
  return copy;
}

/** A short, safe description of why a body was rejected: the first failing field. */
export function describe(error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue?.path.length ? issue.path.join('.') : 'body';
  return `Invalid ${where}: ${issue?.message ?? 'unexpected value'}.`;
}
