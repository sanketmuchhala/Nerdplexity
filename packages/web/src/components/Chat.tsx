import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Globe, Brain } from 'lucide-react';
import { Message } from './Message';
import { ChatHeader } from './layout/ChatHeader';
import ThinkingHUD from './ThinkingHUD';
import useChat from '../state/chatStore';
import { PROVIDER_NAMES, getDefaultModelForProvider } from '../constants/models';
import type { Provider } from '../lib/db';
import { startTurn } from '../promptops/instrument';
import { useStickyAutoScroll } from '../hooks/useStickyAutoScroll';

interface Props { onOpenSettings: () => void; }

export function Chat({ onOpenSettings }: Props) {
  const [input, setInput]                     = useState('');
  const [isLoading, setIsLoading]             = useState(false);
  const [webSearch, setWebSearch]             = useState(false);
  const [reasoning, setReasoning]             = useState(false);
  const [thinkingStart, setThinkingStart]     = useState<number|null>(null);
  const [thinkingPhase, setThinkingPhase]     = useState<'Planning'|'Drafting'|'Refining'>('Planning');
  const [tokensReceived, setTokensReceived]   = useState(0);
  const [reasoningSummary, setReasoningSummary] = useState<string|undefined>();

  const textareaRef       = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef    = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const {
    activeConversation, addMessage, newConversation,
    getApiKey, getCurrentProvider, updateConversationSettings, settings,
  } = useChat();

  const { scrollToBottomIfStuck, markMessageAnchor } = useStickyAutoScroll(messagesContainerRef);

  const conversation       = activeConversation();
  const provider           = conversation?.provider ?? getCurrentProvider();
  const apiKey             = getApiKey(provider);
  const hasKey             = provider === 'local-ollama' || (apiKey && apiKey.length > 10);

  const availableProviders = Object.keys(PROVIDER_NAMES).filter(p => {
    if (p === 'local-ollama') return true;
    const k = getApiKey(p as Provider);
    return k && k.length > 10;
  });

  useEffect(() => { scrollToBottomIfStuck(); }, [activeConversation()?.messages, scrollToBottomIfStuck]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  }, [input]);

  const handleProviderChange = async (p: Provider) => {
    if (conversation && p !== conversation.provider) {
      await updateConversationSettings(conversation.id, { provider: p, model: getDefaultModelForProvider(p) });
    }
  };
  const handleModelChange = async (m: string) => {
    if (conversation && m !== conversation.model) {
      await updateConversationSettings(conversation.id, { model: m });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !hasKey || !conversation) return;

    const text = input.trim();
    setInput('');
    setIsLoading(true);
    setThinkingStart(Date.now());
    setThinkingPhase('Planning');
    setTokensReceived(0);
    setReasoningSummary(undefined);

    const turn = startTurn({
      corr_id: crypto.randomUUID(), session_id: conversation.id,
      provider, model: conversation.model,
      settings: { temperature: conversation.settings.temperature, max_tokens: conversation.settings.max_tokens, web_search: webSearch, reasoning },
      business: { task: 'chat' },
    });

    try {
      // Validate local model
      if (provider === 'local-ollama') {
        const base = settings?.baseURL ?? 'http://localhost:11434';
        const resp = await fetch(`${base.replace(/\/+$/,'')}/api/tags`);
        const { models = [] } = await resp.json();
        if (!models.some((m: any) => m.model === conversation.model || m.name === conversation.model)) {
          throw new Error(`Model not installed: ${conversation.model}. Run: ollama pull ${conversation.model}`);
        }
      }

      await addMessage('user', text);

      let msgs = conversation.messages.map(m => ({ role: m.role, content: m.content, timestamp: m.createdAt }));
      msgs.push({ role: 'user', content: text, timestamp: Date.now() });

      // Trim for local
      if (provider === 'local-ollama' && settings?.performanceMode !== false) {
        const max = conversation.model.toLowerCase().includes('gemma2') ? 12 : 16;
        if (msgs.length > max) {
          const system = msgs.filter(m => m.role === 'system');
          const conv   = msgs.filter(m => m.role !== 'system');
          if (conv.length > max) {
            msgs = [...system, ...conv.slice(-max)];
          }
        }
      }

      const response = await fetch('/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: msgs, provider, model: conversation.model, api_key: apiKey,
          temperature: conversation.settings.temperature, max_tokens: conversation.settings.max_tokens,
          web_search: webSearch, show_reasoning: reasoning,
          ...(provider === 'local-ollama' && settings && {
            baseURL: settings.baseURL ?? 'http://localhost:11434',
            num_ctx: settings.num_ctx ?? 4096,
            performanceMode: settings.performanceMode,
          }),
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.details || `HTTP ${response.status}`);
      }

      const data = await response.json();
      turn.markFirstToken();
      setTimeout(() => setThinkingPhase('Drafting'), 200);
      setTokensReceived(Math.max(1, Math.floor((data.message?.content?.length ?? 0) / 4)));
      setTimeout(() => setThinkingPhase('Refining'), 800);

      if (data.reasoning) setReasoningSummary(data.reasoning.substring(0, 100) + (data.reasoning.length > 100 ? '…' : ''));

      await addMessage('assistant', data.message.content, {
        webSearchResults: data.webSearchResults,
        reasoning: data.reasoning,
      });
      await turn.endOk({ usage: data.usage, safety: data.safety, quality: data.quality, prompt: { prompt_chars: text.length } });

    } catch (err: any) {
      let msg = `Error: ${err.message}`;
      if (provider === 'local-ollama') {
        if (err.message.includes('ECONNREFUSED') || err.message.includes('fetch')) msg = `**Ollama not running.** Start with: \`ollama serve\``;
        else if (err.message.includes('404')) msg = `**Model not found:** \`ollama pull ${conversation?.model}\``;
      } else if (err.message.includes('401')) msg = `**Invalid API key** for ${provider}. Check Settings.`;
      else if (err.message.includes('429')) msg = `**Rate limited** by ${provider}. Wait a moment and retry.`;
      await addMessage('assistant', msg);
      await turn.endError(err, { prompt: { prompt_chars: text.length } });
    } finally {
      setIsLoading(false);
      setThinkingStart(null);
      setTokensReceived(0);
      setReasoningSummary(undefined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
  };

  /* ── No conversation ── */
  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
        <ChatHeader conversation={null} onOpenSettings={onOpenSettings} />
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center max-w-sm w-full">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 text-xl font-bold text-white"
              style={{ background: 'var(--blue-dark)', boxShadow: '0 0 28px rgba(59,130,246,.3)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>N</div>
            <h2 className="text-xl font-bold mb-2" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '-0.025em' }}>
              Nerdplexity
            </h2>
            <p className="text-sm mb-7 leading-relaxed" style={{ color: 'var(--t3)' }}>
              Your keys, your models, your data.
            </p>
            <div className="flex flex-col gap-2.5">
              <button onClick={() => newConversation()} className="btn-primary w-full justify-center" style={{ padding: '11px 20px' }}>
                New thread
              </button>
              <button onClick={onOpenSettings} className="btn-ghost w-full justify-center" style={{ padding: '11px 20px' }}>
                Configure API keys
              </button>
            </div>
            {!hasKey && (
              <p className="mt-4 text-xs" style={{ color: '#fbbf24' }}>
                No API key set — add one in Settings to start.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ── Active conversation ── */
  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      <ChatHeader
        conversation={conversation} onOpenSettings={onOpenSettings}
        onProviderChange={handleProviderChange} onModelChange={handleModelChange}
        availableProviders={availableProviders}
      />

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {conversation.messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm mb-1" style={{ color: 'var(--t4)' }}>
                {PROVIDER_NAMES[provider as keyof typeof PROVIDER_NAMES] ?? provider}
              </p>
              <p className="text-xs" style={{ color: 'var(--t4)' }}>Send a message to begin</p>
            </div>
          </div>
        ) : (
          <div ref={messagesContainerRef} className="py-2">
            {conversation.messages.map((msg, idx) => {
              const isLast = idx === conversation.messages.length - 1;
              return (
                <div key={msg.id} ref={isLast ? markMessageAnchor : undefined} data-last-message={isLast ? 'true' : undefined}>
                  <Message message={{ role: msg.role, content: msg.content, timestamp: msg.createdAt, id: msg.id, metadata: msg.metadata }} />
                </div>
              );
            })}
            {isLoading && thinkingStart && (
              <div className="px-4">
                <div className="max-w-[680px] mx-auto">
                  <ThinkingHUD
                    running={isLoading} elapsedMs={Date.now() - thinkingStart}
                    tokensPerSec={tokensReceived > 0 ? tokensReceived / Math.max(1, (Date.now() - thinkingStart) / 1000) : undefined}
                    phase={thinkingPhase} summary={reasoningSummary}
                  />
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 px-4 pb-5 pt-3" style={{ borderTop: '1px solid var(--b)' }}>
        <div className="max-w-[680px] mx-auto w-full">
          {!hasKey ? (
            <div className="px-5 py-4 rounded-xl text-center"
              style={{ background: 'rgba(251,191,36,.04)', border: '1px solid rgba(251,191,36,.2)' }}>
              <p className="text-xs mb-3" style={{ color: '#fbbf24' }}>No API key for {provider}</p>
              <button onClick={onOpenSettings} className="btn-primary text-xs" style={{ padding: '7px 16px' }}>
                Configure keys
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div
                className="composer-wrap rounded-2xl overflow-hidden transition-all duration-200"
                style={{ background: 'var(--s1)', border: '1px solid var(--b-hi)', boxShadow: '0 4px 24px rgba(0,0,0,.4)' }}
              >
                <textarea
                  ref={textareaRef}
                  value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder="Ask anything…" rows={1} disabled={isLoading}
                  className="block w-full px-4 pt-4 pb-2 bg-transparent text-sm resize-none outline-none leading-relaxed"
                  style={{ color: 'var(--t1)', caretColor: 'var(--blue)' }}
                />

                <div className="flex items-center justify-between px-3 pb-3 pt-1">
                  <div className="flex items-center gap-1.5">
                    {[
                      { key:'web', label:'Web', icon:Globe, active:webSearch, toggle:()=>setWebSearch(v=>!v) },
                      { key:'reason', label:'Reason', icon:Brain, active:reasoning, toggle:()=>setReasoning(v=>!v) },
                    ].map(({ key, label, icon: Icon, active, toggle }) => (
                      <button key={key} type="button" onClick={toggle}
                        className="pill-toggle" data-active={String(active)}>
                        <Icon size={11} />{label}
                      </button>
                    ))}
                  </div>

                  <button type="submit" disabled={!input.trim() || isLoading}
                    className="flex items-center justify-center w-8 h-8 rounded-xl text-white transition-all disabled:opacity-25 disabled:cursor-not-allowed"
                    style={{ background: 'var(--blue-dark)' }}
                    onMouseEnter={e => { if (!(!input.trim()||isLoading)) (e.currentTarget as HTMLElement).style.background = 'var(--blue)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--blue-dark)'; }}
                  >
                    {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  </button>
                </div>
              </div>

              <p className="mt-2 text-center text-[10px]" style={{ color: 'var(--t4)' }}>
                Enter to send · Shift+Enter for new line · ⌘K for settings
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
