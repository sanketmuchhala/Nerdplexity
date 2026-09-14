// Builds backend/bench/suite.json from published, openly licensed datasets:
//   pnpm --filter @app/server bench:sample
// Items are chosen at evenly spaced positions, so the same sources always give the same suite.
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import type { BenchItem } from '../bench/suite.js';
import { IFEVAL_CHECKS } from '../bench/ifeval.js';

const PER_CATEGORY = 20;
const OUT = path.resolve(__dirname, '../../bench/suite.json');
const ROWS = 'https://datasets-server.huggingface.co/rows';

async function rows(dataset: string, config: string, split: string, offset: number, length: number): Promise<any[]> {
  const url = `${ROWS}?${new URLSearchParams({ dataset, config, split, offset: String(offset), length: String(length) })}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${dataset}: ${response.status}`);
  return (await response.json()).rows.map((r: any) => ({ ...r.row, _row: r.row_idx }));
}

async function total(dataset: string, config: string, split: string): Promise<number> {
  const url = `https://datasets-server.huggingface.co/size?${new URLSearchParams({ dataset })}`;
  const data = await (await fetch(url)).json();
  const entry = data.size.splits.find((s: any) => s.config === config && s.split === split);
  return entry.num_rows;
}

/** Positions spread evenly over the dataset. */
const spread = (count: number, n = PER_CATEGORY) => Array.from({ length: n }, (_, i) => Math.floor((i + 0.5) * count / n));

async function sampleRows(dataset: string, config: string, split: string) {
  const count = await total(dataset, config, split);
  const picked: any[] = [];
  for (const offset of spread(count)) picked.push((await rows(dataset, config, split, offset, 1))[0]);
  return picked;
}

const hf = (dataset: string) => `https://huggingface.co/datasets/${dataset}`;

async function gsm8k(): Promise<BenchItem[]> {
  return (await sampleRows('openai/gsm8k', 'main', 'test')).map(row => ({
    id: `gsm8k:${row._row}`, category: 'math',
    source: { dataset: 'openai/gsm8k', split: 'test', row: row._row, license: 'MIT', url: hf('openai/gsm8k') },
    prompt: `${row.question}\n\nSolve it step by step, then end with a final line in the form "Answer: <number>".`,
    grade: { kind: 'number', answer: Number(String(row.answer).split('####').pop()!.trim().replace(/,/g, '')) },
  }));
}

async function cruxeval(): Promise<BenchItem[]> {
  return (await sampleRows('cruxeval-org/cruxeval', 'default', 'test')).map(row => ({
    id: `cruxeval:${row.id}`, category: 'code',
    source: { dataset: 'cruxeval-org/cruxeval', split: 'test', row: row._row, license: 'MIT', url: hf('cruxeval-org/cruxeval') },
    prompt: `What does this Python function return for the input below? Work it out without running it.\n\n\`\`\`python\n${row.code}\n\`\`\`\n\nf(${row.input})\n\nEnd with a final line in the form "Answer: <the returned value as a Python literal>".`,
    grade: { kind: 'literal', answer: row.output },
  }));
}

async function ifeval(): Promise<BenchItem[]> {
  const all: any[] = [];
  for (let offset = 0; offset < 600; offset += 100) all.push(...await rows('google/IFEval', 'default', 'train', offset, 100));
  // Only instructions Bench can check exactly; long essays are left out to save free quota.
  const usable = all.filter(row => row.instruction_id_list.every((id: string) => id in IFEVAL_CHECKS)
    && !row.kwargs.some((k: any) => (k.num_words ?? 0) > 300));
  return spread(usable.length).map(i => usable[i]).map(row => ({
    id: `ifeval:${row.key}`, category: 'instructions',
    source: { dataset: 'google/IFEval', split: 'train', row: row._row, license: 'Apache-2.0', url: hf('google/IFEval') },
    prompt: row.prompt,
    grade: {
      kind: 'ifeval',
      checks: row.instruction_id_list.map((id: string, i: number) => ({
        id, args: Object.fromEntries(Object.entries(row.kwargs[i] ?? {}).filter(([, value]) => value !== null)),
      })),
    },
  }));
}

/** BFCL's function schemas use Python type names; tools need JSON Schema. */
function jsonSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(jsonSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: any = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type') {
      const type = { dict: 'object', float: 'number', tuple: 'array', any: undefined }[value as string] ?? value;
      if (type) out.type = type;
    } else out[key] = jsonSchema(value);
  }
  return out;
}

async function bfcl(): Promise<BenchItem[]> {
  const base = 'https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard/resolve/main';
  const lines = async (file: string) => (await (await fetch(`${base}/${file}`)).text()).trim().split('\n').map(line => JSON.parse(line));
  const questions = await lines('BFCL_v3_simple.json');
  const answers = new Map((await lines('possible_answer/BFCL_v3_simple.json')).map((a: any) => [a.id, a.ground_truth[0]]));
  return spread(questions.length).map(i => questions[i]).map((q: any) => {
    const fn = q.function[0];
    // Tool names allow letters, digits, _ and -, so "math.factorial" is sent as "math_factorial".
    const name = fn.name.replace(/\./g, '_');
    const [[answerName, args]] = Object.entries(answers.get(q.id) as Record<string, Record<string, unknown[]>>);
    return {
      id: `bfcl:${q.id}`, category: 'tools',
      source: { dataset: 'gorilla-llm/Berkeley-Function-Calling-Leaderboard', split: 'BFCL_v3_simple', row: q.id, license: 'Apache-2.0', url: hf('gorilla-llm/Berkeley-Function-Calling-Leaderboard') },
      prompt: q.question[0].map((m: any) => m.content).join('\n'),
      tools: [{ name, description: fn.description, parameters: jsonSchema(fn.parameters) }],
      grade: { kind: 'tool-call', name: answerName.replace(/\./g, '_'), args },
    } satisfies BenchItem;
  });
}

async function squad(): Promise<BenchItem[]> {
  return (await sampleRows('rajpurkar/squad', 'plain_text', 'validation')).map(row => ({
    id: `squad:${row.id}`, category: 'facts',
    source: { dataset: 'rajpurkar/squad', split: 'validation', row: row._row, license: 'CC-BY-SA-4.0', url: hf('rajpurkar/squad') },
    prompt: `Context:\n${row.context}\n\nQuestion: ${row.question}\n\nAnswer with the shortest phrase from the context that answers the question, and nothing else.`,
    grade: { kind: 'span', answers: [...new Set<string>(row.answers.text)] },
  }));
}

async function main() {
  const items = [...await cruxeval(), ...await gsm8k(), ...await ifeval(), ...await bfcl(), ...await squad()];
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), items }, null, 1) + '\n');
  console.log(`Wrote ${items.length} items to ${OUT}`);
}

main().catch(error => { console.error(error); process.exit(1); });
