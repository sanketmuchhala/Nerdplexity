/**
 * PERPLEXITY++ SYSTEM PROMPT SPEC
 * 
 * This system prompt encodes the 9-layer orchestration behavior for any model/provider.
 * Inner reasoning stays private; only contracts/outputs are exposed.
 */

import { TaskType, ConfidenceLevel, ReportCardItem } from '../types.js';

export const ORCHESTRATOR_SYSTEM_PROMPT = `You are an advanced research assistant with Perplexity++ capabilities. Follow this precise 9-layer orchestration:

## LAYER 1: QUERY REWRITE (QR)
- Silently enhance user queries for precision and clarity
- If ambiguous, make explicit assumptions (show in "Assumptions" chip)
- Generate focused search terms when web research is needed

## LAYER 2: REASONING PLAN (RP) 
- Create internal 1-5 bullet reasoning plan (private)
- Classify task type: direct | research | write | code | math | critique
- Set confidence baseline: high | medium | low

## LAYER 3: MULTI-SOURCE SYNTHESIS (MSS)
- For research tasks: plan ≥3 reputable sources
- Compare/contrast information, resolve conflicts
- Include publication dates for recency assessment
- Use inline citations [1][2][3] in response

## LAYER 4: DUAL-PASS ANSWERING (DPA)
- Pass A: Generate best answer under current assumptions
- Pass B: Self-critique for material issues (private reasoning)
- If issues found: patch answer and note change in report card

## LAYER 5: DEBATE PING (DP)
- For complex/ambiguous topics: simulate 2-angle disagreement check
- Present only reconciled conclusion with confidence level
- Flag when perspectives differ significantly

## LAYER 6: ANSWER CONTRACT (AC)
- Structure by task type with clear headings
- Include runnable code blocks with copy buttons
- Provide "Answer Outline" for long responses (>300 words)
- Use bullets, tables, and formatting appropriately

## LAYER 7: FOLLOW-UPS GENERATOR (FG)
- Generate 3-5 high-leverage follow-up questions/tasks
- Examples: "Compare X vs Y", "Turn into slide outline", "Add implementation details"
- Make each follow-up actionable and specific

## LAYER 8: REPORT CARD (RC)
- Assess: Correctness PASS/WARN, Completeness PASS/WARN, Evidence PASS/WARN
- Check: Safety/Privacy PASS/WARN, Clarity PASS/WARN, Actionability PASS/WARN
- Include brief note for any warnings

## LAYER 9: MEMORY HOOKS (MH)
- Extract 1-5 atomic facts/decisions for long-term storage
- Redact any sensitive information
- Tag with relevant context for future retrieval

## OUTPUT FORMAT
Structure your response exactly as follows:

[If assumptions were made]
**Assumptions:** [Brief list of key assumptions]

[Main response content with inline citations if research was used]

[If web search was performed]
**Sources Used:** [Will be auto-populated by system]

[Always include]
**Confidence:** [high/medium/low] [brief reasoning]

**Follow-ups:**
• [Specific actionable question 1]
• [Specific actionable question 2]  
• [Specific actionable question 3]

**Report Card:**
PASS Correctness | PASS Completeness | PASS Evidence | PASS Safety | PASS Clarity | PASS Actionable

## CRITICAL RULES
- Never expose internal reasoning chains
- Always provide inline citations for research
- Keep follow-ups specific and actionable
- Flag safety concerns immediately
- Maintain professional, direct tone
- No emojis except in report card status indicators`;

export function generateOrchestrationPrompt(
  originalQuery: string,
  taskType: TaskType,
  webSearchEnabled: boolean,
  reasoningEnabled: boolean,
  contextInfo?: string
): string {
  const enhancedPrompt = `${ORCHESTRATOR_SYSTEM_PROMPT}

## CURRENT REQUEST
**Query:** ${originalQuery}
**Task Type:** ${taskType}
**Web Search:** ${webSearchEnabled ? 'enabled' : 'disabled'}
**Reasoning Display:** ${reasoningEnabled ? 'enabled' : 'disabled'}
${contextInfo ? `**Context:** ${contextInfo}` : ''}

Execute the 9-layer orchestration and respond according to the output format above.`;

  return enhancedPrompt;
}

export function detectTaskType(query: string): TaskType {
  const queryLower = query.toLowerCase();
  
  // Code-related keywords
  if (queryLower.includes('code') || queryLower.includes('function') || 
      queryLower.includes('debug') || queryLower.includes('implement') ||
      queryLower.includes('algorithm') || queryLower.includes('programming')) {
    return 'code';
  }
  
  // Research-related keywords
  if (queryLower.includes('research') || queryLower.includes('compare') ||
      queryLower.includes('analyze') || queryLower.includes('what is') ||
      queryLower.includes('explain') || queryLower.includes('latest')) {
    return 'research';
  }
  
  // Writing-related keywords
  if (queryLower.includes('write') || queryLower.includes('draft') ||
      queryLower.includes('compose') || queryLower.includes('article') ||
      queryLower.includes('blog') || queryLower.includes('essay')) {
    return 'write';
  }
  
  // Math-related keywords
  if (queryLower.includes('calculate') || queryLower.includes('solve') ||
      queryLower.includes('math') || queryLower.includes('equation') ||
      queryLower.includes('formula')) {
    return 'math';
  }
  
  // Critique-related keywords
  if (queryLower.includes('review') || queryLower.includes('critique') ||
      queryLower.includes('evaluate') || queryLower.includes('assess') ||
      queryLower.includes('feedback')) {
    return 'critique';
  }
  
  // Default to direct for simple queries
  return 'direct';
}

export function extractAssumptions(response: string): string[] {
  const assumptionsMatch = response.match(/\*\*Assumptions:\*\*\s*(.+?)(?=\n\n|\*\*|$)/s);
  if (!assumptionsMatch) return [];
  
  return assumptionsMatch[1]
    .split('\n')
    .map(line => line.replace(/^[•\-\*]\s*/, '').trim())
    .filter(line => line.length > 0);
}

export function extractConfidence(response: string): ConfidenceLevel {
  const confidenceMatch = response.match(/\*\*Confidence:\*\*\s*(high|medium|low)/i);
  if (!confidenceMatch) return 'medium';
  
  return confidenceMatch[1].toLowerCase() as ConfidenceLevel;
}

export function extractFollowUps(response: string): string[] {
  const followUpsMatch = response.match(/\*\*Follow-ups:\*\*\s*(.+?)(?=\n\n|\*\*|$)/s);
  if (!followUpsMatch) return [];
  
  return followUpsMatch[1]
    .split('\n')
    .map(line => line.replace(/^[•\-\*]\s*/, '').trim())
    .filter(line => line.length > 0 && !line.startsWith('**'));
}

export function extractReportCard(response: string): ReportCardItem[] | null {
  const reportCardMatch = response.match(/\*\*Report Card:\*\*\s*(.+?)$/s);
  if (!reportCardMatch) return null;
  
  const cardText = reportCardMatch[1];
  const categories = ['Correctness', 'Completeness', 'Evidence', 'Safety', 'Clarity', 'Actionable'];
  
  return categories.map(category => ({
    category: category.toLowerCase() as any,
    status: cardText.includes(`PASS ${category}`) ? 'pass' as const : 'warning' as const,
    note: cardText.includes(`WARN ${category}`) ? 'See response for details' : undefined
  }));
}
