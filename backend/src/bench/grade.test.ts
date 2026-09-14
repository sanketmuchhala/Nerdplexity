import { describe, expect, it } from 'vitest';
import { grade } from './grade.js';
import { IFEVAL_CHECKS, checkInstructions } from './ifeval.js';
import { loadSuite } from './suite.js';

const call = (name: string, args: object) => [{ id: 'c1', name, arguments: JSON.stringify(args) }];

describe('graders', () => {
  it('reads the number on the final Answer line, or the last number without one', () => {
    expect(grade({ kind: 'number', answer: 1234 }, 'Work: 1000 + 234\nAnswer: 1,234')).toEqual({ passed: true });
    expect(grade({ kind: 'number', answer: 18 }, 'She makes $18 every day.')).toEqual({ passed: true });
    expect(grade({ kind: 'number', answer: 18 }, 'Answer: 17')).toEqual({ passed: false, detail: 'expected 18, got 17' });
    expect(grade({ kind: 'number', answer: 3 }, 'I am not sure.').passed).toBe(false);
  });

  it('compares returned Python values ignoring spacing and quote style', () => {
    expect(grade({ kind: 'literal', answer: '[(4, 1), (2, 3)]' }, 'Answer: [(4,1),(2,3)]').passed).toBe(true);
    expect(grade({ kind: 'literal', answer: "',saw'" }, 'Reversed.\nAnswer: `",saw"`').passed).toBe(true);
    expect(grade({ kind: 'literal', answer: "'b'" }, "Answer: f('a') == 'b'").passed).toBe(true);
    expect(grade({ kind: 'literal', answer: '3' }, 'It returns 3.')).toEqual({ passed: false, detail: 'no "Answer:" line' });
    expect(grade({ kind: 'literal', answer: '3' }, 'Answer: 4').passed).toBe(false);
  });

  it('accepts the answer span, or a short answer containing it, after SQuAD normalization', () => {
    const span = { kind: 'span' as const, answers: ['Denver Broncos'] };
    expect(grade(span, 'The Denver Broncos.').passed).toBe(true);
    expect(grade(span, 'It was the Denver Broncos who won.').passed).toBe(true);
    expect(grade(span, `${'Many teams played that season and '.repeat(4)}the Denver Broncos won.`).passed).toBe(false);
    expect(grade(span, 'Carolina Panthers')).toEqual({ passed: false, detail: 'expected "Denver Broncos"' });
  });

  it('checks one call to the right function with accepted values, as BFCL does', () => {
    const tool = { kind: 'tool-call' as const, name: 'calculate_area', args: { base: [6], height: [10], unit: ['cm', ''] } };
    expect(grade(tool, '', call('calculate_area', { base: 6, height: 10 })).passed).toBe(true);
    expect(grade(tool, '', call('calculate_area', { base: 6, height: 10, unit: 'CM' })).passed).toBe(true);
    expect(grade(tool, '', call('calculate_area', { base: 6, height: 11 }))).toEqual({ passed: false, detail: 'wrong value for height' });
    expect(grade(tool, '', call('calculate_area', { base: '6', height: 10 })).passed).toBe(false);
    expect(grade(tool, '', call('calculate_area', { base: 6 }))).toEqual({ passed: false, detail: 'missing height' });
    expect(grade(tool, '', call('calculate_area', { base: 6, height: 10, color: 'red' }))).toEqual({ passed: false, detail: 'unexpected argument color' });
    expect(grade(tool, '', call('area', { base: 6, height: 10 }))).toEqual({ passed: false, detail: 'called area, expected calculate_area' });
    expect(grade(tool, 'The area is 30.')).toEqual({ passed: false, detail: 'no tool call' });
    const city = { kind: 'tool-call' as const, name: 'weather', args: { city: ['San Francisco, CA'] } };
    expect(grade(city, '', call('weather', { city: 'san francisco CA' })).passed).toBe(true);
  });

  it('checks IFEval instructions strictly', () => {
    const ok = (id: string, response: string, args: object = {}) => checkInstructions(response, [{ id, args }]).passed;
    expect(ok('punctuation:no_comma', 'No commas here.')).toBe(true);
    expect(ok('punctuation:no_comma', 'One, two.')).toBe(false);
    expect(ok('change_case:english_lowercase', 'all lower case.')).toBe(true);
    expect(ok('change_case:english_lowercase', 'Not lower.')).toBe(false);
    expect(ok('detectable_format:json_format', '```json\n{"a": 1}\n```')).toBe(true);
    expect(ok('detectable_format:json_format', 'Here: {"a": 1}')).toBe(false);
    expect(ok('detectable_format:number_bullet_lists', '* one\n* two\n- three', { num_bullets: 3 })).toBe(true);
    expect(ok('detectable_format:number_bullet_lists', '* one\n* two', { num_bullets: 3 })).toBe(false);
    expect(ok('detectable_format:title', '<<A Title>>\nText')).toBe(true);
    expect(ok('startend:end_checker', 'Thanks. Is there anything else I can help with?', { end_phrase: 'Is there anything else I can help with?' })).toBe(true);
    expect(ok('length_constraints:number_paragraphs', 'First.\n***\nSecond.', { num_paragraphs: 2 })).toBe(true);
    expect(ok('length_constraints:number_paragraphs', 'First.\n***\n\n***\nSecond.', { num_paragraphs: 2 })).toBe(false);
    expect(ok('length_constraints:number_words', 'one two three', { num_words: 5, relation: 'less than' })).toBe(true);
    expect(ok('length_constraints:number_words', 'one two three', { num_words: 5, relation: 'at least' })).toBe(false);
    expect(ok('detectable_content:postscript', 'Body.\nP.S. Remember this.', { postscript_marker: 'P.S.' })).toBe(true);
    expect(ok('keywords:existence', 'Bananas and Apples', { keywords: ['apples', 'bananas'] })).toBe(true);
    expect(ok('keywords:forbidden_words', 'A calm answer.', { forbidden_words: ['angry'] })).toBe(true);
    expect(ok('keywords:frequency', 'data data data', { keyword: 'data', frequency: 3, relation: 'at least' })).toBe(true);
    expect(ok('change_case:capital_word_frequency', 'ALL CAPS here and NASA', { capital_frequency: 3, capital_relation: 'at least' })).toBe(true);
    expect(checkInstructions('x', [{ id: 'language:response_language', args: {} }])).toEqual({ passed: false, failed: ['language:response_language'] });
  });
});

describe('suite', () => {
  const suite = loadSuite();

  it('has 20 items per category, each with its source and license', () => {
    for (const category of ['code', 'math', 'instructions', 'tools', 'facts']) expect(suite.filter(item => item.category === category)).toHaveLength(20);
    expect(new Set(suite.map(item => item.id)).size).toBe(suite.length);
    for (const item of suite) expect(item.source).toMatchObject({ dataset: expect.any(String), license: expect.stringMatching(/^(MIT|Apache-2.0|CC-BY-SA-4.0)$/) });
  });

  it('uses only instruction checks Bench implements, and tool names providers accept', () => {
    for (const item of suite) {
      if (item.grade.kind === 'ifeval') for (const check of item.grade.checks) expect(IFEVAL_CHECKS).toHaveProperty([check.id]);
      if (item.grade.kind === 'tool-call') {
        expect(item.tools?.map(tool => tool.name)).toContain(item.grade.name);
        for (const tool of item.tools!) {
          expect(tool.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
          expect(JSON.stringify(tool.parameters)).not.toMatch(/"type":"(dict|float|tuple)"/);
        }
      }
    }
  });
});
