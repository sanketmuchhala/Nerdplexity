import { useState } from 'react';
import { Eye, EyeOff, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import useChat from '../state/chatStore';
import type { Provider } from '../lib/db';

const PROVIDERS: { id: Provider; label: string; models: string[]; placeholder: string; requiresKey: boolean }[] = [
  { id: 'anthropic',   label: 'Anthropic (Claude)',    models: ['claude-opus-4-7','claude-sonnet-4-6','claude-3-5-haiku-20241022'], placeholder: 'sk-ant-...', requiresKey: true },
  { id: 'openai',      label: 'OpenAI (GPT)',          models: ['gpt-4o','gpt-4o-mini','o1','o1-mini'],                            placeholder: 'sk-...',      requiresKey: true },
  { id: 'gemini',      label: 'Google (Gemini)',       models: ['gemini-2.0-flash','gemini-2.5-pro'],                              placeholder: 'AIza...',     requiresKey: true },
  { id: 'deepseek',    label: 'DeepSeek',             models: ['deepseek-chat','deepseek-reasoner'],                              placeholder: 'sk-...',      requiresKey: true },
  { id: 'local-ollama',label: 'Ollama (Local)',        models: [],                                                                placeholder: 'No key needed', requiresKey: false },
];

interface ProviderRowProps {
  provider: typeof PROVIDERS[0];
  apiKey: string;
  onSave: (key: string) => Promise<void>;
  onTest: () => Promise<{ ok: boolean; message?: string }>;
}

function ProviderRow({ provider, apiKey, onSave, onTest }: ProviderRowProps) {
  const [value,     setValue]    = useState(apiKey);
  const [show,      setShow]     = useState(false);
  const [saved,     setSaved]    = useState(false);
  const [testing,   setTesting]  = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const handleSave = async () => {
    await onSave(value);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try { const r = await onTest(); setTestResult(r); }
    catch { setTestResult({ ok: false, message: 'Test failed' }); }
    finally { setTesting(false); }
  };

  return (
    <div className="p-4 rounded-xl" style={{ background: 'var(--s1)', border: '1px solid var(--b)' }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--t1)' }}>
          {provider.label}
        </span>
        {testResult && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: testResult.ok ? '#86efac' : '#fca5a5' }}>
            {testResult.ok ? <CheckCircle size={13}/> : <XCircle size={13}/>}
            {testResult.message ?? (testResult.ok ? 'Connected' : 'Failed')}
          </div>
        )}
      </div>

      {provider.requiresKey ? (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={show ? 'text' : 'password'}
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={provider.placeholder}
              className="w-full px-3 py-2 pr-9 text-sm rounded-lg outline-none transition-all"
              style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)', color: 'var(--t1)' }}
              onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(59,130,246,.4)'; }}
              onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--b-hi)'; }}
            />
            <button type="button" onClick={() => setShow(s => !s)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors"
              style={{ color: 'var(--t3)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--t1)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--t3)'}>
              {show ? <EyeOff size={14}/> : <Eye size={14}/>}
            </button>
          </div>
          <button type="button" onClick={handleSave}
            className="px-3 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: saved ? 'rgba(74,222,128,.1)' : 'var(--s2)', border: '1px solid var(--b-hi)', color: saved ? '#86efac' : 'var(--t2)' }}>
            {saved ? '✓ Saved' : 'Save'}
          </button>
          <button type="button" onClick={handleTest} disabled={testing || !value.trim()}
            className="px-3 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
            style={{ background: 'var(--blue-dim)', border: '1px solid rgba(59,130,246,.3)', color: 'var(--blue-bright)' }}>
            {testing ? <Loader2 size={13} className="animate-spin" /> : 'Test'}
          </button>
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--t3)' }}>
          No API key required. Configure Ollama URL below.
        </p>
      )}
    </div>
  );
}

interface OllamaSettingsProps { settings: any; onSave: (p: any) => Promise<void>; }

function OllamaSettings({ settings, onSave }: OllamaSettingsProps) {
  const [url,   setUrl]   = useState(settings?.baseURL ?? 'http://localhost:11434');
  const [ctx,   setCtx]   = useState(String(settings?.num_ctx ?? 4096));
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await onSave({ baseURL: url, num_ctx: parseInt(ctx) || 4096 });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-4 rounded-xl mt-3" style={{ background: 'var(--s1)', border: '1px solid var(--b)' }}>
      <p className="text-xs font-semibold mb-3" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--t1)' }}>
        Ollama Configuration
      </p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="t-label block mb-1">Base URL</label>
          <input value={url} onChange={e=>setUrl(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg outline-none transition-all"
            style={{ background:'var(--s2)', border:'1px solid var(--b-hi)', color:'var(--t1)' }}
            onFocus={e=>(e.currentTarget as HTMLElement).style.borderColor='rgba(59,130,246,.4)'}
            onBlur={e=>(e.currentTarget as HTMLElement).style.borderColor='var(--b-hi)'}
          />
        </div>
        <div>
          <label className="t-label block mb-1">Context Window</label>
          <input value={ctx} onChange={e=>setCtx(e.target.value)} type="number"
            className="w-full px-3 py-2 text-sm rounded-lg outline-none transition-all"
            style={{ background:'var(--s2)', border:'1px solid var(--b-hi)', color:'var(--t1)' }}
            onFocus={e=>(e.currentTarget as HTMLElement).style.borderColor='rgba(59,130,246,.4)'}
            onBlur={e=>(e.currentTarget as HTMLElement).style.borderColor='var(--b-hi)'}
          />
        </div>
      </div>
      <button onClick={save} className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
        style={{ background: saved ? 'rgba(74,222,128,.1)' : 'var(--s2)', border: '1px solid var(--b-hi)', color: saved ? '#86efac' : 'var(--t2)' }}>
        {saved ? '✓ Saved' : 'Save Ollama settings'}
      </button>
    </div>
  );
}

interface Props { isOpen: boolean; onClose: () => void; }

export function SettingsModal({ isOpen, onClose }: Props) {
  const { settings, setApiKey, testApiKey, saveSettings } = useChat();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings & API Keys">
      <div className="p-6 space-y-3">
        <p className="text-xs mb-4" style={{ color: 'var(--t3)' }}>
          Keys are stored locally in IndexedDB. Never sent to any server except the provider's API.
        </p>

        {PROVIDERS.map(p => (
          <ProviderRow
            key={p.id}
            provider={p}
            apiKey={settings?.apiKeys?.[p.id] ?? ''}
            onSave={key => setApiKey(p.id, key)}
            onTest={() => testApiKey(p.id)}
          />
        ))}

        <OllamaSettings settings={settings} onSave={saveSettings} />

        <div className="pt-2">
          <p className="t-label mb-2">Keyboard shortcuts</p>
          <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: 'var(--t3)' }}>
            {[['⌘ N','New thread'],['⌘ K','Open settings'],['Enter','Send'],['⇧ Enter','New line']].map(([k,v]) => (
              <div key={k} className="flex items-center gap-2">
                <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background:'var(--s3)', border:'1px solid var(--b-hi)', color:'var(--t2)' }}>{k}</code>
                <span>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
