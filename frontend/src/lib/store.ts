import type { AccountInfo, Connection, FinishResult, ImportRequest, ImportResult, StoreStatus } from '@app/types';
import { api } from './api';
import type { AppSettings, ComparisonRecord, Conversation, Message, RunRecord, ThreadAttachment, WorkspaceDocument } from './db';
import type { Preset, WorkbenchSettings } from './workbench';

// Saved data lives on the Nerdplexity server: PGlite on this computer, or Postgres when hosted.
// One function per change the app makes, so adding a message sends only that message.
// API keys are never sent here; they stay in this browser (see credentials.ts).

const id = (value: string) => encodeURIComponent(value);

export type ConversationPatch = Partial<Pick<Conversation, 'title' | 'provider' | 'model' | 'allowCharges' | 'settings' | 'workbench' | 'updatedAt'>> & { connectionId?: string | null };

export const conversations = {
  list: () => api<Conversation[]>('/v1/conversations'),
  create: (conversation: Conversation) => api<Conversation>('/v1/conversations', { body: conversation }),
  update: (conversationId: string, patch: ConversationPatch) => api(`/v1/conversations/${id(conversationId)}`, { method: 'PATCH', body: patch }),
  remove: (conversationId: string) => api(`/v1/conversations/${id(conversationId)}`, { method: 'DELETE' }),
  appendMessage: (conversationId: string, message: Message, change: { title?: string; updatedAt: number }) =>
    api(`/v1/conversations/${id(conversationId)}/messages`, { body: { message, ...change } }),
  setFeedback: (conversationId: string, messageId: string, feedback?: Message['feedback']) =>
    api(`/v1/conversations/${id(conversationId)}/messages/${id(messageId)}`, { method: 'PATCH', body: { feedback: feedback ?? null } }),
  /** A new thread from the messages before `beforeMessageId`, copied on the server. */
  fork: (conversationId: string, input: { id: string; beforeMessageId: string; title: string; workbench?: WorkbenchSettings; createdAt: number }) =>
    api<Conversation>(`/v1/conversations/${id(conversationId)}/fork`, { body: input }),
  addAttachment: (conversationId: string, attachment: ThreadAttachment) => api(`/v1/conversations/${id(conversationId)}/attachments`, { body: attachment }),
  removeAttachment: (conversationId: string, attachmentId: string) => api(`/v1/conversations/${id(conversationId)}/attachments/${id(attachmentId)}`, { method: 'DELETE' }),
};

export const documents = {
  list: () => api<WorkspaceDocument[]>('/v1/documents'),
  put: (doc: WorkspaceDocument) => api(`/v1/documents/${id(doc.id)}`, { method: 'PUT', body: doc }),
  remove: (docId: string) => api(`/v1/documents/${id(docId)}`, { method: 'DELETE' }),
};

/** Run history. The run engine itself is runClient.ts. */
export const runs = {
  list: (options: { status?: string; limit?: number } = {}) =>
    api<RunRecord[]>(`/v1/run-records?${new URLSearchParams({ ...(options.status ? { status: options.status } : {}), limit: String(options.limit ?? 100) })}`),
  put: (record: RunRecord) => api(`/v1/run-records/${id(record.id)}`, { method: 'PUT', body: record }),
  /** Progress while streaming. Cannot change the status; finish does. */
  patch: (recordId: string, patch: Partial<RunRecord>) => api(`/v1/run-records/${id(recordId)}`, { method: 'PATCH', body: patch }),
  /** Save the outcome if the run is still marked running. Exactly one of several tabs claims it. */
  finish: (record: RunRecord) => api<FinishResult>(`/v1/run-records/${id(record.id)}/finish`, { body: record }),
};

export const connections = {
  list: () => api<Connection[]>('/v1/connections'),
  put: (connection: Connection) => api(`/v1/connections/${id(connection.id)}`, { method: 'PUT', body: connection }),
  patch: (connectionId: string, patch: Partial<Connection>) => api(`/v1/connections/${id(connectionId)}`, { method: 'PATCH', body: patch }),
  remove: (connectionId: string) => api(`/v1/connections/${id(connectionId)}`, { method: 'DELETE' }),
};

export const presets = {
  list: () => api<Preset[]>('/v1/presets'),
  put: (preset: Preset) => api(`/v1/presets/${id(preset.id)}`, { method: 'PUT', body: preset }),
  remove: (presetId: string) => api(`/v1/presets/${id(presetId)}`, { method: 'DELETE' }),
};

export const comparisons = {
  list: () => api<ComparisonRecord[]>('/v1/comparisons'),
  put: (record: ComparisonRecord) => api(`/v1/comparisons/${id(record.id)}`, { method: 'PUT', body: record }),
  remove: (recordId: string) => api(`/v1/comparisons/${id(recordId)}`, { method: 'DELETE' }),
};

export const settings = {
  get: () => api<AppSettings | null>('/v1/settings'),
  /** Merge fields into the saved settings; returns the result. */
  patch: (partial: Partial<AppSettings>) => api<AppSettings>('/v1/settings', { method: 'PATCH', body: partial }),
};

export const account = () => api<AccountInfo>('/v1/account');
export const status = () => api<StoreStatus>('/v1/store/status');
export const importData = (data: ImportRequest) => api<ImportResult>('/v1/import', { body: data });
