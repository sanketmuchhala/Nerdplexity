import { describe, expect, it } from 'vitest';
import type { ToolName } from '@app/types';
import { calculate, executeTool, MAX_TOOL_OUTPUT_CHARS, type ToolDefinition } from './tools.js';

const context = (enabled: ToolName[] = ['calculator'], signal = new AbortController().signal) => ({
  enabled: new Set(enabled), signal,
  documents: [{ id: 'd1', title: 'Launch notes', content: 'Decision: ship on Friday. Owner: Priya.' }],
});
const custom = (run: ToolDefinition['run']) => new Map([['calculator', { name: 'calculator' as const, description: '', parameters: {}, source: 'computed' as const, run }]]);

describe('calculator', () => {
  it.each([
    ['2+3*4', 14], ['(2+3)*4', 20], ['-2^2', -4], ['2^3^2', 512], ['2**10', 1024], ['2^-1', 0.5],
    ['sqrt(16) + abs(-3)', 7], ['max(1, 5, 3)', 5], ['1.5e3 / 3', 500], ['10 % 3', 1], ['log(1000)', 3], ['ln(e)', 1], [' 7 ', 7],
  ])('%s = %s', (expression, expected) => expect(calculate(expression)).toBeCloseTo(expected, 12));

  it.each([
    ['1/0', 'finite'], ['foo(2)', 'Unknown name'], ['constructor', 'Unknown name'], ['2+', 'ended early'],
    ['2 3', 'Unexpected'], ['(2', 'Expected “)”'], ['process.exit()', 'Unexpected'], ['', 'Provide'],
  ])('rejects %j', (expression, message) => expect(() => calculate(expression)).toThrow(message));
});

describe('executeTool', () => {
  it('runs an enabled tool with validated arguments and labels its source', async () => {
    const outcome = await executeTool('calculator', '{"expression":"0.1+0.2"}', context());
    expect(outcome).toMatchObject({ status: 'completed', input: { expression: '0.1+0.2' }, output: { expression: '0.1+0.2', result: 0.3 }, source: 'computed' });
    const search = await executeTool('search_documents', '{"query":"owner"}', context(['search_documents']));
    expect(search).toMatchObject({ status: 'completed', source: 'retrieved', output: [{ id: 'd1', title: 'Launch notes' }] });
  });

  it('returns correctable problems to the model instead of throwing', async () => {
    expect(await executeTool('shell', '{}', context())).toMatchObject({ status: 'error', error: expect.stringContaining('no tool named') });
    expect(await executeTool('search_documents', '{"query":"x"}', context(['calculator']))).toMatchObject({ status: 'denied' });
    expect(await executeTool('calculator', '{"expression":', context())).toMatchObject({ status: 'error', input: '{"expression":', error: expect.stringContaining('not valid JSON') });
    expect(await executeTool('calculator', '[1]', context())).toMatchObject({ status: 'error', error: expect.stringContaining('JSON object') });
    expect(await executeTool('calculator', '{"expression":"1/0"}', context())).toMatchObject({ status: 'error', error: expect.stringContaining('finite') });
    expect(await executeTool('read_document', '{"id":"elsewhere"}', context(['read_document']))).toMatchObject({ status: 'error', error: expect.stringContaining('not part of') });
  });

  it('times out slow tools and bounds large output', async () => {
    const slow = await executeTool('calculator', '{}', context(), { timeoutMs: 20, registry: custom(() => new Promise(() => undefined)) });
    expect(slow).toMatchObject({ status: 'error', error: expect.stringContaining('did not finish') });
    const large = await executeTool('calculator', '{}', context(), { registry: custom(() => 'x'.repeat(MAX_TOOL_OUTPUT_CHARS * 2)) });
    expect(large.output).toMatchObject({ truncated: true });
    expect((large.output as { partial: string }).partial).toHaveLength(MAX_TOOL_OUTPUT_CHARS);
  });

  it('throws on cancellation so the run stops', async () => {
    const controller = new AbortController();
    const pending = executeTool('calculator', '{}', context(['calculator'], controller.signal), { registry: custom(() => new Promise(() => undefined)) });
    controller.abort(new Error('canceled'));
    await expect(pending).rejects.toThrow('canceled');
  });
});
