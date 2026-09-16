import { redact } from './destinations.js';

/**
 * Exa's API. Requests go only here; a model or prompt cannot choose another destination.
 * EXA_API_URL is an operator setting for tests, never taken from a request.
 */
const exaURL = () => process.env.EXA_API_URL || 'https://api.exa.ai';

export const MAX_WEB_RESULTS = 8;
const EXCERPT_CHARS = 1500;

export interface WebSearchResult { title: string; url: string; published?: string; excerpt: string }

function failure(status: number, detail: string): Error {
  const reason = status === 401 || status === 403 ? 'Exa rejected the API key. Check it in Connections.'
    : status === 402 ? 'Exa reports no remaining credits for this key.'
    : status === 429 ? 'Exa is rate limiting searches. Try again shortly.'
    : status >= 500 ? `Exa is unavailable (${status}).`
    : `Exa rejected the search (${status}).`;
  return new Error(detail && status === 400 ? `${reason} ${detail}` : reason);
}

export interface WebPage { title: string; url: string; published?: string; text: string }

/**
 * One Exa search that returns each page's text (up to textChars), for Deep Research readers.
 * Pages without text are left out.
 */
export async function exaPages(query: string, numResults: number, apiKey: string, textChars: number, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<WebPage[]> {
  const response = await fetchImpl(`${exaURL()}/search`, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ query, type: 'auto', numResults, contents: { text: { maxCharacters: textChars } } }),
  });
  const body = await response.text().catch(() => '');
  let data: any;
  try { data = JSON.parse(body); } catch { data = undefined; }
  if (!response.ok) throw failure(response.status, redact(String(data?.error ?? body), apiKey).replace(/\s+/g, ' ').trim().slice(0, 200));
  if (!data || !Array.isArray(data.results)) throw new Error('Exa returned an unexpected response.');
  return data.results
    .filter((r: any) => typeof r?.url === 'string' && /^https?:\/\//i.test(r.url) && typeof r.text === 'string' && r.text.trim())
    .slice(0, numResults)
    .map((r: any): WebPage => ({
      title: typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 300) : r.url.slice(0, 300),
      url: r.url.slice(0, 2000),
      ...(typeof r.publishedDate === 'string' && r.publishedDate ? { published: r.publishedDate.slice(0, 10) } : {}),
      text: r.text.slice(0, textChars),
    }));
}

/** One Exa search, reduced to titles, URLs, dates, and query-relevant excerpts. */
export async function exaSearch(query: string, numResults: number, apiKey: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${exaURL()}/search`, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ query, type: 'auto', numResults, contents: { highlights: { maxCharacters: EXCERPT_CHARS } } }),
  });
  const body = await response.text().catch(() => '');
  let data: any;
  try { data = JSON.parse(body); } catch { data = undefined; }
  if (!response.ok) {
    const detail = redact(String(data?.error ?? body), apiKey).replace(/\s+/g, ' ').trim().slice(0, 200);
    throw failure(response.status, detail);
  }
  if (!data || !Array.isArray(data.results)) throw new Error('Exa returned an unexpected response.');
  const results: WebSearchResult[] = data.results
    .filter((r: any) => typeof r?.url === 'string' && /^https?:\/\//i.test(r.url))
    .slice(0, numResults)
    .map((r: any) => ({
      title: typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 300) : r.url.slice(0, 300),
      url: r.url.slice(0, 2000),
      ...(typeof r.publishedDate === 'string' && r.publishedDate ? { published: r.publishedDate.slice(0, 10) } : {}),
      excerpt: (Array.isArray(r.highlights) && r.highlights.length ? r.highlights.filter((h: unknown) => typeof h === 'string').join(' … ') : typeof r.text === 'string' ? r.text : '').slice(0, EXCERPT_CHARS),
    }));
  const cost = Number(data.costDollars?.total);
  return { query, results, ...(Number.isFinite(cost) ? { reported_cost_usd: cost } : {}) };
}
