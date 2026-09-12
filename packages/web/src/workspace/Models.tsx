import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  HardDrive,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import type {
  BillingStatus,
  Connection,
  ConnectionKind,
  ModelDescriptor,
  ModelRef,
  RateLimitState,
} from '@app/types';
import useChat from '../state/chatStore';
import useConnections, {
  CatalogState,
  CheckState,
  isLocal,
  latestResult,
  modelKey,
  requiresKey,
  targetFor,
  usesBaseURL,
} from '../state/connections';
import { hasKey } from '../lib/credentials';
import { WebSearchSettings } from './WebSearchSettings';
import ModelLogo, { formatModelName } from './ModelLogo';
import { WorkbenchDialog } from './WorkbenchDialog';
import { costStatus } from '../lib/cost';
import { DEFAULT_COMPATIBLE_URL, DEFAULT_OLLAMA_URL } from '../lib/db';
import { sizeLabel, tokensLabel } from './api';

interface Preset {
  id: string;
  label: string;
  kind: ConnectionKind;
  name: string;
  baseURL?: string;
  hint: string;
  link?: { href: string; label: string };
}

const PRESETS: Preset[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    kind: 'ollama',
    name: 'Ollama',
    baseURL: DEFAULT_OLLAMA_URL,
    hint: 'Models installed with Ollama on this machine.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio / llama.cpp',
    kind: 'openai-compatible',
    name: 'LM Studio',
    baseURL: DEFAULT_COMPATIBLE_URL,
    hint: 'Start the local server in LM Studio, or run llama-server.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    name: 'OpenAI',
    hint: 'Uses your OpenAI API key.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    name: 'Anthropic',
    hint: 'Uses your Anthropic API key.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    name: 'Gemini',
    hint: 'Free-tier availability varies by model and account. On the free tier, Google may use your prompts to improve its products.',
    link: {
      href: 'https://ai.google.dev/gemini-api/docs/pricing',
      label: 'Gemini pricing and data use',
    },
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'deepseek',
    name: 'DeepSeek',
    hint: 'Uses your DeepSeek API key.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openrouter',
    name: 'OpenRouter',
    hint: 'Many providers behind one key. Models priced at $0 are marked free. Free models are limited per minute and per day, and a negative balance blocks them too.',
    link: {
      href: 'https://openrouter.ai/docs/api_reference/limits',
      label: 'OpenRouter limits',
    },
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'groq',
    name: 'Groq',
    hint: 'Fast hosted open models. The free plan has request and token limits per model.',
    link: {
      href: 'https://console.groq.com/docs/rate-limits',
      label: 'Groq rate limits',
    },
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible',
    kind: 'openai-compatible',
    name: '',
    baseURL: 'https://',
    hint: 'Any server with /models and /chat/completions, e.g. OpenRouter at https://openrouter.ai/api/v1. Remote servers must use https.',
  },
];

const CATEGORY_LABEL: Record<string, string> = {
  offline: 'Offline',
  auth: 'Key problem',
  'not-found': 'Wrong address',
  'rate-limited': 'Rate limited',
  timeout: 'Timed out',
  'invalid-response': 'Unexpected response',
  'invalid-destination': 'Address not allowed',
  unknown: 'Error',
};

type Filter = 'all' | 'free' | 'favorites' | 'local' | 'tools' | 'vision';
const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  free: 'Free to use',
  favorites: 'Favorites',
  local: 'This machine',
  tools: 'Tool calling',
  vision: 'Vision',
};

const BILLING_LABEL: Record<BillingStatus, string> = {
  unknown: 'Not sure',
  'no-billing': 'No billing enabled (free plan only)',
  paid: 'Billing enabled',
};

const duration = (ms?: number) =>
  ms === undefined
    ? ''
    : ms < 60_000
      ? `${Math.ceil(ms / 1000)}s`
      : ms < 3_600_000
        ? `${Math.round(ms / 60_000)}m`
        : `${Math.round(ms / 3_600_000)}h`;

function quotaLine(quota?: RateLimitState & { at: number }) {
  if (!quota) return '';
  const parts = [];
  if (quota.requestsRemaining !== undefined)
    parts.push(
      `${quota.requestsRemaining.toLocaleString()}${quota.requestsLimit !== undefined ? ` of ${quota.requestsLimit.toLocaleString()}` : ''} requests left${quota.requestsResetMs !== undefined ? ` (resets in ${duration(quota.requestsResetMs)})` : ''}`,
    );
  if (quota.tokensRemaining !== undefined)
    parts.push(
      `${quota.tokensRemaining.toLocaleString()}${quota.tokensLimit !== undefined ? ` of ${quota.tokensLimit.toLocaleString()}` : ''} tokens left`,
    );
  return parts.length
    ? `${parts.join(' · ')} · as of ${new Date(quota.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : '';
}

function checkLine(check?: CheckState) {
  if (!check) return null;
  if (check.status === 'running') return { text: 'Checking…', error: false };
  if (check.status === 'passed')
    return {
      text: `Check passed${check.ttftMs !== undefined ? ` · first text in ${(check.ttftMs / 1000).toFixed(1)}s` : ''}`,
      error: false,
    };
  return { text: `Check failed: ${check.error.message}`, error: true };
}
type Entry = { connection: Connection; model: ModelDescriptor; local: boolean };

const latest = latestResult;

type PullState = { connectionId: string; status: string; completed?: number; total?: number; error?: string } | null;

function keyBadge(connection: Connection) {
  if (!hasKey(connection.id))
    return requiresKey(connection.kind)
      ? { text: 'Key needed', error: true }
      : null;
  return {
    text:
      connection.keyStorage === 'device'
        ? 'Key remembered'
        : 'Key for this session',
    error: false,
  };
}

function statusLine(connection: Connection, state?: CatalogState) {
  if (!state || state.status === 'loading')
    return { ready: false, text: state ? 'Checking…' : 'Not checked' };
  const { result } = state;
  if (!result.ok)
    return {
      ready: false,
      text: CATEGORY_LABEL[result.error.category] ?? 'Error',
      error: result.error.message,
    };
  const n = result.models.length;
  return {
    ready: true,
    text: n
      ? `${n} model${n === 1 ? '' : 's'}`
      : isLocal(connection)
        ? 'No models installed'
        : 'No models available',
  };
}

function ConnectionForm({
  initial,
  onDone,
}: {
  initial?: Connection;
  onDone: () => void;
}) {
  const { save, discover } = useConnections();
  const [presetId, setPresetId] = useState(initial ? '' : 'ollama');
  const preset = PRESETS.find((p) => p.id === presetId);
  const kind = initial?.kind ?? preset?.kind ?? 'ollama';
  const [name, setName] = useState(initial?.name ?? preset?.name ?? '');
  const [baseURL, setBaseURL] = useState(
    initial?.baseURL ?? preset?.baseURL ?? '',
  );
  const [key, setKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [remember, setRemember] = useState(
    initial ? initial.keyStorage === 'device' : false,
  );
  const [billing, setBilling] = useState<BillingStatus>(
    initial?.billing ?? 'unknown',
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const existingKey = initial ? hasKey(initial.id) : false;

  const choosePreset = (id: string) => {
    const next = PRESETS.find((p) => p.id === id)!;
    setPresetId(id);
    setName(next.name);
    setBaseURL(next.baseURL ?? '');
    setError('');
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (requiresKey(kind) && !key.trim() && !existingKey) {
      setError('Enter an API key for this provider.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const connection = await save({
        id: initial?.id,
        kind,
        name,
        baseURL,
        key: key.trim() ? key : undefined,
        remember,
        billing,
      });
      onDone();
      void discover(connection.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const clear = async () => {
    if (!initial) return;
    await save({
      id: initial.id,
      kind,
      name: initial.name,
      baseURL: initial.baseURL,
      key: '',
      remember: false,
      billing,
    });
    onDone();
    void discover(initial.id);
  };

  return (
    <form
      className="np-conn-form"
      onSubmit={submit}
      aria-label={initial ? `Edit ${initial.name}` : 'Add connection'}
    >
      {!initial && (
        <label className="np-field">
          <span>Type</span>
          <select
            aria-label="Connection type"
            value={presetId}
            onChange={(e) => choosePreset(e.target.value)}
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {preset && (
        <p className="np-conn-hint">
          {preset.hint}
          {preset.link && (
            <>
              {' '}
              <a href={preset.link.href} target="_blank" rel="noreferrer">
                {preset.link.label} <ExternalLink size={10} />
              </a>
            </>
          )}
        </p>
      )}
      <div className="np-conn-fields">
        <label className="np-field">
          <span>Name</span>
          <input
            aria-label="Connection name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
          />
        </label>
        {usesBaseURL(kind) && (
          <label className="np-field">
            <span>Server address</span>
            <input
              aria-label="Server address"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
        )}
      </div>
      <label className="np-field">
        <span>API key {requiresKey(kind) ? '' : '(optional)'}</span>
        <div className="np-key-input">
          <input
            aria-label="API key"
            type={showKey ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKeyValue(e.target.value)}
            placeholder={
              existingKey
                ? 'Saved. Enter a new key to replace it.'
                : kind === 'ollama'
                  ? 'Not needed for local Ollama'
                  : 'Paste your key'
            }
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            className="np-icon-button"
            aria-label={showKey ? 'Hide key' : 'Show key'}
            onClick={() => setShowKey(!showKey)}
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </label>
      {requiresKey(kind) && (
        <label className="np-field">
          <span>Account billing</span>
          <select
            aria-label="Account billing"
            value={billing}
            onChange={(e) => setBilling(e.target.value as BillingStatus)}
          >
            {(Object.keys(BILLING_LABEL) as BillingStatus[]).map((b) => (
              <option key={b} value={b}>
                {BILLING_LABEL[b]}
              </option>
            ))}
          </select>
          <small className="np-conn-hint">
            Nerdplexity cannot read your billing settings. Free only mode uses
            this answer. With no billing enabled, a provider cannot charge the
            account.
          </small>
        </label>
      )}
      <label className="np-check">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        <span>
          <strong>Remember this key on this device</strong>Saved unencrypted in
          this browser profile's storage. Otherwise the key is forgotten when
          you close or reload the tab.
        </span>
      </label>
      {error && (
        <p className="np-error" role="alert">
          {error}
        </p>
      )}
      <div className="np-conn-actions np-modal-footer">
        {existingKey && (
          <button
            type="button"
            className="np-button ghost small np-forget-key"
            onClick={() => void clear()}
          >
            Forget Key
          </button>
        )}
        <button
          type="button"
          className="np-button ghost"
          onClick={onDone}
        >
          Cancel
        </button>
        <button className="np-button primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save Connection'}
        </button>
      </div>
    </form>
  );
}

export function Models({
  onChat,
  connectionsOnly = false,
}: {
  onChat: () => void;
  connectionsOnly?: boolean;
}) {
  const {
    settings,
    saveSettings,
    activeConversation,
    setConversationModel,
    newConversation,
  } = useChat();
  const {
    connections,
    catalog,
    discover,
    discoverAll,
    remove,
    quota,
    checks,
    checkModel,
  } = useConnections();
  const persistedFreeOnly = settings?.costPolicy === 'free-only';
  const [freeOnly, setFreeOnly] = useState(persistedFreeOnly);
  useEffect(() => setFreeOnly(persistedFreeOnly), [persistedFreeOnly]);
  useConnections((state) => state.keyVersion);
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [source, setSource] = useState('all');
  const [manual, setManual] = useState({ connectionId: '', modelId: '' });
  const [actionError, setActionError] = useState('');
  const [pullModel, setPullModel] = useState('');
  const [pullConnection, setPullConnection] = useState('');
  const [pull, setPull] = useState<PullState>(null);
  const pullController = useRef<AbortController | null>(null);
  const favorites = useMemo(
    () => new Set(settings?.favoriteModels ?? []),
    [settings?.favoriteModels],
  );
  const active = settings?.activeModel;
  const anyLoading = Object.values(catalog).some((c) => c.status === 'loading');

  const entries = useMemo(() => {
    const list: Entry[] = [];
    for (const connection of connections) {
      const result = latest(catalog[connection.id]);
      if (result?.ok)
        for (const model of result.models)
          list.push({ connection, model, local: result.execution === 'local' });
    }
    const q = search.trim().toLowerCase();
    return list
      .filter(
        ({ connection, model, local }) =>
          (source === 'all' || connection.id === source) &&
          (filter !== 'free' ||
            costStatus(connection, model, local ? 'local' : 'remote').free) &&
          (!q ||
            model.id.toLowerCase().includes(q) ||
            model.displayName.toLowerCase().includes(q)) &&
          (filter === 'all' ||
            filter === 'free' ||
            (filter === 'favorites' &&
              favorites.has(modelKey(connection.id, model.id))) ||
            (filter === 'local' && local) ||
            (filter === 'tools' && model.capabilities.tools === true) ||
            (filter === 'vision' && model.capabilities.vision === true)),
      )
      .sort(
        (a, b) =>
          Number(favorites.has(modelKey(b.connection.id, b.model.id))) -
          Number(favorites.has(modelKey(a.connection.id, a.model.id))),
      );
  }, [connections, catalog, search, filter, source, favorites]);
  const totalModels = connections.reduce((n, c) => {
    const r = latest(catalog[c.id]);
    return n + (r?.ok ? r.models.length : 0);
  }, 0);
  const host = connections
    .map((c) => latest(catalog[c.id]))
    .find((r) => r?.ok && r.host);

  const use = async (ref: ModelRef) => {
    setActionError('');
    try {
      await saveSettings({ activeModel: ref });
      const conversation = activeConversation();
      // Switching inside a thread with history is P4; start a new thread instead.
      if (conversation && conversation.messages.length === 0)
        await setConversationModel(conversation.id, ref);
      else await newConversation();
      onChat();
    } catch (err) {
      setActionError((err as Error).message);
    }
  };
  const toggleFavorite = (key: string) => {
    const next = new Set(favorites);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    void saveSettings({ favoriteModels: [...next] });
  };
  const runCheck = (
    connection: Connection,
    model: ModelDescriptor,
    free: boolean,
  ) => {
    if (
      !free &&
      !window.confirm(
        `Checking sends one short prompt to ${model.id}. ${connection.name} may bill it. Continue?`,
      )
    )
      return;
    void checkModel(connection.id, model.id);
  };
  const removeConnection = async (connection: Connection) => {
    if (
      !window.confirm(
        `Remove “${connection.name}”? Its saved key is deleted. Threads that used it keep their history.`,
      )
    )
      return;
    await remove(connection.id);
  };
  const installModel = async (event: FormEvent) => {
    event.preventDefault();
    const connection = connections.find(c => c.id === pullConnection && c.kind === 'ollama');
    const model = pullModel.trim();
    if (!connection || !model || pull) return;
    setActionError('');
    setPull({ connectionId: connection.id, status: 'Starting download' });
    const controller = new AbortController();
    pullController.current = controller;
    try {
      const response = await fetch('/v1/models/ollama/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: targetFor(connection), model }), signal: controller.signal });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Download failed (${response.status}).`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let failure = '';
      while (true) {
        const { value, done } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const progress = JSON.parse(line);
          if (progress.error) failure = progress.error;
          setPull({ connectionId: connection.id, status: progress.status || 'Downloading', completed: progress.completed, total: progress.total, error: progress.error });
        }
        if (done) break;
      }
      if (failure) throw new Error(failure);
      setPullModel('');
      await discover(connection.id);
    } catch (error) { setActionError(controller.signal.aborted ? 'Download canceled.' : (error as Error).message); }
    finally { pullController.current = null; setPull(null); }
  };
  const deleteLocalModel = async (connection: Connection, model: ModelDescriptor) => {
    if (!window.confirm(`Remove “${model.id}” from ${connection.name}? This deletes its local Ollama files.`)) return;
    setActionError('');
    try {
      const response = await fetch('/v1/models/ollama', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: targetFor(connection), model: model.id }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Removal failed (${response.status}).`);
      await discover(connection.id);
    } catch (error) { setActionError((error as Error).message); }
  };

  return (
    <div className="np-page">
      <div className="np-page-heading">
        <div>
          <span className="np-eyebrow">MODELS</span>
          <h1>
            {connectionsOnly
              ? 'Your connections.'
              : 'Connect a model. Pick one.'}
          </h1>
          <p>Local runtimes and your own API keys, in one catalog.</p>
        </div>
        <span className="np-label">
          <HardDrive size={13} /> Keys stay in this browser
        </span>
      </div>

      <section className="np-panel" aria-labelledby="connections-title">
        <div className="np-section-title">
          <div>
            <h2 id="connections-title">Connections</h2>
            <p>
              Listing models checks the address and key. It does not run a
              model.
            </p>
          </div>
          <div className="np-conn-actions">
            <button
              className="np-button ghost small"
              onClick={() => void discoverAll()}
              disabled={anyLoading}
            >
              <RefreshCw size={13} className={anyLoading ? 'np-spin' : ''} />
              Refresh All
            </button>
            <button
              className="np-button primary small"
              onClick={() => setEditing('new')}
              disabled={editing === 'new'}
            >
              <Plus size={13} />
              Add Provider
            </button>
          </div>
        </div>
        {editing === 'new' && (
          <WorkbenchDialog title="Add Provider" onClose={() => setEditing(null)}>
            <ConnectionForm onDone={() => setEditing(null)} />
          </WorkbenchDialog>
        )}
        <ul className="np-conn-list">
          {connections.map((connection) => {
            const state = catalog[connection.id];
            const status = statusLine(connection, state);
            const badge = keyBadge(connection);
            return (
              <li key={connection.id} className="np-conn-row">
                {editing === connection.id && (
                  <WorkbenchDialog title={`Edit ${connection.name}`} onClose={() => setEditing(null)}>
                    <ConnectionForm
                      initial={connection}
                      onDone={() => setEditing(null)}
                    />
                  </WorkbenchDialog>
                )}
                <>
                    <div className="np-conn-main">
                      <span
                        className={`np-status ${status.ready ? 'ready' : ''}`}
                      >
                        <i />
                      </span>
                      <div className="np-conn-name">
                        <strong>{connection.name}</strong>
                        <span>
                          {usesBaseURL(connection.kind)
                            ? connection.baseURL
                            : 'Hosted API'}
                          {' · '}
                          {isLocal(connection) ? 'This machine' : 'Remote'}
                        </span>
                      </div>
                      <div className="np-conn-badges">
                        {badge && (
                          <span
                            className={`np-label ${badge.error ? 'error' : ''}`}
                          >
                            {badge.text}
                          </span>
                        )}
                        <span
                          className={`np-label ${status.error ? 'error' : ''}`}
                          role="status"
                        >
                          {status.text}
                        </span>
                      </div>
                      <div className="np-conn-buttons">
                        <button
                          className="np-icon-button"
                          aria-label={`Refresh ${connection.name}`}
                          title="Refresh models"
                          onClick={() => void discover(connection.id)}
                          disabled={state?.status === 'loading'}
                        >
                          <RefreshCw
                            size={14}
                            className={
                              state?.status === 'loading' ? 'np-spin' : ''
                            }
                          />
                        </button>
                        <button
                          className="np-icon-button"
                          aria-label={`Edit ${connection.name}`}
                          title="Edit"
                          onClick={() => setEditing(connection.id)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="np-icon-button"
                          aria-label={`Remove ${connection.name}`}
                          title="Remove"
                          onClick={() => void removeConnection(connection)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    {status.error && (
                      <p className="np-conn-error">{status.error}</p>
                    )}
                    {quotaLine(quota[connection.id]) && (
                      <p className="np-conn-quota">
                        {quotaLine(quota[connection.id])}
                      </p>
                    )}
                </>
              </li>
            );
          })}
        </ul>
        {!connections.length && editing !== 'new' && (
          <p className="np-conn-hint">
            No connections yet. Add Ollama for local models, or a provider with
            your own key.
          </p>
        )}
        {host?.ok && host.host && (
          <div className="np-machine">
            <Cpu size={16} />
            <span>
              {host.host.platform} / {host.host.arch}
            </span>
            <span>{sizeLabel(host.host.memory)} memory</span>
            <span>{host.host.cpus} logical cores</span>
            <small>
              Machine running local models. Download size does not guarantee a
              model fits.
            </small>
          </div>
        )}
      </section>

      {connectionsOnly && <WebSearchSettings />}

      {!connectionsOnly && connections.some(c => c.kind === 'ollama') && (
        <section className="np-panel np-ollama-manager" aria-labelledby="ollama-manager-title">
          <div className="np-section-title">
            <div><h2 id="ollama-manager-title">Install an Ollama model</h2><p>Downloads stay on the machine running Ollama. Progress comes directly from the runtime.</p></div>
          </div>
          <form className="np-inline-form" onSubmit={installModel}>
            <label className="np-field"><span>Ollama connection</span><select aria-label="Ollama connection" value={pullConnection} required onChange={e => setPullConnection(e.target.value)}><option value="">Choose…</option>{connections.filter(c => c.kind === 'ollama').map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
            <label className="np-field"><span>Model name</span><input aria-label="Ollama model name" placeholder="qwen3:8b" value={pullModel} onChange={e => setPullModel(e.target.value)} /></label>
            <button className="np-button primary" disabled={!!pull}>Install</button>
          </form>
          {pull && <div className="np-pull-progress" role="status"><div><span>{pull.status}</span><small>{pull.total ? `${Math.floor(((pull.completed ?? 0) / pull.total) * 100)}% · ${sizeLabel(pull.completed ?? 0)} of ${sizeLabel(pull.total)}` : 'Preparing layers…'}</small></div>{pull.total && <progress value={pull.completed ?? 0} max={pull.total} />}<button className="np-button ghost small" type="button" onClick={() => pullController.current?.abort()}>Cancel download</button></div>}
        </section>
      )}

      {!connectionsOnly && (
        <>
          <div className="np-section-title np-model-title">
            <div>
              <h2>
                All models <span className="np-count">{totalModels}</span>
              </h2>
              <p>
                {active ? (
                  <>
                    Default for new threads: <strong>{active.modelId}</strong>
                  </>
                ) : (
                  'Choose a model to use in new threads.'
                )}
              </p>
            </div>
          </div>
          <div className="np-giant-search-container">
            <div className="np-giant-search">
              <Search size={22} aria-hidden />
              <input
                aria-label="Search models"
                placeholder="Search models…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="np-giant-filters">
              <select
                aria-label="Filter by connection"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="all">All connections</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div
                className="np-filter-row"
                role="group"
                aria-label="Model filters"
              >
                {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
                  <button
                    key={f}
                    className={`np-mode ${filter === f ? 'selected' : ''}`}
                    aria-pressed={filter === f}
                    onClick={() => setFilter(f)}
                  >
                    {FILTER_LABEL[f]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <label className={`np-policy ${freeOnly ? 'on' : ''}`}>
            <input
              type="checkbox"
              checked={freeOnly}
              onChange={(e) => {
                const checked = e.target.checked;
                setFreeOnly(checked);
                void saveSettings({
                  costPolicy: checked ? 'free-only' : 'any',
                });
              }}
            />
            <span>
              <strong>Free only</strong>Run only models on this machine, models
              listed at $0, or accounts you marked as having no billing.
              Anything with an unknown price is blocked until you allow it.
            </span>
          </label>
          {actionError && (
            <p className="np-error" role="alert">
              {actionError}
            </p>
          )}

          <div className="np-model-list">
            {entries.map(({ connection, model, local }) => {
              const key = modelKey(connection.id, model.id);
              const isActive =
                active?.connectionId === connection.id &&
                active.modelId === model.id;
              const facts = [
                model.details,
                model.sizeBytes !== undefined && sizeLabel(model.sizeBytes),
              ].filter(Boolean);
              const cost = costStatus(
                connection,
                model,
                local ? 'local' : 'remote',
              );
              const blocked = freeOnly && !cost.free;
              const check = checkLine(checks[key]);
              return (
                <article
                  className={`np-model-row ${isActive ? 'active' : ''}`}
                  key={key}
                >
                  <ModelLogo
                    modelId={model.id}
                    provider={connection.kind === 'openai-compatible' ? connection.name : connection.kind}
                    local={local}
                  />
                  <div className="np-model-row-info">
                    <h3 title={model.id}>
                      {formatModelName(model.displayName, model.id)}
                      {isActive && <span className="np-label">Active</span>}
                    </h3>
                    <p>
                      {[connection.name, model.id, ...facts].join(' · ')}
                    </p>
                    {check && (
                      <p
                        className={`np-check-result ${check.error ? 'error' : ''}`}
                        role="status"
                      >
                        {check.text}
                      </p>
                    )}
                  </div>
                  <div className="np-model-row-tags">
                    <span
                      className={`np-label np-cost ${cost.free ? 'free' : cost.cls}`}
                      title={cost.detail}
                    >
                      {cost.label}
                    </span>
                    {model.loaded && <span className="np-label">Loaded</span>}
                    {model.contextLength ? (
                      <span className="np-label">
                        {tokensLabel(model.contextLength)} ctx
                      </span>
                    ) : null}
                    {model.capabilities.tools === true && (
                      <span className="np-label">Tools</span>
                    )}
                    {model.capabilities.vision === true && (
                      <span className="np-label">Vision</span>
                    )}
                    {model.expiresAt && (
                      <span
                        className="np-label error"
                        title={`Retiring ${new Date(model.expiresAt).toLocaleDateString()}`}
                      >
                        Retiring
                      </span>
                    )}
                  </div>
                  <div className="np-model-row-actions">
                    {connection.kind === 'ollama' && (
                      <button className="np-button ghost small" onClick={() => void deleteLocalModel(connection, model)}><Trash2 size={12} /> Remove</button>
                    )}
                    <button
                      className="np-button ghost small"
                      disabled={checks[key]?.status === 'running'}
                      onClick={() => runCheck(connection, model, cost.free)}
                    >
                      Check
                    </button>
                    <button
                      className={`np-icon-button np-favorite ${favorites.has(key) ? 'on' : ''}`}
                      aria-pressed={favorites.has(key)}
                      aria-label={`${favorites.has(key) ? 'Remove' : 'Add'} ${model.id} ${favorites.has(key) ? 'from' : 'to'} favorites`}
                      onClick={() => toggleFavorite(key)}
                    >
                      <Star size={16} />
                    </button>
                    <button
                      className={`np-button small ${isActive ? 'ghost' : 'primary'}`}
                      disabled={blocked}
                      title={blocked ? 'Blocked by Free only' : undefined}
                      onClick={() =>
                        void use({
                          connectionId: connection.id,
                          modelId: model.id,
                        })
                      }
                    >
                      {isActive ? (
                        <>
                          <Check size={13} />
                          Selected
                        </>
                      ) : (
                        'Select Model'
                      )}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {totalModels === 0 && (
            <div className="np-empty-panel">
              <HardDrive size={26} />
              <h3>
                {anyLoading
                  ? 'Checking your connections…'
                  : 'Your models will appear here.'}
              </h3>
              <p>
                Start Ollama or LM Studio, or add a provider with your API key.
                Then refresh.
              </p>
            </div>
          )}
          {totalModels > 0 && entries.length === 0 && (
            <p className="np-empty-panel">No models match these filters.</p>
          )}

          <form
            className="np-panel np-manual"
            onSubmit={(e) => {
              e.preventDefault();
              if (manual.connectionId && manual.modelId.trim())
                void use({
                  connectionId: manual.connectionId,
                  modelId: manual.modelId.trim(),
                });
            }}
          >
            <div className="np-section-title">
              <div>
                <h2>Use a model ID directly</h2>
                <p>
                  For models a server does not list. The ID is sent as-is; the
                  connection decides whether it exists.
                </p>
              </div>
            </div>
            <div className="np-inline-form">
              <label className="np-field">
                <span>Connection</span>
                <select
                  aria-label="Connection for model ID"
                  value={manual.connectionId}
                  onChange={(e) =>
                    setManual({ ...manual, connectionId: e.target.value })
                  }
                >
                  <option value="">Choose…</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="np-field">
                <span>Model ID</span>
                <input
                  aria-label="Model ID"
                  value={manual.modelId}
                  onChange={(e) =>
                    setManual({ ...manual, modelId: e.target.value })
                  }
                  spellCheck={false}
                  placeholder="e.g. qwen3:8b"
                />
              </label>
              <button
                className="np-button"
                disabled={!manual.connectionId || !manual.modelId.trim()}
              >
                Use model ID
                <ArrowRight size={13} />
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
