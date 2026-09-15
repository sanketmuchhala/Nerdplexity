import { bigint, boolean, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

// Accounts (Better Auth). Property names are the ones Better Auth expects; columns are snake_case.

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, t => [index('session_user_idx').on(t.userId)]);

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('account_user_idx').on(t.userId)]);

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('verification_identifier_idx').on(t.identifier)]);

// App data. Every row belongs to one user, and every primary key starts with user_id, so IDs
// chosen by one user's browser can never collide with or reach another user's rows.
// Times are milliseconds since the epoch, as the web app records them.

const ms = (name: string) => bigint(name, { mode: 'number' });
const owner = () => text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' });

export const conversations = pgTable('conversations', {
  userId: owner(),
  id: text('id').notNull(),
  title: text('title').notNull(),
  /** Legacy provider label; routing uses connection_id. */
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  connectionId: text('connection_id'),
  allowCharges: boolean('allow_charges').notNull().default(false),
  /** Generation settings: temperature, max_tokens, web_enabled. */
  settings: jsonb('settings').notNull(),
  workbench: jsonb('workbench'),
  branchOf: jsonb('branch_of'),
  /** Remaining fields of older records (runtime, meta), kept as they were. */
  extra: jsonb('extra'),
  createdAt: ms('created_at').notNull(),
  updatedAt: ms('updated_at').notNull(),
}, t => [
  primaryKey({ columns: [t.userId, t.id] }),
  index('conversations_updated_idx').on(t.userId, t.updatedAt),
]);

export const messages = pgTable('messages', {
  userId: text('user_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  // Branches copy messages with their IDs, so a message ID is unique only within its thread.
  id: text('id').notNull(),
  position: integer('position').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: ms('created_at').notNull(),
  metadata: jsonb('metadata'),
  provenance: jsonb('provenance'),
  runId: text('run_id'),
  runStatus: text('run_status'),
  finishReason: text('finish_reason'),
  feedback: text('feedback'),
}, t => [
  primaryKey({ columns: [t.userId, t.conversationId, t.id] }),
  foreignKey({ columns: [t.userId, t.conversationId], foreignColumns: [conversations.userId, conversations.id] }).onDelete('cascade'),
  index('messages_order_idx').on(t.userId, t.conversationId, t.position),
]);

export const attachments = pgTable('attachments', {
  userId: text('user_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  id: text('id').notNull(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  /** Text, or base64 image data. */
  content: text('content').notNull(),
  /** Base64 encoded original binary file data. */
  fileData: text('file_data'),
  kind: text('kind').notNull(),
  createdAt: ms('created_at').notNull(),
}, t => [
  primaryKey({ columns: [t.userId, t.conversationId, t.id] }),
  foreignKey({ columns: [t.userId, t.conversationId], foreignColumns: [conversations.userId, conversations.id] }).onDelete('cascade'),
]);

export const documents = pgTable('documents', {
  userId: owner(),
  id: text('id').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  updatedAt: ms('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.userId, t.id] })]);

/** Run history. The whole record is kept as written; the columns are for listing and recovery. */
export const runs = pgTable('runs', {
  userId: owner(),
  id: text('id').notNull(),
  conversationId: text('conversation_id').notNull(),
  status: text('status').notNull(),
  startedAt: ms('started_at').notNull(),
  record: jsonb('record').notNull(),
}, t => [
  primaryKey({ columns: [t.userId, t.id] }),
  index('runs_started_idx').on(t.userId, t.startedAt),
  index('runs_status_idx').on(t.userId, t.status),
]);

/** Model connections. API keys are never stored here; they stay in the user's browser. */
export const connections = pgTable('connections', {
  userId: owner(),
  id: text('id').notNull(),
  kind: text('kind').notNull(),
  record: jsonb('record').notNull(),
  createdAt: ms('created_at').notNull(),
}, t => [primaryKey({ columns: [t.userId, t.id] })]);

export const presets = pgTable('presets', {
  userId: owner(),
  id: text('id').notNull(),
  name: text('name').notNull(),
  record: jsonb('record').notNull(),
}, t => [primaryKey({ columns: [t.userId, t.id] })]);

export const comparisons = pgTable('comparisons', {
  userId: owner(),
  id: text('id').notNull(),
  createdAt: ms('created_at').notNull(),
  record: jsonb('record').notNull(),
}, t => [
  primaryKey({ columns: [t.userId, t.id] }),
  index('comparisons_created_idx').on(t.userId, t.createdAt),
]);

/** One row per user: app settings (never API keys) and when browser data was imported. */
export const settings = pgTable('settings', {
  userId: owner().primaryKey(),
  value: jsonb('value'),
  importedAt: ms('imported_at'),
  updatedAt: ms('updated_at').notNull(),
});

/**
 * Bench: one graded answer per row. The Free Router ranks each user's models with their own results.
 * Rows record the connection ID and model, never a key.
 */
export const benchResults = pgTable('bench_results', {
  userId: owner(),
  id: text('id').notNull(),
  connectionId: text('connection_id').notNull(),
  model: text('model').notNull(),
  itemId: text('item_id').notNull(),
  category: text('category').notNull(),
  status: text('status').notNull(),
  detail: text('detail'),
  latencyMs: integer('latency_ms'),
  ttftMs: integer('ttft_ms'),
  at: ms('at').notNull(),
}, t => [
  primaryKey({ columns: [t.userId, t.id] }),
  index('bench_results_model_idx').on(t.userId, t.connectionId, t.model),
  index('bench_results_at_idx').on(t.userId, t.at),
]);

export const authSchema = { user, session, account, verification };
