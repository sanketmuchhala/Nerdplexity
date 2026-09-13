import { describe, expect, it } from 'vitest';
import type { RunRecord } from './db';
import { exportRuns, measurementFor } from './runMetrics';

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'record-1', conversationId: 'thread-1', connectionId: 'openrouter', provider: 'OpenRouter', model: 'model-a', prompt: 'Hello',
  startedAt: Date.UTC(2026, 8, 10), durationMs: 2200, queuedMs: 200, ttftMs: 500, status: 'completed', mode: 'chat', output: 'Hi', tools: [], runId: 'run-1',
  usage: { prompt_tokens: 1000, completion_tokens: 300, total_tokens: 1300 },
  input: { messages: [], documents: [], attachments: [], settings: {}, configured: { systemPrompt: '', temperature: 0.7, temperatureMode: 'default', maxTokens: 2048, contextBudget: 4096, history: 'all', recentTurns: 8, tools: [] }, context: { estimatedTokens: 900, budget: 4000, omittedMessages: 0, limitKnown: true } },
  pricing: { execution: 'remote', classification: 'paid', inputPerMillion: 2, outputPerMillion: 10, catalogCheckedAt: 1 },
  ...over,
});

describe('run metrics', () => {
  it('shows only valid per-run measurements and catalog-snapshot cost', () => {
    expect(measurementFor(run())).toMatchObject({ providerMs: 2000, generationMs: 1500, tokensPerSecond: 200, contextUtilization: 0.25, estimatedCostUsd: 0.005, costProvenance: 'catalog-snapshot' });
    const agent = measurementFor(run({ mode: 'agent', tools: [{ id: 'tool-1', step: 1, name: 'calculator', status: 'completed', input: {}, output: 2 }] }));
    expect(agent.tokensPerSecond).toBeUndefined();
    expect(agent.contextUtilization).toBeUndefined();
    expect(measurementFor(run({ ttftMs: undefined, pricing: undefined })).estimatedCostUsd).toBeUndefined();
  });

  it('exports useful records without server recovery identifiers', () => {
    const exported = exportRuns([run({ idempotencyKey: 'secret-start-key', lastSeq: 8 })]);
    expect(exported).not.toContain('secret-start-key');
    expect(exported).not.toContain('run-1');
    expect(JSON.parse(exported)).toMatchObject({ format: 'nerdplexity-runs', version: 1, runs: [{ id: 'record-1', model: 'model-a' }] });
  });
});
