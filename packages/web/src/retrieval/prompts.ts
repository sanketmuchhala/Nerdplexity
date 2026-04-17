export const GEMMA_WEB_SYSTEM_PROMPT = `You are Nerdplexity's answer engine. Your job:
- Give a concise, correct answer first.
- Then provide 2–5 bullet "Key points".
- Always include citations as [1], [2]… matching the Sources list.
- If confidence is low, say what's missing and ask a targeted follow-up.

Rules:
- Use only the provided snippets and user context for claims of fact.
- If insufficient evidence, say so and suggest next steps.
- Prefer recency, authority, and diversity of sources.
- Keep total answer under the token limit; avoid repetition.

Output structure:
1) Direct answer (2–5 sentences)
2) Key points (bullets)
3) Sources: [1] domain/path, [2] domain/path …`;

export const GEMMA_NO_WEB_SYSTEM_PROMPT = `You are a concise assistant. Provide the most direct answer first.
Keep total under the token limit. If uncertain, ask one clarifying question.`;

export function buildRAGPrompt(userQuery: string, snippets: any[]): string {
  const ragBlock = `Retrieved snippets (condensed):
${snippets.map(s => `[${s.idx}] ${s.host} - ${s.snippet}`).join('\n')}

---

User Question: ${userQuery}

Please provide your answer following the format specified in your system prompt.`;

  return ragBlock;
}

export interface GemmaConfig {
  num_ctx: number;
  num_predict: number;
  temperature: number;
  top_p: number;
  top_k: number;
  stream?: boolean;
}

export const GEMMA_PERFORMANCE_CONFIG: GemmaConfig = {
  num_ctx: 2048,
  num_predict: 256,
  temperature: 0.2,
  top_p: 0.9,
  top_k: 40,
  stream: true
};

export const GEMMA_WEB_CONFIG: GemmaConfig = {
  num_ctx: 1024,
  num_predict: 128,
  temperature: 0.2,
  top_p: 0.9,
  top_k: 40,
  stream: true
};

export function validateCitations(text: string, sourceCount: number): boolean {
  // Check if response contains proper citation markers
  const citationRegex = /\[(\d+)\]/g;
  const matches = text.match(citationRegex);
  
  if (!matches) return false;
  
  // Extract cited numbers
  const citedNumbers = matches.map(m => parseInt(m.match(/\d+/)?.[0] || '0'));
  const uniqueCitations = new Set(citedNumbers);
  
  // Ensure citations are within valid range and at least 1 source is cited
  return uniqueCitations.size > 0 && 
         Math.max(...citedNumbers) <= sourceCount &&
         Math.min(...citedNumbers) >= 1;
}

export function extractSources(snippets: any[]): string {
  return snippets
    .map(s => `[${s.idx}] ${s.host} - ${s.title || s.url}`)
    .join('\n');
}

export function formatWebResponse(answer: string, sources: string): string {
  // Add sources section if not already present
  if (!answer.toLowerCase().includes('sources:')) {
    return `${answer}\n\nSources:\n${sources}`;
  }
  return answer;
}