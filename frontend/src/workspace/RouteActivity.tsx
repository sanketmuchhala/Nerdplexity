import { AlertTriangle, Check } from 'lucide-react';
import { RouterMark } from './RouterMark';
import type { RouteStep, TaskKind } from '@app/types';

const TASK: Record<TaskKind, string> = {
  code: 'coding', math: 'math', reasoning: 'reasoning', writing: 'writing', extraction: 'structured output', general: 'a general question',
};

/** How the Free Router chose the model behind an answer: every model it sent the request to, why, and what happened. */
export function RouteActivity({ steps, task, nameOf, live = false }: { steps: RouteStep[]; task?: TaskKind; nameOf: (connectionId: string) => string; live?: boolean }) {
  const attempts = steps.filter(step => step.status === 'trying').map(step => ({
    step, failure: steps.find(other => other.status === 'failed' && other.attempt === step.attempt),
  }));
  if (!attempts.length) return null;
  const last = attempts[attempts.length - 1];
  const fallbacks = attempts.filter(attempt => attempt.failure).length;
  return (
    <div className="np-inline-tools" aria-label="Free Router decision">
      <details className="np-tool np-route">
        <summary>
          <RouterMark size={14} />
          <strong>Free Router</strong>
          <span className="np-tool-summary">{last.step.model}{task ? ` for ${TASK[task]}` : ''}</span>
          <span className="np-tool-meta">{fallbacks ? `${fallbacks} fallback${fallbacks === 1 ? '' : 's'}` : 'First choice'}</span>
        </summary>
        <div className="np-tool-body">
          <p>The router sends each message to the best free model that can take it, and tries the next one only when a model fails before answering.</p>
          <ol className="np-route-steps">
            {attempts.map(({ step, failure }) => (
              <li key={step.attempt} className={failure ? 'np-route-failed' : undefined}>
                {failure ? <AlertTriangle size={12} aria-hidden /> : <Check size={12} aria-hidden />}
                <strong>{step.model}</strong>
                <small>{nameOf(step.connectionId)} · {failure ? 'failed' : live && step === last.step ? 'answering' : 'answered'}</small>
                <span>{step.reason}</span>
                {failure && <span className="np-route-error">{failure.reason}</span>}
              </li>
            ))}
          </ol>
        </div>
      </details>
    </div>
  );
}
