// Bench contracts shared by web and server. Type-only.
import type { RouteRequest } from './runs';

/** What Bench measures. Each category comes from one published, openly licensed dataset. */
export type BenchCategory = 'code' | 'math' | 'instructions' | 'tools' | 'facts';

export interface BenchStartRequest {
  /** Client-generated; repeating a start with the same key returns the same job. */
  idempotencyKey: string;
  /** Connections and the models to test on them; each key is sent once, as for a routed run. */
  connections: RouteRequest['connections'];
  models: { connectionId: string; model: string }[];
  categories: BenchCategory[];
  /** Items per category, 1-20. */
  perCategory: number;
}

export interface BenchStartResponse {
  runId: string;
  existing: boolean;
  /** Requests the job plans to send. */
  total: number;
}

export interface BenchResult {
  connectionId: string;
  model: string;
  itemId: string;
  category: BenchCategory;
  /** 'error': the request failed (unavailable, timeout), which says nothing about quality. */
  status: 'passed' | 'failed' | 'error';
  detail?: string;
  latencyMs?: number;
  ttftMs?: number;
  at: number;
}

/** Pass counts per model and category, from every saved result. */
export interface BenchScore {
  connectionId: string;
  model: string;
  category: BenchCategory;
  passed: number;
  failed: number;
  errors: number;
  /** Mean time for answered items. */
  latencyMs?: number;
  lastAt: number;
}

export interface BenchSuiteInfo {
  generatedAt: string;
  categories: { category: BenchCategory; count: number; dataset: string; license: string; url: string }[];
}

export interface BenchResults {
  scores: BenchScore[];
  recent: BenchResult[];
}
