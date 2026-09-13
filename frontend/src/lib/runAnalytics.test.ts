import { describe, expect, it } from 'vitest';
import type { Conversation, RunRecord } from './db';
import { deriveRunAnalytics, exportRuns, measurementFor, percentile } from './runAnalytics';

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'record-1', conversationId: 'thread-1', connectionId: 'openrouter', provider: 'OpenRouter', model: 'model-a', prompt: 'Hello',
  startedAt: Date.UTC(2026, 8, 10), durationMs: 2200, queuedMs: 200, ttftMs: 500, status: 'completed', mode: 'chat', output: 'Hi', tools: [], runId: 'run-1',
  usage: { prompt_tokens: 1000, completion_tokens: 300, total_tokens: 1300 },
  input: { messages: [], documents: [], attachments: [], settings: {}, configured: { systemPrompt: '', temperature: 0.7, temperatureMode: 'default', maxTokens: 2048, contextBudget: 4096, history: 'all', recentTurns: 8, tools: [] }, context: { estimatedTokens: 900, budget: 4000, omittedMessages: 0, limitKnown: true } },
  pricing: { execution: 'remote', classification: 'paid', inputPerMillion: 2, outputPerMillion: 10, catalogCheckedAt: 1 },
  ...over,
});

const conversation = (feedback?: 'helpful' | 'unhelpful'): Conversation => ({
  id: 'thread-1', title: 'Thread', provider: 'openai', model: 'model-a', createdAt: 1, updatedAt: 1, settings: { temperature: 0.7 },
  messages: [{ id: 'answer', role: 'assistant', content: 'Hi', createdAt: 1, runId: 'run-1', ...(feedback ? { feedback } : {}) }],
});

describe('run analytics', () => {
  it('uses null-safe nearest-rank percentiles', () => {
    expect(percentile([], 50)).toBeUndefined();
    expect(percentile([30, 10, 20, 40], 50)).toBe(20);
    expect(percentile([30, 10, 20, 40], 95)).toBe(40);
  });

  it('derives only valid measured rates, context, and catalog-snapshot cost', () => {
    expect(measurementFor(run())).toMatchObject({ providerMs: 2000, generationMs: 1500, tokensPerSecond: 200, contextUtilization: 0.25, estimatedCostUsd: 0.005, costProvenance: 'catalog-snapshot' });
    const agent = measurementFor(run({ mode: 'agent', tools: [{ id: 'tool-1', step: 1, name: 'calculator', status: 'completed', input: {}, output: 2 }] }));
    expect(agent.tokensPerSecond).toBeUndefined();
    expect(agent.contextUtilization).toBeUndefined();
    expect(measurementFor(run({ ttftMs: undefined, pricing: undefined })).estimatedCostUsd).toBeUndefined();
  });

  it('keeps explicit feedback separate and reports metric coverage', () => {
    const result = deriveRunAnalytics([run(), run({ id: 'record-2', runId: 'run-2', status: 'failed', usage: undefined, durationMs: 1000, pricing: undefined })], [conversation('helpful')]);
    expect(result).toMatchObject({ total: 2, completed: 1, failed: 1, completionRate: 0.5, reportedTokens: 1300, usageCoverage: 0.5, costCoverage: 1, feedback: { helpful: 1, unhelpful: 0, unrated: 0 } });
  });

  it('does not let unfinished placeholder timings skew latency', () => {
    const result = deriveRunAnalytics([run({ durationMs: 2000 }), run({ id: 'running', runId: 'running', status: 'running', durationMs: 0, ttftMs: undefined })], []);
    expect(result.p50ProviderMs).toBe(1800);
  });

  it('exports useful records without recovery identifiers', () => {
    const exported = exportRuns([run({ idempotencyKey: 'secret-start-key', lastSeq: 8 })]);
    expect(exported).not.toContain('secret-start-key');
    expect(exported).not.toContain('run-1');
    expect(JSON.parse(exported)).toMatchObject({ format: 'nerdplexity-runs', version: 1, runs: [{ id: 'record-1', model: 'model-a' }] });
  });
});
