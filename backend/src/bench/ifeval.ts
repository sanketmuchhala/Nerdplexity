// Instruction checks from IFEval (Apache-2.0, google-research/instruction_following_eval), strict
// variant, for the instruction types that can be checked exactly without language detection or
// sentence splitting. Items using any other type are left out of the suite.

type Args = Record<string, any>;
type Check = (response: string, args: Args) => boolean;

const compare = (count: number, target: number, relation: string) => relation === 'less than' ? count < target : count >= target;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = (text: string) => text.match(/\w+/g)?.length ?? 0;

export const IFEVAL_CHECKS: Record<string, Check> = {
  'punctuation:no_comma': response => !response.includes(','),
  'change_case:english_lowercase': response => response === response.toLowerCase(),
  'change_case:english_capital': response => response === response.toUpperCase(),
  // A word counts when it has letters and all of them are capitals, like Python's str.isupper().
  'change_case:capital_word_frequency': (response, { capital_frequency, capital_relation }) =>
    compare((response.match(/\w+/g) ?? []).filter(word => /[a-z]/i.test(word) && word === word.toUpperCase()).length, capital_frequency, capital_relation),
  'detectable_format:json_format': response => {
    const body = response.trim().replace(/^```(json|Json|JSON)?/, '').replace(/```$/, '').trim();
    try { JSON.parse(body); return true; } catch { return false; }
  },
  'detectable_format:number_bullet_lists': (response, { num_bullets }) =>
    (response.match(/^\s*\*[^*].*$/gm)?.length ?? 0) + (response.match(/^\s*-.*$/gm)?.length ?? 0) === num_bullets,
  'detectable_format:title': response => (response.match(/<<[^\n]+>>/g) ?? []).some(title => title.slice(2, -2).trim().length > 0),
  'detectable_format:number_highlighted_sections': (response, { num_highlights }) => {
    const single = (response.match(/\*[^\n*]*\*/g) ?? []).filter(h => h.slice(1, -1).trim());
    const double = (response.match(/\*\*[^\n*]*\*\*/g) ?? []).filter(h => h.slice(2, -2).trim());
    return single.length + double.length >= num_highlights;
  },
  'detectable_format:multiple_sections': (response, { section_spliter, num_sections }) =>
    response.split(new RegExp(`\\s?${escape(section_spliter)}\\s?\\d+\\s?`)).length - 1 >= num_sections,
  'detectable_format:constrained_response': response => ['My answer is yes.', 'My answer is no.', 'My answer is maybe.'].some(option => response.trim().includes(option)),
  'startend:end_checker': (response, { end_phrase }) => response.trim().toLowerCase().endsWith(String(end_phrase).trim().toLowerCase()),
  'startend:quotation': response => { const value = response.trim(); return value.length > 1 && value.startsWith('"') && value.endsWith('"'); },
  'keywords:existence': (response, { keywords }) => (keywords as string[]).every(keyword => new RegExp(escape(keyword), 'i').test(response)),
  'keywords:forbidden_words': (response, { forbidden_words }) => !(forbidden_words as string[]).some(word => new RegExp(`\\b${escape(word)}\\b`, 'i').test(response)),
  'keywords:frequency': (response, { keyword, frequency, relation }) => compare((response.match(new RegExp(escape(keyword), 'gi')) ?? []).length, frequency, relation),
  'keywords:letter_frequency': (response, { letter, let_frequency, let_relation }) =>
    compare(response.toLowerCase().split(String(letter).toLowerCase()).length - 1, let_frequency, let_relation),
  'length_constraints:number_words': (response, { num_words, relation }) => compare(words(response), num_words, relation),
  'length_constraints:number_paragraphs': (response, { num_paragraphs }) => {
    const paragraphs = response.split(/\s?\*\*\*\s?/);
    let count = paragraphs.length;
    for (let i = 0; i < paragraphs.length; i++) {
      if (paragraphs[i].trim()) continue;
      if (i === 0 || i === paragraphs.length - 1) count--;
      else return false;
    }
    return count === num_paragraphs;
  },
  'detectable_content:postscript': (response, { postscript_marker }) => {
    const marker = String(postscript_marker);
    const pattern = marker === 'P.P.S' ? /\s*p\.\s?p\.\s?s.*$/m : marker === 'P.S.' ? /\s*p\.\s?s\..*$/m : new RegExp(`\\s*${escape(marker.toLowerCase())}.*$`, 'm');
    return pattern.test(response.toLowerCase());
  },
  'detectable_content:number_placeholders': (response, { num_placeholders }) => (response.match(/\[.*?\]/g)?.length ?? 0) >= num_placeholders,
};

/** Every instruction holds. Unknown instruction types fail rather than pass. */
export function checkInstructions(response: string, checks: { id: string; args: Args }[]): { passed: boolean; failed: string[] } {
  const failed = checks.filter(({ id, args }) => !IFEVAL_CHECKS[id]?.(response, args)).map(check => check.id);
  return { passed: failed.length === 0, failed };
}
