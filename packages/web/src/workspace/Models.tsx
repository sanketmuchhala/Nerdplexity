import { useEffect, useState } from 'react';
import { ArrowRight, Check, Cpu, ExternalLink, HardDrive, RefreshCw, Server, Terminal } from 'lucide-react';
import useChat from '../state/chatStore';
import type { RuntimeKind } from '../lib/db';
import { runtimeBase, runtimeName, RuntimeStatus, sizeLabel } from './api';

interface Props { status: RuntimeStatus | null; loading: boolean; error: string; reconnect: (base?: string) => Promise<boolean>; onChat: () => void; onSettings: () => void }

export function Models({ status, loading, error, reconnect, onChat, onSettings }: Props) {
  const { settings, saveSettings, newConversation } = useChat();
  const runtime = settings?.localRuntime || 'ollama';
  const [url, setUrl] = useState(runtimeBase(settings, runtime));
  const [search, setSearch] = useState('');
  const [selecting, setSelecting] = useState('');
  const [actionError, setActionError] = useState('');
  useEffect(() => { setUrl(runtimeBase(settings, runtime)); }, [runtime, settings?.baseURL, settings?.compatibleBaseURL]);

  const choose = async (model: string) => {
    setSelecting(model); setActionError('');
    try {
      await saveSettings({ selectedProvider: 'local-ollama', localModels: { ...settings?.localModels, [runtime]: model } });
      await newConversation({ provider: 'local-ollama', runtime, model });
      onChat();
    } catch (err) { setActionError((err as Error).message); }
    finally { setSelecting(''); }
  };

  return <div className="np-page">
    <div className="np-page-heading"><div><span className="np-eyebrow">MODEL STUDIO</span><h1>Bring your own intelligence.</h1><p>Connect a local runtime. Pick a model. Make it yours.</p></div><span className="np-label"><HardDrive size={13}/> Runs on your hardware</span></div>
    <div className="np-runtime-options">
      {(['ollama', 'openai-compatible'] as RuntimeKind[]).map(kind => <button key={kind} className={`np-runtime-option ${runtime === kind ? 'selected' : ''}`} onClick={() => void saveSettings({ localRuntime: kind })}>
        {kind === 'ollama' ? <Terminal size={23}/> : <Server size={23}/>}<div><strong>{kind === 'ollama' ? 'Ollama' : 'OpenAI compatible'}</strong><span>{kind === 'ollama' ? 'Connect your installed models' : 'LM Studio, llama.cpp, and more'}</span></div><span className="np-radio">{runtime === kind && <Check size={11}/>}</span>
      </button>)}
    </div>
    <section className="np-panel np-connection">
      <div className="np-section-title"><h2>Runtime connection</h2><span className={`np-status ${status ? 'ready' : ''}`}><i/>{loading ? 'Connecting' : status ? 'Connected' : 'Not connected'}</span></div>
      <form onSubmit={async e => { e.preventDefault(); await reconnect(url); }} className="np-inline-form">
        <label className="np-field"><span>Server address</span><input aria-label="Runtime server address" value={url} onChange={e => setUrl(e.target.value)} spellCheck={false}/></label>
        <button className="np-button" disabled={loading}><RefreshCw size={14} className={loading ? 'np-spin' : ''}/>{loading ? 'Connecting' : 'Connect runtime'}</button>
      </form>
      {error && <p className="np-error" role="alert">{error}</p>}
      {!status && <div className="np-setup-note"><Terminal size={17}/><div><strong>{runtime === 'ollama' ? 'Start with Ollama' : 'Start your local server'}</strong><p>{runtime === 'ollama' ? 'Install Ollama, start it, and download a model that fits your machine. Reconnect when it is ready.' : 'In LM Studio, load a model and start the server in Developer. For llama.cpp, use the server address with /v1.'}</p><a href={runtime === 'ollama' ? 'https://ollama.com/download' : 'https://lmstudio.ai/docs/developer/core/server'} target="_blank" rel="noreferrer">Open setup guide <ExternalLink size={12}/></a></div></div>}
      {status && <div className="np-machine"><Cpu size={16}/><span>{status.host.platform} / {status.host.arch}</span><span>{sizeLabel(status.host.memory)} memory</span><span>{status.host.cpus} logical cores</span><small>App host</small></div>}
    </section>
    <div className="np-section-title np-model-title"><div><h2>Your models <span className="np-count">{status?.models.length ?? 0}</span></h2><p>{runtimeName(runtime)} reports the models below.</p></div><input className="np-search" aria-label="Search models" placeholder="Filter models…" value={search} onChange={e => setSearch(e.target.value)}/></div>
    {actionError && <p className="np-error" role="alert">{actionError}</p>}
    <div className="np-model-grid">
      {status?.models.filter(model => model.id.toLowerCase().includes(search.toLowerCase())).map(model => <article className="np-model-card" key={model.id}>
        <div className="np-model-card-top"><div className="np-model-icon"><Cpu size={23}/></div><span className="np-label">Local</span></div>
        <h3>{model.id}</h3><p>{[model.parameters, model.quantization, model.family].filter(Boolean).join(' · ') || 'Available from your local runtime'}</p>
        <div className="np-model-card-bottom"><span>{sizeLabel(model.size)}</span><button className="np-button small" disabled={!!selecting} onClick={() => void choose(model.id)}>{selecting === model.id ? 'Opening…' : 'Use model'}<ArrowRight size={13}/></button></div>
      </article>)}
    </div>
    {(!status || status.models.length === 0) && <div className="np-empty-panel"><HardDrive size={26}/><h3>{status ? 'Your model shelf is empty.' : 'Your models will appear here.'}</h3><p>{status ? 'Download or load a model in your runtime, then reconnect.' : 'Connect your runtime to see installed models and start a thread.'}</p></div>}
    {status && status.models.length > 0 && !status.models.some(m => m.id.toLowerCase().includes(search.toLowerCase())) && <p className="np-empty-panel">No models match “{search}”.</p>}
    <div className="np-bottom-note"><div><h3>Already have a cloud API key?</h3><p>Existing cloud providers are available with your own keys.</p></div><button className="np-button ghost" onClick={onSettings}>Provider settings <ArrowRight size={13}/></button></div>
  </div>;
}
