import { and, asc, desc, eq, getTableColumns, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { attachments, conversations, messages } from '../db/schema.js';
import { CONVERSATION_FIELDS, type AttachmentInput, type ConversationInput, type ConversationPatch, type ForkInput, type MessageInput } from './validate.js';

// Conversations with their messages and attachments. Every function takes the owner's ID and
// never reads or writes another user's rows.

type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type AttachmentRow = typeof attachments.$inferSelect;

/** Drop absent optional fields, so records read back exactly as the web app wrote them. */
const defined = <T extends Record<string, unknown>>(record: T): T =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null && value !== undefined)) as T;

const messageOut = (row: MessageRow) => defined({
  id: row.id, role: row.role, content: row.content, createdAt: row.createdAt,
  metadata: row.metadata, provenance: row.provenance, runId: row.runId, runStatus: row.runStatus,
  finishReason: row.finishReason, feedback: row.feedback,
});

const attachmentFields = (includeOriginals: boolean) => ({
  ...getTableColumns(attachments),
  pdfBase64: includeOriginals ? attachments.pdfBase64 : sql<string | null>`NULL`,
  hasPdf: sql<boolean>`${attachments.pdfBase64} IS NOT NULL`,
});
const attachmentOut = (row: AttachmentRow & { hasPdf?: boolean }) => defined({
  id: row.id, name: row.name, mimeType: row.mimeType, size: row.size, content: row.content, kind: row.kind, createdAt: row.createdAt,
  hasPdf: row.hasPdf || !!row.pdfBase64 || undefined,
  pdfBase64: row.pdfBase64 ?? undefined,
});

function conversationOut(row: ConversationRow, rows: MessageRow[], files: AttachmentRow[]) {
  return {
    ...(row.extra as object | null ?? {}),
    ...defined({
      id: row.id, title: row.title, provider: row.provider, model: row.model, connectionId: row.connectionId,
      allowCharges: row.allowCharges || undefined, settings: row.settings, workbench: row.workbench, branchOf: row.branchOf,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    }),
    messages: rows.map(messageOut),
    ...(files.length ? { attachments: files.map(attachmentOut) } : {}),
  };
}
export type StoredConversation = ReturnType<typeof conversationOut>;

const messageRow = (userId: string, conversationId: string, message: MessageInput, position: number) => ({
  userId, conversationId, position, id: message.id, role: message.role, content: message.content, createdAt: message.createdAt,
  metadata: message.metadata ?? null, provenance: message.provenance ?? null, runId: message.runId ?? null,
  runStatus: message.runStatus ?? null, finishReason: message.finishReason ?? null, feedback: message.feedback ?? null,
});

const attachmentRow = (userId: string, conversationId: string, file: AttachmentInput, position: number) => ({
  userId, conversationId, position, id: file.id, name: file.name, mimeType: file.mimeType, size: file.size,
  content: file.content, kind: file.kind, createdAt: file.createdAt, pdfBase64: file.pdfBase64 ?? null,
});

export async function getPdfSource(db: Database, userId: string, conversationId: string, attachmentId: string) {
  const [row] = await db.select({ pdfBase64: attachments.pdfBase64 }).from(attachments).where(and(
    eq(attachments.userId, userId), eq(attachments.conversationId, conversationId), eq(attachments.id, attachmentId),
  ));
  return row?.pdfBase64 ?? null;
}

export async function restorePdfSource(db: Database, userId: string, conversationId: string, attachmentId: string, pdfBase64: string) {
  const rows = await db.update(attachments).set({ pdfBase64 }).where(and(
    eq(attachments.userId, userId), eq(attachments.conversationId, conversationId), eq(attachments.id, attachmentId), eq(attachments.kind, 'text'),
  )).returning({ id: attachments.id });
  return rows.length > 0;
}

function extraOf(input: ConversationInput) {
  const known = new Set<string>(CONVERSATION_FIELDS);
  const extra = Object.fromEntries(Object.entries(input).filter(([key]) => !known.has(key)));
  return Object.keys(extra).length ? extra : null;
}

export async function listConversations(db: Database, userId: string, includeOriginals = false): Promise<StoredConversation[]> {
  const [rows, messageRows, attachmentRows] = await Promise.all([
    db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt)),
    db.select().from(messages).where(eq(messages.userId, userId)).orderBy(asc(messages.position), asc(messages.createdAt)),
    db.select(attachmentFields(includeOriginals)).from(attachments).where(eq(attachments.userId, userId)).orderBy(asc(attachments.position)),
  ]);
  const byThread = <T extends { conversationId: string }>(items: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of items) map.set(item.conversationId, [...(map.get(item.conversationId) ?? []), item]);
    return map;
  };
  const threadMessages = byThread(messageRows);
  const threadFiles = byThread(attachmentRows);
  return rows.map(row => conversationOut(row, threadMessages.get(row.id) ?? [], threadFiles.get(row.id) ?? []));
}

export async function getConversation(db: Database, userId: string, id: string, includeOriginals = false): Promise<StoredConversation | null> {
  const [row] = await db.select().from(conversations).where(and(eq(conversations.userId, userId), eq(conversations.id, id)));
  if (!row) return null;
  const [messageRows, attachmentRows] = await Promise.all([
    db.select().from(messages).where(and(eq(messages.userId, userId), eq(messages.conversationId, id))).orderBy(asc(messages.position), asc(messages.createdAt)),
    db.select(attachmentFields(includeOriginals)).from(attachments).where(and(eq(attachments.userId, userId), eq(attachments.conversationId, id))).orderBy(asc(attachments.position)),
  ]);
  return conversationOut(row, messageRows, attachmentRows);
}

/** Create a conversation with its messages. Returns false when this user already has one with this ID. */
export async function createConversation(db: Database, userId: string, input: ConversationInput): Promise<boolean> {
  return db.transaction(async tx => {
    const inserted = await tx.insert(conversations).values({
      userId, id: input.id, title: input.title, provider: input.provider, model: input.model,
      connectionId: input.connectionId ?? null, allowCharges: input.allowCharges ?? false,
      settings: input.settings, workbench: input.workbench ?? null, branchOf: input.branchOf ?? null, extra: extraOf(input),
      createdAt: input.createdAt, updatedAt: input.updatedAt,
    }).onConflictDoNothing().returning({ id: conversations.id });
    if (!inserted.length) return false;
    // Branches and imports may repeat a message ID within a thread; the first copy wins.
    for (let start = 0; start < input.messages.length; start += 500) {
      const batch = input.messages.slice(start, start + 500).map((m, i) => messageRow(userId, input.id, m, start + i));
      await tx.insert(messages).values(batch).onConflictDoNothing();
    }
    const files = input.attachments ?? [];
    if (files.length) await tx.insert(attachments).values(files.map((f, i) => attachmentRow(userId, input.id, f, i))).onConflictDoNothing();
    return true;
  });
}

export async function updateConversation(db: Database, userId: string, id: string, patch: ConversationPatch): Promise<boolean> {
  const values = defined({
    title: patch.title, provider: patch.provider, model: patch.model, allowCharges: patch.allowCharges,
    settings: patch.settings, workbench: patch.workbench, updatedAt: patch.updatedAt ?? Date.now(),
  }) as Partial<typeof conversations.$inferInsert>;
  if (patch.connectionId !== undefined) values.connectionId = patch.connectionId;
  const updated = await db.update(conversations).set(values)
    .where(and(eq(conversations.userId, userId), eq(conversations.id, id))).returning({ id: conversations.id });
  return updated.length > 0;
}

/** Turning global Free only back on revokes every per-thread spending exception. */
export async function clearChargePermissions(db: Database, userId: string): Promise<void> {
  await db.update(conversations).set({ allowCharges: false }).where(eq(conversations.userId, userId));
}

export async function deleteConversation(db: Database, userId: string, id: string): Promise<boolean> {
  const deleted = await db.delete(conversations).where(and(eq(conversations.userId, userId), eq(conversations.id, id))).returning({ id: conversations.id });
  return deleted.length > 0;
}

/**
 * Add a message at the end of a thread. Repeating the same message ID changes nothing, so a
 * retried request cannot duplicate it. Returns false when the thread does not exist.
 */
export async function appendMessage(db: Database, userId: string, conversationId: string, message: MessageInput, change: { title?: string; updatedAt?: number } = {}): Promise<boolean> {
  return db.transaction(async tx => {
    const touched = await tx.update(conversations)
      .set(defined({ title: change.title, updatedAt: change.updatedAt ?? message.createdAt }))
      .where(and(eq(conversations.userId, userId), eq(conversations.id, conversationId))).returning({ id: conversations.id });
    if (!touched.length) return false;
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${messages.position}) + 1, 0)`.mapWith(Number) })
      .from(messages).where(and(eq(messages.userId, userId), eq(messages.conversationId, conversationId)));
    await tx.insert(messages).values(messageRow(userId, conversationId, message, next)).onConflictDoNothing();
    return true;
  });
}

export async function setMessageFeedback(db: Database, userId: string, conversationId: string, messageId: string, feedback: string | null): Promise<boolean> {
  const updated = await db.update(messages).set({ feedback })
    .where(and(eq(messages.userId, userId), eq(messages.conversationId, conversationId), eq(messages.id, messageId))).returning({ id: messages.id });
  if (updated.length) await touch(db, userId, conversationId);
  return updated.length > 0;
}

export async function addAttachment(db: Database, userId: string, conversationId: string, file: AttachmentInput): Promise<boolean> {
  return db.transaction(async tx => {
    if (!await touch(tx, userId, conversationId)) return false;
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${attachments.position}) + 1, 0)`.mapWith(Number) })
      .from(attachments).where(and(eq(attachments.userId, userId), eq(attachments.conversationId, conversationId)));
    await tx.insert(attachments).values(attachmentRow(userId, conversationId, file, next)).onConflictDoNothing();
    return true;
  });
}

export async function removeAttachment(db: Database, userId: string, conversationId: string, attachmentId: string): Promise<boolean> {
  const deleted = await db.delete(attachments)
    .where(and(eq(attachments.userId, userId), eq(attachments.conversationId, conversationId), eq(attachments.id, attachmentId))).returning({ id: attachments.id });
  if (deleted.length) await touch(db, userId, conversationId);
  return deleted.length > 0;
}

/**
 * Start a new thread from the messages before `beforeMessageId`, copying model, settings, and
 * attachments on the server so nothing is uploaded again. A branch never inherits permission
 * to use paid models.
 */
export async function forkConversation(db: Database, userId: string, sourceId: string, input: ForkInput): Promise<StoredConversation | 'missing-source' | 'missing-message' | 'exists'> {
  const result = await db.transaction(async tx => {
    const [source] = await tx.select().from(conversations).where(and(eq(conversations.userId, userId), eq(conversations.id, sourceId)));
    if (!source) return 'missing-source' as const;
    const [cut] = await tx.select({ position: messages.position }).from(messages)
      .where(and(eq(messages.userId, userId), eq(messages.conversationId, sourceId), eq(messages.id, input.beforeMessageId)));
    if (!cut) return 'missing-message' as const;
    const inserted = await tx.insert(conversations).values({
      userId, id: input.id, title: input.title, provider: source.provider, model: source.model, connectionId: source.connectionId,
      allowCharges: false, settings: source.settings, workbench: input.workbench ?? source.workbench,
      branchOf: { conversationId: sourceId, messageId: input.beforeMessageId }, extra: source.extra,
      createdAt: input.createdAt, updatedAt: input.createdAt,
    }).onConflictDoNothing().returning({ id: conversations.id });
    if (!inserted.length) return 'exists' as const;
    const copied = await tx.select().from(messages)
      .where(and(eq(messages.userId, userId), eq(messages.conversationId, sourceId), lt(messages.position, cut.position)));
    if (copied.length) await tx.insert(messages).values(copied.map(row => ({ ...row, conversationId: input.id })));
    const files = await tx.select().from(attachments).where(and(eq(attachments.userId, userId), eq(attachments.conversationId, sourceId)));
    if (files.length) await tx.insert(attachments).values(files.map(row => ({ ...row, conversationId: input.id })));
    return 'created' as const;
  });
  return result === 'created' ? (await getConversation(db, userId, input.id))! : result;
}

async function touch(db: Pick<Database, 'update'>, userId: string, conversationId: string) {
  const touched = await db.update(conversations).set({ updatedAt: Date.now() })
    .where(and(eq(conversations.userId, userId), eq(conversations.id, conversationId))).returning({ id: conversations.id });
  return touched.length > 0;
}
