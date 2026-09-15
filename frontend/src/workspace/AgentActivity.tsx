import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import type { AgentMode, AgentStep } from '@app/types';
import { RouterMark } from './RouterMark';

const COUNT = ['No', 'One', 'Two', 'Three'];
const MODE: Record<AgentMode, (drafts: number) => string> = {
  direct: () => 'Answered directly',
  ensemble: drafts => drafts === 1 ? 'One draft, checked and rewritten' : `${COUNT[drafts] ?? drafts} drafts, checked and combined`,
  plan: () => 'Split into parts for specialists',
};

function roleLabel(step: AgentStep) {
  const n = /-(\d+)$/.exec(step.id)?.[1];
  switch (step.role) {
    case 'planner': return 'Plan';
    case 'drafter': return `Draft ${n ?? ''}`.trim();
    case 'specialist': return `Part ${n ?? ''}${step.kind ? ` · ${step.kind}` : ''}`;
    case 'writer': return 'Final answer';
    default: return step.role;
  }
}

const state = (step: AgentStep) => step.status === 'running' ? 'working…'
  : step.status === 'failed' ? 'failed'
    : step.durationMs !== undefined ? `${(step.durationMs / 1000).toFixed(1)} s` : 'done';

/** How the Free Agent worked on a message: its strategy, every model it asked, and what each wrote. */
export function AgentActivity({ steps, nameOf, calls, showModels = true }: { steps: AgentStep[]; nameOf: (connectionId: string) => string; calls?: number; showModels?: boolean }) {
  const strategy = steps.find(step => step.role === 'strategy');
  const work = steps.filter(step => step.role !== 'strategy');
  if (!strategy && !work.length) return null;
  const writer = work.find(step => step.role === 'writer');
  const drafts = work.filter(step => step.role === 'drafter').length;
  const summary = [strategy?.mode ? MODE[strategy.mode](drafts) : 'Working', showModels && writer?.model && writer.status !== 'failed' ? `final by ${writer.model}` : ''].filter(Boolean).join(' · ');
  return (
    <div aria-label="Free Agent steps">
      <details className="np-tool np-route np-agent">
        <summary>
          <RouterMark size={14} />
          <strong>Free Agent</strong>
          <span className="np-tool-summary">{summary}</span>
          <span className="np-tool-meta">{calls !== undefined ? `${calls} request${calls === 1 ? '' : 's'}` : `${work.length} step${work.length === 1 ? '' : 's'}`}</span>
        </summary>
        <div className="np-tool-body">
          {strategy && <p>{strategy.reason}</p>}
          <ol className="np-route-steps">
            {work.map(step => (
              <li key={step.id} className={step.status === 'failed' ? 'np-route-failed' : undefined}>
                {step.status === 'failed' ? <AlertTriangle size={12} aria-hidden /> : step.status === 'running' ? <Loader2 size={12} className="np-spin" aria-hidden /> : <Check size={12} aria-hidden />}
                <strong>{roleLabel(step)}</strong>
                <small>{[showModels && step.model, showModels && step.connectionId && nameOf(step.connectionId), state(step)].filter(Boolean).join(' · ')}</small>
                {step.task && <span className="np-agent-task">{step.task}</span>}
                {(showModels || step.status === 'failed') && <span className={step.status === 'failed' ? 'np-route-error' : undefined}>{step.reason}</span>}
                {step.text && (
                  <details className="np-agent-text">
                    <summary>{step.role === 'planner' ? 'Read the plan' : step.role === 'specialist' ? 'Read this part' : 'Read the draft'}</summary>
                    <pre>{step.text}</pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        </div>
      </details>
    </div>
  );
}
