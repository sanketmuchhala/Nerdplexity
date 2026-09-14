// Contracts for the stored-data API (/v1/conversations, /v1/documents, ...). Type-only.
// Record shapes (Conversation, RunRecord, ...) are defined by the web app; the server validates
// the fields it indexes and stores the rest as written.

/** Kinds of records the server keeps for each user. */
export type DataKind = 'conversations' | 'documents' | 'runs' | 'connections' | 'presets' | 'comparisons';

export type DataCounts = Record<DataKind, number>;

/** GET /v1/store/status */
export interface StoreStatus {
  /** Whether this user's browser data has been imported (or the import was declined). */
  imported: boolean;
  counts: DataCounts;
}

/** POST /v1/import: records from a browser's IndexedDB. Records whose ID already exists are skipped. */
export interface ImportRequest {
  conversations?: unknown[];
  documents?: unknown[];
  runs?: unknown[];
  connections?: unknown[];
  presets?: unknown[];
  comparisons?: unknown[];
  /** Imported only when the user has no settings yet. API keys are removed. */
  settings?: Record<string, unknown>;
  /** Mark the import finished. Large imports send several batches and finish with the last. */
  done?: boolean;
}

export interface ImportResult {
  imported: DataCounts;
  skipped: DataCounts;
}

/** POST /v1/run-records/:id/finish: whether this call recorded the outcome (it was still running). */
export interface FinishResult {
  claimed: boolean;
}

/** The signed-in account, from GET /v1/account. */
export interface AccountInfo {
  id: string;
  email: string;
  name: string;
  /** The built-in owner of a server running on the user's own computer, without sign-in. */
  local: boolean;
}
