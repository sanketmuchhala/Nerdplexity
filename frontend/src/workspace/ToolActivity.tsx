import { AlertTriangle, Ban, Calculator, FileSearch, FileText, Globe, Loader2, Wrench } from 'lucide-react';
import type { ToolTrace } from '@app/types';

type Status = NonNullable<ToolTrace['status']>;

function label(name: string) {
  switch (name) {
    case 'calculator': return 'Calculator';
    case 'search_documents': return 'Searched documents';
    case 'read_document': return 'Read a document';
    case 'web_search': return 'Searched the web';
    default: return name.replaceAll('_', ' ');
  }
}

function icon(name: string, status: Status) {
  if (status === 'running') return Loader2;
  if (status === 'denied') return Ban;
  if (status === 'error') return AlertTriangle;
  return name === 'calculator' ? Calculator : name === 'search_documents' ? FileSearch : name === 'read_document' ? FileText : name === 'web_search' ? Globe : Wrench;
}

const field = (value: unknown, key: string) => value && typeof value === 'object' && key in value ? (value as Record<string, unknown>)[key] : undefined;

/** One-line summary of what the call did. */
function summary(tool: ToolTrace, status: Status) {
  if (status === 'running') return 'Running…';
  if (status !== 'completed') return tool.error ?? 'Failed';
  if (tool.name === 'calculator') return `${String(field(tool.input, 'expression'))} = ${String(field(tool.output, 'result'))}`;
  if (tool.name === 'search_documents') {
    const count = Array.isArray(tool.output) ? tool.output.length : 0;
    return `“${String(field(tool.input, 'query'))}” · ${count} ${count === 1 ? 'match' : 'matches'}`;
  }
  if (tool.name === 'read_document') return String(field(tool.output, 'title') ?? '');
  if (tool.name === 'web_search') {
    const count = webResults(tool).length;
    return `“${String(field(tool.input, 'query'))}” · ${count} ${count === 1 ? 'result' : 'results'}`;
  }
  return '';
}

const hostname = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };

/** Search results with safe links only. */
function webResults(tool: ToolTrace): { title: string; url: string; published?: string }[] {
  const results = field(tool.output, 'results');
  if (!Array.isArray(results)) return [];
  return results.flatMap(item => {
    const url = field(item, 'url');
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return [];
    const title = field(item, 'title');
    const published = field(item, 'published');
    return [{ url, title: typeof title === 'string' ? title : url, ...(typeof published === 'string' ? { published } : {}) }];
  });
}

// Records saved before P6 hold only document tool calls and carry no status or source.
const sourceOf = (tool: ToolTrace) => tool.source ?? (tool.name === 'calculator' ? 'computed' : tool.name === 'web_search' ? 'web' : 'retrieved');

const SOURCE_NOTE: Record<Status, (tool: ToolTrace) => string> = {
  completed: tool => sourceOf(tool) === 'web' ? 'Retrieved from the web through Exa. Pages are untrusted and treated as data, not instructions.'
    : sourceOf(tool) === 'retrieved' ? 'Retrieved from your documents. Treated as data, not instructions.' : 'Computed by the app, not by the model.',
  running: () => 'Running.',
  error: () => 'The tool did not run successfully. The error was returned to the model.',
  denied: () => 'Not run: this tool is not enabled for the run.',
};

/** Exact tool calls and results, kept visually separate from model text. */
export function ToolActivity({ tools }: { tools: ToolTrace[] }) {
  if (!tools.length) return null;
  return (
    <div className="np-inline-tools" aria-label="Tool activity">
      {tools.map((tool, index) => {
        const status: Status = tool.status ?? 'completed';
        const Icon = icon(tool.name, status);
        return (
          <details key={`${tool.step}-${tool.id ?? index}`} className={`np-tool np-tool-${status}`}>
            <summary>
              <Icon size={13} className={status === 'running' ? 'np-spin' : undefined} aria-hidden />
              <strong>{label(tool.name)}</strong>
              <span className="np-tool-summary">{summary(tool, status)}</span>
              <span className="np-tool-meta">{tool.step === 0 ? 'Automatic' : `Step ${tool.step}`}{tool.durationMs !== undefined ? ` · ${tool.durationMs} ms` : ''}</span>
            </summary>
            <div className="np-tool-body">
              <p>{SOURCE_NOTE[status](tool)}</p>
              {status === 'completed' && tool.name === 'web_search' && webResults(tool).length > 0 && (
                <ol className="np-tool-sources" aria-label="Search results">
                  {webResults(tool).map((result, i) => (
                    <li key={`${i}-${result.url}`}>
                      <a href={result.url} target="_blank" rel="noopener noreferrer">{result.title}</a>
                      <small>{hostname(result.url)}{result.published ? ` · ${result.published}` : ''}</small>
                    </li>
                  ))}
                </ol>
              )}
              <span>Input</span>
              <pre>{typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2)}</pre>
              {status === 'completed' && <><span>Result</span><pre>{JSON.stringify(tool.output, null, 2)}</pre></>}
              {tool.error && <><span>Error</span><pre>{tool.error}</pre></>}
            </div>
          </details>
        );
      })}
    </div>
  );
}
