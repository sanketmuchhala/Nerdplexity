import { FormEvent, useMemo, useState } from 'react';
import { ArrowRight, Check, Cpu, Eye, EyeOff, HardDrive, Pencil, Plus, RefreshCw, Server, Star, Trash2 } from 'lucide-react';
import type { Connection, ConnectionKind, DiscoveryResult, ModelDescriptor, ModelRef } from '@app/types';
import useChat from '../state/chatStore';
import useConnections, { CatalogState, isLocal, modelKey, requiresKey, usesBaseURL } from '../state/connections';
import { hasKey } from '../lib/credentials';
import { DEFAULT_COMPATIBLE_URL, DEFAULT_OLLAMA_URL } from '../lib/db';
import { sizeLabel, tokensLabel } from './api';

interface Preset { id: string; label: string; kind: ConnectionKind; name: string; baseURL?: string; hint: string }

const PRESETS: Preset[] = [
  { id: 'ollama', label: 'Ollama', kind: 'ollama', name: 'Ollama', baseURL: DEFAULT_OLLAMA_URL, hint: 'Models installed with Ollama on this machine.' },
  { id: 'lmstudio', label: 'LM Studio / llama.cpp', kind: 'openai-compatible', name: 'LM Studio', baseURL: DEFAULT_COMPATIBLE_URL, hint: 'Start the local server in LM Studio, or run llama-server.' },
  { id: 'openai', label: 'OpenAI', kind: 'openai', name: 'OpenAI', hint: 'Uses your OpenAI API key.' },
  { id: 'anthropic', label: 'Anthropic', kind: 'anthropic', name: 'Anthropic', hint: 'Uses your Anthropic API key.' },
  { id: 'gemini', label: 'Google Gemini', kind: 'gemini', name: 'Gemini', hint: 'Uses your Gemini API key. Free-tier availability depends on your account.' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'deepseek', name: 'DeepSeek', hint: 'Uses your DeepSeek API key.' },
  { id: 'custom', label: 'Custom OpenAI-compatible', kind: 'openai-compatible', name: '', baseURL: 'https://', hint: 'Any server with /models and /chat/completions, e.g. OpenRouter at https://openrouter.ai/api/v1. Remote servers must use https.' },
];

const CATEGORY_LABEL: Record<string, string> = {
  offline: 'Offline', auth: 'Key problem', 'not-found': 'Wrong address', 'rate-limited': 'Rate limited',
  timeout: 'Timed out', 'invalid-response': 'Unexpected response', 'invalid-destination': 'Address not allowed', unknown: 'Error',
};

type Filter = 'all' | 'favorites' | 'local' | 'tools' | 'vision';
type Entry = { connection: Connection; model: ModelDescriptor; local: boolean };

const latest = (state?: CatalogState): DiscoveryResult | undefined => state?.status === 'done' ? state.result : state?.previous;

function keyBadge(connection: Connection) {
  if (!hasKey(connection.id)) return requiresKey(connection.kind) ? { text: 'Key needed', error: true } : null;
  return { text: connection.keyStorage === 'device' ? 'Key remembered' : 'Key for this session', error: false };
}

function statusLine(connection: Connection, state?: CatalogState) {
  if (!state || state.status === 'loading') return { ready: false, text: state ? 'Checking…' : 'Not checked' };
  const { result } = state;
  if (!result.ok) return { ready: false, text: CATEGORY_LABEL[result.error.category] ?? 'Error', error: result.error.message };
  const n = result.models.length;
  return { ready: true, text: n ? `${n} model${n === 1 ? '' : 's'}` : isLocal(connection) ? 'No models installed' : 'No models available' };
}

function ConnectionForm({ initial, onDone }: { initial?: Connection; onDone: () => void }) {
  const { save, discover } = useConnections();
  const [presetId, setPresetId] = useState(initial ? '' : 'ollama');
  const preset = PRESETS.find(p => p.id === presetId);
  const kind = initial?.kind ?? preset?.kind ?? 'ollama';
  const [name, setName] = useState(initial?.name ?? preset?.name ?? '');
  const [baseURL, setBaseURL] = useState(initial?.baseURL ?? preset?.baseURL ?? '');
  const [key, setKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [remember, setRemember] = useState(initial ? initial.keyStorage === 'device' : false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const existingKey = initial ? hasKey(initial.id) : false;

  const choosePreset = (id: string) => {
    const next = PRESETS.find(p => p.id === id)!;
    setPresetId(id); setName(next.name); setBaseURL(next.baseURL ?? ''); setError('');
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (requiresKey(kind) && !key.trim() && !existingKey) { setError('Enter an API key for this provider.'); return; }
    setSaving(true); setError('');
    try {
      const connection = await save({ id: initial?.id, kind, name, baseURL, key: key.trim() ? key : undefined, remember });
      onDone();
      void discover(connection.id);
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  };
  const clear = async () => {
    if (!initial) return;
    await save({ id: initial.id, kind, name: initial.name, baseURL: initial.baseURL, key: '', remember: false });
    onDone();
    void discover(initial.id);
  };

  return <form className="np-conn-form" onSubmit={submit} aria-label={initial ? `Edit ${initial.name}` : 'Add connection'}>
    {!initial && <label className="np-field"><span>Type</span><select aria-label="Connection type" value={presetId} onChange={e => choosePreset(e.target.value)}>{PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>}
    {preset && <p className="np-conn-hint">{preset.hint}</p>}
    <div className="np-conn-fields">
      <label className="np-field"><span>Name</span><input aria-label="Connection name" value={name} onChange={e => setName(e.target.value)} maxLength={60}/></label>
      {usesBaseURL(kind) && <label className="np-field"><span>Server address</span><input aria-label="Server address" value={baseURL} onChange={e => setBaseURL(e.target.value)} spellCheck={false} autoComplete="off"/></label>}
    </div>
    <label className="np-field"><span>API key {requiresKey(kind) ? '' : '(optional)'}</span>
      <div className="np-key-input"><input aria-label="API key" type={showKey ? 'text' : 'password'} value={key} onChange={e => setKeyValue(e.target.value)} placeholder={existingKey ? 'Saved. Enter a new key to replace it.' : kind === 'ollama' ? 'Not needed for local Ollama' : 'Paste your key'} spellCheck={false} autoComplete="off"/>
        <button type="button" className="np-icon-button" aria-label={showKey ? 'Hide key' : 'Show key'} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={14}/> : <Eye size={14}/>}</button></div>
    </label>
    <label className="np-check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}/><span><strong>Remember this key on this device</strong>Saved unencrypted in this browser profile's storage. Otherwise the key is forgotten when you close or reload the tab.</span></label>
    {error && <p className="np-error" role="alert">{error}</p>}
    <div className="np-conn-actions">
      {existingKey && <button type="button" className="np-button ghost small" onClick={() => void clear()}>Forget key</button>}
      <button type="button" className="np-button ghost small" onClick={onDone}>Cancel</button>
      <button className="np-button primary small" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save and check' : 'Add and check'}</button>
    </div>
  </form>;
}

export function Models({ onChat }: { onChat: () => void }) {
  const { settings, saveSettings, activeConversation, setConversationModel, newConversation } = useChat();
  const { connections, catalog, discover, discoverAll, remove } = useConnections();
  useConnections(state => state.keyVersion);
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [source, setSource] = useState('all');
  const [manual, setManual] = useState({ connectionId: '', modelId: '' });
  const [actionError, setActionError] = useState('');
  const favorites = useMemo(() => new Set(settings?.favoriteModels ?? []), [settings?.favoriteModels]);
  const active = settings?.activeModel;
  const anyLoading = Object.values(catalog).some(c => c.status === 'loading');

  const entries = useMemo(() => {
    const list: Entry[] = [];
    for (const connection of connections) {
      const result = latest(catalog[connection.id]);
      if (result?.ok) for (const model of result.models) list.push({ connection, model, local: result.execution === 'local' });
    }
    const q = search.trim().toLowerCase();
    return list
      .filter(({ connection, model, local }) =>
        (source === 'all' || connection.id === source) &&
        (!q || model.id.toLowerCase().includes(q) || model.displayName.toLowerCase().includes(q)) &&
        (filter === 'all' || (filter === 'favorites' && favorites.has(modelKey(connection.id, model.id))) || (filter === 'local' && local) ||
          (filter === 'tools' && model.capabilities.tools === true) || (filter === 'vision' && model.capabilities.vision === true)))
      .sort((a, b) => Number(favorites.has(modelKey(b.connection.id, b.model.id))) - Number(favorites.has(modelKey(a.connection.id, a.model.id))));
  }, [connections, catalog, search, filter, source, favorites]);
  const totalModels = connections.reduce((n, c) => { const r = latest(catalog[c.id]); return n + (r?.ok ? r.models.length : 0); }, 0);
  const host = connections.map(c => latest(catalog[c.id])).find(r => r?.ok && r.host);

  const use = async (ref: ModelRef) => {
    setActionError('');
    try {
      await saveSettings({ activeModel: ref });
      const conversation = activeConversation();
      // Switching inside a thread with history is P4; start a new thread instead.
      if (conversation && conversation.messages.length === 0) await setConversationModel(conversation.id, ref);
      else await newConversation();
      onChat();
    } catch (err) { setActionError((err as Error).message); }
  };
  const toggleFavorite = (key: string) => {
    const next = new Set(favorites);
    if (next.has(key)) next.delete(key); else next.add(key);
    void saveSettings({ favoriteModels: [...next] });
  };
  const removeConnection = async (connection: Connection) => {
    if (!window.confirm(`Remove “${connection.name}”? Its saved key is deleted. Threads that used it keep their history.`)) return;
    await remove(connection.id);
  };

  return <div className="np-page">
    <div className="np-page-heading"><div><span className="np-eyebrow">MODELS</span><h1>Connect a model. Pick one.</h1><p>Local runtimes and your own API keys, in one catalog.</p></div><span className="np-label"><HardDrive size={13}/> Keys stay in this browser</span></div>

    <section className="np-panel" aria-labelledby="connections-title">
      <div className="np-section-title"><div><h2 id="connections-title">Connections</h2><p>Listing models checks the address and key. It does not run a model.</p></div>
        <div className="np-conn-actions"><button className="np-button ghost small" onClick={() => void discoverAll()} disabled={anyLoading}><RefreshCw size={13} className={anyLoading ? 'np-spin' : ''}/>Refresh all</button><button className="np-button small" onClick={() => setEditing('new')} disabled={editing === 'new'}><Plus size={13}/>Add connection</button></div></div>
      {editing === 'new' && <ConnectionForm onDone={() => setEditing(null)}/>}
      <ul className="np-conn-list">
        {connections.map(connection => {
          const state = catalog[connection.id];
          const status = statusLine(connection, state);
          const badge = keyBadge(connection);
          return <li key={connection.id} className="np-conn-row">
            {editing === connection.id ? <ConnectionForm initial={connection} onDone={() => setEditing(null)}/> : <>
              <div className="np-conn-main">
                <span className={`np-status ${status.ready ? 'ready' : ''}`}><i/></span>
                <div className="np-conn-name"><strong>{connection.name}</strong><span>{usesBaseURL(connection.kind) ? connection.baseURL : 'Hosted API'}{' · '}{isLocal(connection) ? 'This machine' : 'Remote'}</span></div>
                <div className="np-conn-badges">{badge && <span className={`np-label ${badge.error ? 'error' : ''}`}>{badge.text}</span>}<span className={`np-label ${status.error ? 'error' : ''}`} role="status">{status.text}</span></div>
                <div className="np-conn-buttons">
                  <button className="np-icon-button" aria-label={`Refresh ${connection.name}`} title="Refresh models" onClick={() => void discover(connection.id)} disabled={state?.status === 'loading'}><RefreshCw size={14} className={state?.status === 'loading' ? 'np-spin' : ''}/></button>
                  <button className="np-icon-button" aria-label={`Edit ${connection.name}`} title="Edit" onClick={() => setEditing(connection.id)}><Pencil size={14}/></button>
                  <button className="np-icon-button" aria-label={`Remove ${connection.name}`} title="Remove" onClick={() => void removeConnection(connection)}><Trash2 size={14}/></button>
                </div>
              </div>
              {status.error && <p className="np-conn-error">{status.error}</p>}
            </>}
          </li>;
        })}
      </ul>
      {!connections.length && editing !== 'new' && <p className="np-conn-hint">No connections yet. Add Ollama for local models, or a provider with your own key.</p>}
      {host?.ok && host.host && <div className="np-machine"><Cpu size={16}/><span>{host.host.platform} / {host.host.arch}</span><span>{sizeLabel(host.host.memory)} memory</span><span>{host.host.cpus} logical cores</span><small>Machine running local models. Download size does not guarantee a model fits.</small></div>}
    </section>

    <div className="np-section-title np-model-title"><div><h2>All models <span className="np-count">{totalModels}</span></h2><p>{active ? <>Default for new threads: <strong>{active.modelId}</strong></> : 'Choose a model to use in new threads.'}</p></div>
      <div className="np-catalog-controls">
        <select className="np-search" aria-label="Filter by connection" value={source} onChange={e => setSource(e.target.value)}><option value="all">All connections</option>{connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input className="np-search" aria-label="Search models" placeholder="Search models…" value={search} onChange={e => setSearch(e.target.value)}/>
      </div></div>
    <div className="np-filter-row" role="group" aria-label="Model filters">{(['all', 'favorites', 'local', 'tools', 'vision'] as Filter[]).map(f => <button key={f} className={`np-mode ${filter === f ? 'selected' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'favorites' ? 'Favorites' : f === 'local' ? 'This machine' : f === 'tools' ? 'Tool calling' : 'Vision'}</button>)}</div>
    {actionError && <p className="np-error" role="alert">{actionError}</p>}

    <div className="np-model-grid">
      {entries.map(({ connection, model, local }) => {
        const key = modelKey(connection.id, model.id);
        const isActive = active?.connectionId === connection.id && active.modelId === model.id;
        const facts = [model.details, model.contextLength && `${tokensLabel(model.contextLength)} context`, model.sizeBytes !== undefined && sizeLabel(model.sizeBytes)].filter(Boolean);
        return <article className={`np-model-card ${isActive ? 'active' : ''}`} key={key}>
          <div className="np-model-card-top"><div className="np-model-icon">{local ? <Cpu size={20}/> : <Server size={20}/>}</div>
            <div className="np-model-tags"><span className="np-label">{connection.name}</span>{model.loaded && <span className="np-label">Loaded</span>}</div>
            <button className={`np-icon-button np-favorite ${favorites.has(key) ? 'on' : ''}`} aria-pressed={favorites.has(key)} aria-label={`${favorites.has(key) ? 'Remove' : 'Add'} ${model.id} ${favorites.has(key) ? 'from' : 'to'} favorites`} onClick={() => toggleFavorite(key)}><Star size={14}/></button></div>
          <h3 title={model.id}>{model.displayName}</h3>
          {model.displayName !== model.id && <p className="np-model-id">{model.id}</p>}
          <p>{facts.join(' · ') || (local ? 'On this machine' : 'Hosted model')}</p>
          <div className="np-cap-row">{model.capabilities.tools === true && <span className="np-label">Tools</span>}{model.capabilities.vision === true && <span className="np-label">Vision</span>}{model.pricing === 'local' && <span className="np-label">No hosted fee</span>}</div>
          <div className="np-model-card-bottom"><span>{isActive ? 'Default' : ''}</span><button className="np-button small" onClick={() => void use({ connectionId: connection.id, modelId: model.id })}>{isActive ? <><Check size={13}/>Use again</> : <>Use model<ArrowRight size={13}/></>}</button></div>
        </article>;
      })}
    </div>
    {totalModels === 0 && <div className="np-empty-panel"><HardDrive size={26}/><h3>{anyLoading ? 'Checking your connections…' : 'Your models will appear here.'}</h3><p>Start Ollama or LM Studio, or add a provider with your API key. Then refresh.</p></div>}
    {totalModels > 0 && entries.length === 0 && <p className="np-empty-panel">No models match these filters.</p>}

    <form className="np-panel np-manual" onSubmit={e => { e.preventDefault(); if (manual.connectionId && manual.modelId.trim()) void use({ connectionId: manual.connectionId, modelId: manual.modelId.trim() }); }}>
      <div className="np-section-title"><div><h2>Use a model ID directly</h2><p>For models a server does not list. The ID is sent as-is; the connection decides whether it exists.</p></div></div>
      <div className="np-inline-form">
        <label className="np-field"><span>Connection</span><select aria-label="Connection for model ID" value={manual.connectionId} onChange={e => setManual({ ...manual, connectionId: e.target.value })}><option value="">Choose…</option>{connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="np-field"><span>Model ID</span><input aria-label="Model ID" value={manual.modelId} onChange={e => setManual({ ...manual, modelId: e.target.value })} spellCheck={false} placeholder="e.g. qwen3:8b"/></label>
        <button className="np-button" disabled={!manual.connectionId || !manual.modelId.trim()}>Use model ID<ArrowRight size={13}/></button>
      </div>
    </form>
  </div>;
}
