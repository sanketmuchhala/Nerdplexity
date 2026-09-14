import type { ToolCall } from '../runtime/adapters.js';
import { checkInstructions } from './ifeval.js';
import type { Grader } from './suite.js';

export interface Grade {
  passed: boolean;
  /** Why it failed, safe to show. */
  detail?: string;
}

/** Text after the last "Answer:" marker, or undefined. */
function finalAnswer(text: string): string | undefined {
  const matches = [...text.matchAll(/answer\s*[:：]\s*(.+)/gi)];
  return matches.length ? matches[matches.length - 1][1].trim() : undefined;
}

const stripFormatting = (text: string) => text.replace(/^[`*\s]+|[`*\s.]+$/g, '');

function gradeNumber(text: string, expected: number): Grade {
  const marked = finalAnswer(text);
  const numbers = (marked ?? text).replace(/(\d),(\d)/g, '$1$2').match(/-?\d+(?:\.\d+)?/g);
  // Without the marker, the last number in the reply is taken.
  const value = numbers ? Number(marked ? numbers[0] : numbers[numbers.length - 1]) : NaN;
  return Math.abs(value - expected) < 1e-6 ? { passed: true } : { passed: false, detail: `expected ${expected}, got ${Number.isNaN(value) ? 'no number' : value}` };
}

/** Compare Python literals ignoring whitespace and quote style. */
const literal = (text: string) => text.replace(/\s+/g, '').replace(/"/g, "'");

function gradeLiteral(text: string, expected: string): Grade {
  const marked = finalAnswer(text);
  if (marked === undefined) return { passed: false, detail: 'no "Answer:" line' };
  // Accept "f(...) == value" as well as the bare value.
  const value = stripFormatting(marked).replace(/^f\(.*\)\s*==\s*/, '');
  return literal(value) === literal(expected) ? { passed: true } : { passed: false, detail: `expected ${expected}, got ${value.slice(0, 80)}` };
}

/** SQuAD's normalization: lowercase, no punctuation, no articles, single spaces. */
const squadNormal = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\b(a|an|the)\b/g, ' ').replace(/\s+/g, ' ').trim();

function gradeSpan(text: string, answers: string[]): Grade {
  const reply = squadNormal(text);
  const golds = answers.map(squadNormal);
  if (golds.includes(reply)) return { passed: true };
  // A short sentence that contains the span also counts; a long one does not.
  const short = reply.split(' ').length <= Math.max(12, 3 * Math.max(...golds.map(g => g.split(' ').length)));
  return short && golds.some(gold => gold && reply.includes(gold)) ? { passed: true } : { passed: false, detail: `expected "${answers[0]}"` };
}

/** BFCL's string standardization: no spaces or common punctuation, lowercase, one quote style. */
const standard = (value: string) => value.replace(/[ ,./\-_*^]/g, '').toLowerCase().replace(/'/g, '"');

function sameValue(actual: unknown, expected: unknown): boolean {
  // As in BFCL, a number must be a number (an integer is accepted where a float is expected).
  if (typeof expected === 'number' || typeof actual === 'number') return typeof actual === 'number' && actual === expected;
  if (typeof expected === 'string' && typeof actual === 'string') return standard(actual) === standard(expected);
  if (Array.isArray(expected) && Array.isArray(actual)) return expected.length === actual.length && expected.every((item, i) => sameValue(actual[i], item));
  if (expected && typeof expected === 'object' && actual && typeof actual === 'object') {
    // Nested objects list accepted values per key, like the top-level arguments.
    return Object.entries(expected as Record<string, unknown[]>).every(([key, accepted]) =>
      Array.isArray(accepted) ? accepted.some(option => option === '' ? !(key in actual) : sameValue((actual as Record<string, unknown>)[key], option)) : sameValue((actual as Record<string, unknown>)[key], accepted));
  }
  return actual === expected;
}

function gradeToolCall(calls: ToolCall[] | undefined, name: string, args: Record<string, unknown[]>): Grade {
  if (!calls?.length) return { passed: false, detail: 'no tool call' };
  const call = calls[0];
  if (call.name !== name) return { passed: false, detail: `called ${call.name}, expected ${name}` };
  let given: Record<string, unknown>;
  try { given = JSON.parse(call.arguments || '{}'); } catch { return { passed: false, detail: 'arguments were not valid JSON' }; }
  const unknown = Object.keys(given).filter(key => !(key in args));
  if (unknown.length) return { passed: false, detail: `unexpected argument ${unknown[0]}` };
  for (const [key, accepted] of Object.entries(args)) {
    const ok = key in given ? accepted.some(option => option !== '' && sameValue(given[key], option)) : accepted.includes('');
    if (!ok) return { passed: false, detail: key in given ? `wrong value for ${key}` : `missing ${key}` };
  }
  return { passed: true };
}

export function grade(grader: Grader, text: string, toolCalls?: ToolCall[]): Grade {
  switch (grader.kind) {
    case 'number': return gradeNumber(text, grader.answer);
    case 'literal': return gradeLiteral(text, grader.answer);
    case 'span': return gradeSpan(text, grader.answers);
    case 'tool-call': return gradeToolCall(toolCalls, grader.name, grader.args);
    case 'ifeval': {
      const { passed, failed } = checkInstructions(text, grader.checks);
      return passed ? { passed } : { passed, detail: `did not follow ${failed.join(', ')}` };
    }
  }
}
