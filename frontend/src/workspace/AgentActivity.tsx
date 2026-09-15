import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, CornerDownRight, ExternalLink, Loader2, Search } from 'lucide-react';
import type { AgentMode, AgentStep } from '@app/types';
import ModelLogo, { formatModelName } from './ModelLogo';
import { RouterMark } from './RouterMark';

const COUNT = ['No', 'One', 'Two', 'Three'];
const MODE: Record<AgentMode, (drafts: number) => string> = {
  direct: () => 'Answered directly',
  ensemble: drafts => drafts === 1 ? 'One draft, checked and rewritten' : `${COUNT[drafts] ?? drafts} drafts, checked and combined`,
  plan: () => 'Split into parts for specialists',
  research: () => 'Deep research',
};

function roleLabel(step: AgentStep) {
  const n = /-(\d+)$/.exec(step.id)?.[1];
  switch (step.role) {
    case 'planner': return 'Plan';
    case 'drafter': return `Draft ${n ?? ''}`.trim();
    case 'specialist': return `Part ${n ?? ''}${step.kind ? ` · ${step.kind}` : ''}`;
    case 'writer': return 'Final answer';
    case 'searcher': return `Search ${n ?? ''}`.trim();
    case 'reader': return `Source ${n ?? ''}`.trim();
    case 'outliner': return 'Outline';
    case 'checker': return 'Citation check';
    default: return step.role;
  }
}

const state = (step: AgentStep) => step.status === 'running' ? 'working…'
  : step.status === 'failed' ? (step.role === 'checker' ? 'issues found' : 'failed')
    : step.durationMs !== undefined ? `${(step.durationMs / 1000).toFixed(1)} s` : 'done';

const short = (model?: string) => model ? formatModelName(undefined, model) : 'a model';

/** Text a model is writing: live and scrolling while it works, folded away once it is done. */
function Stream({ label, doneLabel, text, live, thinking = false }: { label: string; doneLabel: string; text: string; live: boolean; thinking?: boolean }) {
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => { if (live && box.current) box.current.scrollTop = box.current.scrollHeight; }, [text, live]);
  if (live) {
    return (
      <div className={`np-agent-stream ${thinking ? 'thinking' : ''}`}>
        <span>{label}</span>
        <pre ref={box}>{text}</pre>
      </div>
    );
  }
  return (
    <details className={`np-agent-text ${thinking ? 'thinking' : ''}`}>
      <summary>{doneLabel}</summary>
      <pre>{text}</pre>
    </details>
  );
}

interface Props {
  steps: AgentStep[];
  nameOf: (connectionId: string) => string;
  /** The provider behind a connection, for its logo. Defaults to nameOf. */
  providerOf?: (connectionId: string) => string;
  calls?: number;
  /** The run is in progress: the panel opens and each model's work streams. */
  live?: boolean;
  /** The final writer's reasoning, which streams with the answer rather than as a step. */
  writerThinking?: string;
}

/**
 * The Free Agent at work: every model it asked, the role each one had, what each thought and wrote,
 * and what was handed from one model to another. Open while the run is live.
 */
export function AgentActivity({ steps, nameOf, providerOf = nameOf, calls, live = false, writerThinking }: Props) {
  const [open, setOpen] = useState(live);
  useEffect(() => { if (live) setOpen(true); }, [live]);
  const strategy = steps.find(step => step.role === 'strategy');
  const work = steps.filter(step => step.role !== 'strategy');
  if (!strategy && !work.length) return null;

  const planner = work.find(step => step.role === 'planner');
  const searches = work.filter(step => step.role === 'searcher');
  const inputs = work.filter(step => step.role === 'drafter' || step.role === 'specialist' || step.role === 'reader');
  const outliner = work.find(step => step.role === 'outliner');
  const writer = work.find(step => step.role === 'writer');
  // A source that gave no checked notes sends nothing on.
  const received = inputs.filter(step => step.status === 'done' && step.text && !(step.role === 'reader' && /^Kept 0 /.test(step.reason)));
  const research = strategy?.mode === 'research';
  // Many sources can be read by the same few models: the flow line shows each model once.
  const inputModels = [...new Map(inputs.filter(step => step.model).map(step => [`${step.connectionId}\n${step.model}`, step])).values()];
  const drafts = work.filter(step => step.role === 'drafter').length;
  const models = [...new Map(work.filter(step => step.model && step.connectionId).map(step => [`${step.connectionId}\n${step.model}`, step])).values()];

  const logo = (step: AgentStep, size = 16) => step.model ? <ModelLogo modelId={step.model} provider={providerOf(step.connectionId ?? '')} size={size} /> : null;
  const who = (step: AgentStep) => (
    <span className="np-agent-who" title={`${step.model} · ${nameOf(step.connectionId ?? '')}`}>{logo(step, 14)}{short(step.model)}</span>
  );

  return (
    <div aria-label="Free Agent steps">
      <details className={`np-tool np-route np-agent ${live ? 'live' : ''}`} open={open} onToggle={event => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <RouterMark size={14} />
          <strong>Free Agent</strong>
          <span className="np-tool-summary">{strategy?.mode ? MODE[strategy.mode](drafts) : 'Choosing how to answer'}</span>
          <span className="np-agent-avatars">{models.slice(0, 5).map(step => <span key={step.id}>{logo(step, 16)}</span>)}</span>
          <span className="np-tool-meta">
            {models.length} model{models.length === 1 ? '' : 's'}{calls !== undefined ? ` · ${calls} request${calls === 1 ? '' : 's'}` : ''}
          </span>
        </summary>
        <div className="np-tool-body">
          {strategy && <p className="np-agent-strategy">{strategy.reason}</p>}

          {/* Who handed work to whom, left to right. */}
          {work.length > 0 && (
            <div className="np-agent-flow" aria-label="How the models worked together">
              {planner && <><span className="np-agent-flow-group"><em>Plan</em>{who(planner)}</span><ArrowRight size={12} aria-hidden /></>}
              {searches.length > 0 && (
                <><span className="np-agent-flow-group"><em>Search</em><span className="np-agent-who"><Search size={11} aria-hidden />{searches.length} search{searches.length === 1 ? '' : 'es'}</span></span><ArrowRight size={12} aria-hidden /></>
              )}
              {inputs.length > 0 && (
                <>
                  <span className="np-agent-flow-group">
                    <em>{research ? `Read ${inputs.length} source${inputs.length === 1 ? '' : 's'}` : inputs[0].role === 'specialist' ? 'Parts' : 'Drafts'}</em>
                    {(research ? inputModels : inputs).map(step => <span key={step.id}>{who(step)}</span>)}
                  </span>
                  {(outliner || writer) && <ArrowRight size={12} aria-hidden />}
                </>
              )}
              {outliner && <><span className="np-agent-flow-group"><em>Outline</em>{who(outliner)}</span>{writer && <ArrowRight size={12} aria-hidden />}</>}
              {writer && <span className="np-agent-flow-group"><em>{research ? 'Writes the report' : inputs.length ? 'Checks and writes' : 'Answers'}</em>{who(writer)}</span>}
            </div>
          )}

          <ol className="np-agent-steps">
            {work.map(step => {
              const running = live && step.status === 'running';
              const thinking = step.role === 'writer' ? writerThinking : step.reasoning;
              return (
                <li key={step.id} className={`np-agent-step ${step.status}`}>
                  <div className="np-agent-step-head">
                    {step.status === 'failed' ? <AlertTriangle size={12} aria-hidden /> : step.status === 'running' ? <Loader2 size={12} className="np-spin" aria-hidden /> : <Check size={12} aria-hidden />}
                    <strong>{research && step.role === 'writer' ? 'Report' : roleLabel(step)}</strong>
                    {step.model && (
                      <span className="np-agent-model">
                        {logo(step)}
                        <span title={step.model}>{step.model}</span>
                        {step.connectionId && <small>{nameOf(step.connectionId)}</small>}
                      </span>
                    )}
                    <small className="np-agent-state">{state(step)}</small>
                  </div>

                  {step.role === 'searcher' && step.task && <p className="np-agent-handoff"><Search size={11} aria-hidden /><span className="np-agent-task">{step.task}</span></p>}
                  {step.role === 'reader' && step.url && (
                    <p className="np-agent-handoff">
                      <CornerDownRight size={11} aria-hidden />From the search:
                      <a href={step.url} target="_blank" rel="noopener noreferrer">{step.task || step.url}<ExternalLink size={9} aria-hidden /></a>
                    </p>
                  )}
                  {step.role === 'specialist' && step.task && (
                    <p className="np-agent-handoff"><CornerDownRight size={11} aria-hidden />From the plan: <span className="np-agent-task">{step.task}</span></p>
                  )}
                  {step.role === 'writer' && received.length > 0 && (
                    <p className="np-agent-handoff">
                      <CornerDownRight size={11} aria-hidden />
                      <span>{research
                        ? `Received the checked notes from ${received.length} source${received.length === 1 ? '' : 's'}${outliner?.status === 'done' ? ' and the outline' : ''}`
                        : `Received ${received.map(input => `${roleLabel(input)} from ${short(input.model)}`).join(', ')} to check and combine`}</span>
                    </p>
                  )}
                  {step.reason && <p className={step.status === 'failed' ? 'np-route-error' : 'np-agent-why'}>{step.reason}</p>}

                  {thinking && <Stream label="Thinking" doneLabel="Show its thinking" text={thinking} live={running} thinking />}
                  {step.role !== 'writer' && step.text && (
                    <Stream
                      label={step.role === 'planner' ? 'Planning' : step.role === 'reader' ? 'Reading' : step.role === 'outliner' ? 'Outlining' : 'Writing'}
                      doneLabel={step.role === 'planner' ? 'Read the plan' : step.role === 'specialist' ? 'Read this part' : step.role === 'reader' ? 'Read the notes' : step.role === 'outliner' ? 'Read the outline' : 'Read the draft'}
                      text={step.text}
                      live={running}
                    />
                  )}
                  {step.role === 'writer' && running && <p className="np-agent-handoff">Writing the answer below</p>}
                  {step.role === 'planner' && step.status === 'done' && inputs.some(input => input.role === 'specialist') && (
                    <p className="np-agent-handoff"><ArrowRight size={11} aria-hidden />Sent {inputs.filter(input => input.role === 'specialist').length} parts to specialists</p>
                  )}
                  {(step.role === 'drafter' || step.role === 'specialist') && step.status === 'done' && writer?.model && (
                    <p className="np-agent-handoff"><ArrowRight size={11} aria-hidden />Sent to {short(writer.model)} to check</p>
                  )}
                  {step.role === 'reader' && step.status === 'done' && writer?.model && received.includes(step) && (
                    <p className="np-agent-handoff"><ArrowRight size={11} aria-hidden />Notes sent to {short(writer.model)} for the report</p>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </details>
    </div>
  );
}
