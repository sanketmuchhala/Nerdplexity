import { useEffect, useState } from 'react';
import type { AgentBehavior, AgentConfig, ModelChoice, ModelRef, SpecialistEntry, TaskKind } from '@app/types';
import { api } from '../lib/api';
import { AGENT_NAME, AGENT_REF, isAgent, isRouter, ROUTER_NAME, ROUTER_REF } from '../lib/router';
import useChat from '../state/chatStore';
import useConnections, { currentRouterPool } from '../state/connections';
import { RouterMark } from './RouterMark';

const BEHAVIOR: { value: AgentBehavior; label: string; detail: string }[] = [
  { value: 'auto', label: 'Automatic (recommended)', detail: 'Always at least two models: a simple message gets one draft checked by a second model; harder ones get more drafts, or parts for specialists, all checked by the strongest.' },
  { value: 'quick', label: 'Quick', detail: 'One model answers alone. Fastest, and one request per message unless a model is busy.' },
  { value: 'thorough', label: 'Thorough', detail: 'Always drafts (or parts) checked by the strongest model. Best answers, more requests per message.' },
];

const KINDS: { kind: TaskKind; label: string }[] = [
  { kind: 'code', label: 'Code' }, { kind: 'math', label: 'Math' }, { kind: 'reasoning', label: 'Reasoning' },
  { kind: 'writing', label: 'Writing' }, { kind: 'extraction', label: 'Structured output' }, { kind: 'general', label: 'General questions' },
];

const keyOf = (choice?: ModelChoice) => choice ? `${choice.connectionId}\n${choice.model}` : '';
const choiceOf = (key: string): ModelChoice | undefined => {
  if (!key) return undefined;
  const [connectionId, ...rest] = key.split('\n');
  return { connectionId, model: rest.join('\n') };
};

/** Nerdplexity's own choices (Free Agent, Free Router) and how the Free Agent works: behavior, drafts, and which model does each part. */
export function AgentSettings({ onUse }: { onUse: (ref: ModelRef) => void }) {
  const { settings, saveSettings } = useChat();
  const { connections, catalog } = useConnections();
  useConnections(state => state.keyVersion);
  const pool = currentRouterPool(connections, catalog);
  const models = pool.route?.models ?? [];
  const [config, setConfig] = useState<AgentConfig>(settings?.agent ?? {});
  const [error, setError] = useState('');
  const [automatic, setAutomatic] = useState<Record<TaskKind, SpecialistEntry[]> | null>(null);
  useEffect(() => { setConfig(settings?.agent ?? {}); }, [settings?.agent]);

  // What "Automatic" would pick right now, from the same ranking the agent uses.
  const poolKey = models.map(m => `${m.connectionId}\n${m.model}`).join('|');
  useEffect(() => {
    if (!pool.route) { setAutomatic(null); return; }
    let current = true;
    api<{ specialists: Record<TaskKind, SpecialistEntry[]> }>('/v1/agent/specialists', { body: { route: pool.route } })
      .then(data => { if (current) setAutomatic(data.specialists); }, () => { if (current) setAutomatic(null); });
    return () => { current = false; };
  }, [poolKey]);

  const nameOf = (connectionId: string) => connections.find(c => c.id === connectionId)?.name ?? connectionId;
  const labelOf = (choice?: { connectionId: string; model: string; displayName?: string }) => choice ? `${choice.displayName ?? choice.model} · ${nameOf(choice.connectionId)}` : '';
  const save = async (next: AgentConfig) => {
    const previous = config;
    setConfig(next);
    setError('');
    try { await saveSettings({ agent: next }); }
    catch { setConfig(previous); setError('Unable to save the agent settings.'); }
  };
  const update = (patch: Partial<AgentConfig>) => {
    const next: AgentConfig = { ...config, ...patch };
    for (const key of Object.keys(next) as (keyof AgentConfig)[]) if (next[key] === undefined) delete next[key];
    void save(next);
  };

  const drafts = config.drafts ?? 2;
  const top = (kind: TaskKind) => automatic?.[kind]?.[0];
  const select = (label: string, value: ModelChoice | undefined, onChange: (choice: ModelChoice | undefined) => void, hint: string) => (
    <label className="np-field np-agent-role" key={label}>
      <span>{label}</span>
      <select aria-label={label} value={keyOf(value)} onChange={e => onChange(choiceOf(e.target.value))} disabled={!models.length}>
        <option value="">Automatic{hint ? ` (${hint})` : ''}</option>
        {models.map(m => <option key={keyOf(m)} value={keyOf(m)}>{labelOf(m)}</option>)}
      </select>
    </label>
  );

  const agentActive = isAgent(settings?.activeModel);
  const routerActive = isRouter(settings?.activeModel) && !agentActive;
  return (
    <section className="np-panel np-agent-settings" aria-labelledby="nerdplexity-title">
      <div className="np-section-title">
        <div>
          <h2 id="nerdplexity-title">Let Nerdplexity choose</h2>
          <p>Nerdplexity picks from your {models.length} free model{models.length === 1 ? '' : 's'} for you. The Free Agent is the default; choose a single model below instead whenever you like.</p>
        </div>
      </div>
      <div className="np-agent-choices">
        {[
          { ref: AGENT_REF, name: AGENT_NAME, active: agentActive, badge: 'Default', detail: 'Asks the free models best at each kind of task and has the strongest check their work and write one answer.' },
          { ref: ROUTER_REF, name: ROUTER_NAME, active: routerActive, badge: '', detail: 'Sends each message to the single best free model, and to the next if one is busy. One request per message.' },
        ].map(choice => (
          <div key={choice.name} className={`np-agent-choice ${choice.active ? 'active' : ''}`}>
            <div>
              <strong><RouterMark size={16} /> {choice.name}{choice.badge && <span className="np-label">{choice.badge}</span>}</strong>
              <p>{choice.detail}</p>
            </div>
            <button className={`np-button small ${choice.active ? 'ghost' : 'primary'}`} disabled={choice.active || !models.length} onClick={() => onUse(choice.ref)}>
              {choice.active ? 'In use' : `Use ${choice.name}`}
            </button>
          </div>
        ))}
      </div>

      <div className="np-agent-config" aria-label="Agent settings">
        <h3>How the Free Agent works</h3>
        <div className="np-agent-behavior" role="radiogroup" aria-label="Agent behavior">
          {BEHAVIOR.map(option => (
            <label key={option.value} className="np-check">
              <input type="radio" name="agent-behavior" checked={(config.behavior ?? 'auto') === option.value} onChange={() => update({ behavior: option.value === 'auto' ? undefined : option.value })} />
              <span><strong>{option.label}</strong>{option.detail}</span>
            </label>
          ))}
        </div>

        <label className="np-field np-agent-drafts">
          <span>Drafts per answer</span>
          <select aria-label="Drafts per answer" value={drafts} onChange={e => update({ drafts: Number(e.target.value) === 2 ? undefined : Number(e.target.value), drafters: config.drafters?.slice(0, Number(e.target.value)) })}>
            {[1, 2, 3].map(n => <option key={n} value={n}>{n}{n === 2 ? ' (default)' : ''}</option>)}
          </select>
        </label>

        <h3>Who does what</h3>
        <p className="np-agent-note">Leave a part on Automatic to use the model the ranking picks from your Bench results, model size, and reliability. A chosen model that cannot take a message (busy, or missing something the message needs) is replaced for that message.</p>
        <div className="np-agent-roles">
          {select('Final answer', config.writer, writer => update({ writer }), 'strongest for each message')}
          {select('Planner', config.planner, planner => update({ planner }), top('extraction') ? `now ${top('extraction')!.displayName ?? top('extraction')!.model}` : '')}
          {/* Chosen drafters are an ordered list; the ranking fills the places after it. */}
          {Array.from({ length: drafts }, (_, i) => select(`Draft ${i + 1}`, config.drafters?.[i], choice => {
            const drafters: (ModelChoice | undefined)[] = [...(config.drafters ?? [])];
            drafters[i] = choice;
            const kept = drafters.filter((entry): entry is ModelChoice => !!entry);
            update({ drafters: kept.length ? kept : undefined });
          }, 'next best, another maker'))}
        </div>
        <h3>Specialists for parts</h3>
        <div className="np-agent-roles">
          {KINDS.map(({ kind, label }) => select(label, config.specialists?.[kind], choice => {
            const specialists = { ...(config.specialists ?? {}) };
            if (choice) specialists[kind] = choice; else delete specialists[kind];
            update({ specialists: Object.keys(specialists).length ? specialists : undefined });
          }, top(kind) ? `now ${top(kind)!.displayName ?? top(kind)!.model}` : ''))}
        </div>
        {error && <p className="np-error" role="alert">{error}</p>}
        <div className="np-conn-actions">
          <button className="np-button ghost small" disabled={!Object.keys(config).length} onClick={() => void save({})}>Reset to automatic</button>
        </div>
      </div>
    </section>
  );
}
