import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Plus, Globe, Brain } from 'lucide-react';
import { Message } from './Message';
import { ChatHeader } from './layout/ChatHeader';

import useChat from '../state/chatStore';
import { PROVIDER_NAMES, getDefaultModelForProvider } from '../constants/models';
import type { Provider } from '../lib/db';
import { startTurn } from '../promptops/instrument';
import { useStickyAutoScroll } from '../hooks/useStickyAutoScroll';
import ThinkingHUD from './ThinkingHUD';

interface ChatProps {
  onOpenSettings: () => void;
}

export const Chat: React.FC<ChatProps> = ({ onOpenSettings }) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [reasoningEnabled, setReasoningEnabled] = useState(false);

  // Debouncing state for send button
  const [sendDebounceTimer, setSendDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  
  // ThinkingHUD state
  const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null);
  const [thinkingPhase, setThinkingPhase] = useState<"Planning" | "Drafting" | "Refining">("Planning");
  const [tokensReceived, setTokensReceived] = useState(0);
  const [reasoningSummary, setReasonningSummary] = useState<string | undefined>();
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  
  const { 
    activeConversation,
    addMessage,
    newConversation,
    getApiKey,
    getCurrentProvider,
    updateConversationSettings,
    settings
  } = useChat();

  // Initialize sticky auto-scroll hook
  const { scrollToBottomIfStuck, markMessageAnchor } = useStickyAutoScroll(messagesContainerRef);

  // Auto-scroll when messages change (non-jittery)
  useEffect(() => {
    scrollToBottomIfStuck();
  }, [activeConversation()?.messages, scrollToBottomIfStuck]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);


  const conversation = activeConversation();
  const conversationProvider = conversation?.provider || getCurrentProvider();
  const currentApiKey = getApiKey(conversationProvider);
  const hasValidKey = conversationProvider === 'local-ollama' || (currentApiKey && currentApiKey.length > 10);

  // Get available providers (those with valid API keys or local-ollama)
  const availableProviders = Object.keys(PROVIDER_NAMES).filter(provider => {
    if (provider === 'local-ollama') return true; // Local Ollama doesn't need API key
    const key = getApiKey(provider as any);
    return key && key.length > 10;
  });

  // Get available models for current provider
  const handleModelChange = async (newModel: string) => {
    if (conversation && newModel !== conversation.model) {
      // Auto-detect required provider for the model
      let requiredProvider: Provider = conversation.provider;
      
      // Check if model requires a specific provider
      if (newModel.includes('gemma') || newModel.includes('llama') || newModel.includes('qwen') || newModel.includes('phi')) {
        requiredProvider = 'local-ollama';
      } else if (newModel.includes('claude')) {
        requiredProvider = 'anthropic';
      } else if (newModel.includes('gpt')) {
        requiredProvider = 'openai';
      } else if (newModel.includes('gemini')) {
        requiredProvider = 'gemini';
      } else if (newModel.includes('deepseek')) {
        requiredProvider = 'deepseek';
      }
      
      await updateConversationSettings(conversation.id, {
        model: newModel,
        ...(requiredProvider !== conversation.provider && { provider: requiredProvider })
      });
    }
  };

  const handleProviderChange = async (newProvider: Provider) => {
    if (conversation && newProvider !== conversation.provider) {
      const defaultModel = getDefaultModelForProvider(newProvider);
      await updateConversationSettings(conversation.id, {
        provider: newProvider,
        model: defaultModel
      });
    }
  };

  // Helper function to validate local model exists
  const ensureLocalModelExists = async (baseURL: string, model: string) => {
    try {
      const response = await fetch(`${baseURL.replace(/\/+$/, '')}/api/tags`);
      const data = await response.json();
      const models = data.models || [];
      return models.some((m: any) => m.model === model || m.name === model);
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !hasValidKey || !conversation) return;

    // Debounce rapid submissions (prevent double-click issues)
    if (sendDebounceTimer) {
      clearTimeout(sendDebounceTimer);
    }

    const submitTimer = setTimeout(() => {
      setSendDebounceTimer(null);
      performSubmit();
    }, 150); // 150ms debounce

    setSendDebounceTimer(submitTimer);
  };

  const performSubmit = async () => {
    if (!input.trim() || isLoading || !hasValidKey || !conversation) return;

    const currentInput = input.trim();
    setInput('');
    setIsLoading(true);
    
    // Initialize ThinkingHUD
    setThinkingStartTime(Date.now());
    setThinkingPhase("Planning");
    setTokensReceived(0);
    setReasonningSummary(undefined);

    // Start turn instrumentation
    const turn = startTurn({
      corr_id: crypto.randomUUID(),
      session_id: conversation.id,
      provider: conversationProvider,
      model: conversation.model,
      settings: {
        temperature: conversation.settings.temperature,
        max_tokens: conversation.settings.max_tokens,
        web_search: webSearchEnabled,
        reasoning: reasoningEnabled
      },
      business: { task: 'chat' }
    });

    try {
      // Validate local model exists before sending
      if (conversationProvider === 'local-ollama') {
        const baseURL = settings?.baseURL || 'http://localhost:11434';
        const model = conversation.model;
        const modelExists = await ensureLocalModelExists(baseURL, model);
        if (!modelExists) {
          throw new Error(`Model not installed: ${model}. Install with: ollama pull ${model}`);
        }
      }

      // Add user message
      await addMessage('user', currentInput);

      // Prepare messages with performance trimming for local-ollama
      let messagesToSend = conversation.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.createdAt
      }));

      // Add current user message
      messagesToSend.push({ role: 'user', content: currentInput, timestamp: Date.now() });

      // Enhanced performance trimming for local-ollama with gemma2 detection
      const isGemma2 = conversation.model.toLowerCase().includes('gemma2');
      const performanceMode = settings?.performanceMode !== false;

      if (conversationProvider === 'local-ollama' && performanceMode) {
        // More aggressive trimming for gemma2 models
        const maxTurns = isGemma2 ? 6 : 8; // 6 turns for gemma2, 8 for others
        const maxMessages = maxTurns * 2; // Each turn is user + assistant

        if (messagesToSend.length > maxMessages) {
          // Preserve system messages
          const systemMessages = messagesToSend.filter(m => m.role === 'system');
          const conversationMessages = messagesToSend.filter(m => m.role !== 'system');

          if (conversationMessages.length > maxMessages) {
            // Create a more sophisticated summary
            const olderMessages = conversationMessages.slice(0, -(maxMessages - 1)); // Leave room for current message
            const recentMessages = conversationMessages.slice(-(maxMessages - 1));

            // Extract key information for summary
            const userQueries = olderMessages.filter(m => m.role === 'user').slice(-3);
            const assistantResponses = olderMessages.filter(m => m.role === 'assistant').slice(-2);

            const summaryContent = `[Previous conversation context - ${olderMessages.length} messages]
Recent topics: ${userQueries.map(m => m.content.substring(0, 50).replace(/\n/g, ' ')).join(' | ')}
Key points: ${assistantResponses.map(m => m.content.substring(0, 70).replace(/\n/g, ' ')).join(' | ')}`;

            messagesToSend = [
              ...systemMessages,
              { role: 'system', content: summaryContent, timestamp: Date.now() },
              ...recentMessages
            ];
          }
        }

        // Input limiting for large prompts (performance optimization)
        if (currentInput.length > 4000) {
          const trimmed = currentInput.substring(0, 4000) + '\n\n[Note: Input was trimmed to 4000 characters for optimal performance]';
          messagesToSend[messagesToSend.length - 1].content = trimmed;
        }
      }

      // Send to API
      const response = await fetch('/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messagesToSend,
          provider: conversationProvider,
          model: conversation.model,
          api_key: currentApiKey,
          temperature: conversation.settings.temperature,
          max_tokens: conversation.settings.max_tokens,
          web_search: webSearchEnabled,
          show_reasoning: reasoningEnabled,
          // Local Ollama specific fields
          ...(conversationProvider === 'local-ollama' && settings && {
            baseURL: settings.baseURL || 'http://localhost:11434',
            num_ctx: settings.num_ctx || 4096,
            performanceMode: settings.performanceMode,
            top_p: settings.topP,
            top_k: settings.topK,
            num_thread: settings.numThread
          })
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Mark first token received (for TTFT)
      turn.markFirstToken();

      // Realistic phase transitions with timing
      setTimeout(() => setThinkingPhase("Drafting"), 200);

      // Estimate tokens received for progress tracking
      const contentLength = data.message?.content?.length || 0;
      const estimatedTokens = Math.max(1, Math.floor(contentLength / 4)); // Rough chars to tokens
      setTokensReceived(estimatedTokens);

      // Final phase transition
      setTimeout(() => setThinkingPhase("Refining"), 800);
      
      // Check for reasoning summary
      if (data.reasoning) {
        setReasonningSummary(data.reasoning.substring(0, 100) + (data.reasoning.length > 100 ? '...' : ''));
      }
      
      // Add assistant message with web search metadata and reasoning
      await addMessage('assistant', data.message.content, {
        webSearchResults: data.webSearchResults,
        reasoning: data.reasoning
      });

      // Complete turn logging
      await turn.endOk({
        usage: data.usage,
        safety: data.safety,
        quality: data.quality,
        prompt: {
          prompt_chars: currentInput.length
        }
      });
      
    } catch (error: any) {
      console.error('Chat error:', error);
      
      let errorContent = `Error: ${error.message}`;
      
      // Provide more helpful error messages
      if (conversationProvider === 'local-ollama') {
        if (error.message.includes('ECONNREFUSED') || error.message.includes('Failed to fetch') || error.message.includes('Connection failed')) {
          errorContent = `**Ollama Not Running**: Cannot connect to Ollama at ${settings?.baseURL || 'http://localhost:11434'}. Start Ollama with: \`ollama serve\``;
        } else if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
          errorContent = `**Connection Timeout**: Connection to Ollama at ${settings?.baseURL || 'http://localhost:11434'} timed out. Check if Ollama is running.`;
        } else if (error.message.includes('404')) {
          errorContent = `**Model Not Found**: The model "${conversation?.model}" is not available. Pull it with: \`ollama pull ${conversation?.model}\``;
        } else if (error.message.includes('HTTP 400') || error.message.includes('HTTP 500')) {
          errorContent = `**Ollama Error**: ${error.message.slice(0, 200)}. Try restarting Ollama or check the model.`;
        } else {
          errorContent = `**Ollama Error**: ${error.message}. Make sure Ollama is running and the model is available.`;
        }
      } else if (error.message.includes('401') || error.message.includes('Authentication failed')) {
        errorContent = `**Invalid API Key**: Your API key appears to be incorrect or expired for ${conversationProvider}. Please check your settings.`;
      } else if (error.message.includes('429') || error.message.includes('Rate limited')) {
        errorContent = `**Rate Limited**: The ${conversationProvider} API is rate limiting your requests. Please wait a moment and try again.`;
      } else if (error.message.includes('Network error') || error.message.includes('fetch')) {
        errorContent = `**Network Error**: Unable to connect to the server. Please check your connection.`;
      } else {
        errorContent += ` Please check your API key and settings.`;
      }
      
      await addMessage('assistant', errorContent);

      // Log error turn
      await turn.endError(error, {
        prompt: {
          prompt_chars: currentInput.length
        }
      });

    } finally {
      setIsLoading(false);
      setThinkingStartTime(null);
      setTokensReceived(0);
      setReasonningSummary(undefined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // ── No conversation selected ──────────────────────────────
  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col bg-neutral-950">
        <ChatHeader conversation={null} onOpenSettings={onOpenSettings} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm px-6 animate-fade-in">
            <div className="w-12 h-12 rounded-2xl bg-nerdplexity-600/20 border border-nerdplexity-500/30 flex items-center justify-center mx-auto mb-6">
              <span className="text-xl text-nerdplexity-400 font-bold">N</span>
            </div>
            <h2 className="text-lg font-semibold text-neutral-100 mb-2">Nerdplexity</h2>
            <p className="text-sm text-neutral-500 mb-8 leading-relaxed">
              Bring your own keys. Ask anything. Local-first, private by default.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => newConversation()}
                className="
                  flex items-center justify-center gap-2 w-full px-4 py-2.5
                  bg-nerdplexity-600 hover:bg-nerdplexity-500
                  text-white text-sm font-medium rounded-xl
                  transition-all duration-150
                "
              >
                <Plus size={16} />
                New Thread
              </button>
              <button
                onClick={onOpenSettings}
                className="
                  flex items-center justify-center gap-2 w-full px-4 py-2.5
                  bg-neutral-800 hover:bg-neutral-750
                  text-neutral-300 hover:text-neutral-100
                  text-sm font-medium rounded-xl border border-neutral-700
                  transition-all duration-150
                "
              >
                Configure API Keys
              </button>
            </div>
            {!hasValidKey && (
              <div className="mt-5 px-4 py-3 bg-amber-900/20 border border-amber-800/60 rounded-xl">
                <p className="text-xs text-amber-300">
                  No API key configured. Add one in settings to start chatting.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Active conversation ────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col bg-neutral-950 min-w-0">
      <ChatHeader
        conversation={conversation}
        onOpenSettings={onOpenSettings}
        onProviderChange={handleProviderChange}
        onModelChange={handleModelChange}
        availableProviders={availableProviders}
      />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {conversation.messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center px-6 animate-fade-in">
              <p className="text-sm text-neutral-600 mb-1">
                Using {PROVIDER_NAMES[conversationProvider as keyof typeof PROVIDER_NAMES] ?? conversationProvider}
              </p>
              <p className="text-xs text-neutral-700">Ask anything to begin</p>
            </div>
          </div>
        ) : (
          <div ref={messagesContainerRef} className="pb-4">
            {conversation.messages.map((message, index) => {
              const isLast = index === conversation.messages.length - 1;
              return (
                <div
                  key={message.id}
                  ref={isLast ? markMessageAnchor : undefined}
                  data-last-message={isLast ? 'true' : undefined}
                >
                  <Message
                    message={{
                      role: message.role,
                      content: message.content,
                      timestamp: message.createdAt,
                      id: message.id,
                      metadata: message.metadata,
                    }}
                  />
                </div>
              );
            })}

            {isLoading && thinkingStartTime && (
              <div className="px-6 max-w-3xl mx-auto">
                <ThinkingHUD
                  running={isLoading}
                  elapsedMs={Date.now() - thinkingStartTime}
                  tokensPerSec={
                    tokensReceived > 0
                      ? tokensReceived / Math.max(1, (Date.now() - thinkingStartTime) / 1000)
                      : undefined
                  }
                  phase={thinkingPhase}
                  summary={reasoningSummary}
                />
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Composer ─────────────────────────────────────────── */}
      <div className="px-4 pb-5 pt-3">
        <div className="max-w-3xl mx-auto">
          {!hasValidKey ? (
            <div className="px-4 py-3 bg-amber-900/20 border border-amber-800/60 rounded-xl text-center">
              <p className="text-xs text-amber-300 mb-3">
                No API key configured for {conversationProvider}
              </p>
              <button
                onClick={onOpenSettings}
                className="px-3 py-1.5 bg-nerdplexity-600 hover:bg-nerdplexity-500 text-white text-xs font-medium rounded-lg transition-all"
              >
                Configure API Keys
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {/* Input container */}
              <div
                className="
                  relative border border-neutral-700 rounded-2xl bg-neutral-900
                  transition-all duration-200
                  focus-within:border-nerdplexity-500/50
                  focus-within:[box-shadow:0_0_0_3px_rgba(139,92,246,0.08),0_0_20px_rgba(139,92,246,0.06)]
                "
              >
                {/* Textarea */}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask anything…"
                  rows={1}
                  disabled={isLoading}
                  className="
                    w-full px-4 pt-4 pb-2
                    bg-transparent text-sm text-neutral-100
                    placeholder:text-neutral-600
                    resize-none outline-none
                    leading-relaxed
                  "
                />

                {/* Bottom bar: toggles + send */}
                <div className="flex items-center justify-between px-3 pb-3 pt-1 gap-2">
                  {/* Feature toggles */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setWebSearchEnabled(v => !v)}
                      className={`
                        flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                        border transition-all duration-150
                        ${webSearchEnabled
                          ? 'bg-nerdplexity-600/20 border-nerdplexity-500/50 text-nerdplexity-300'
                          : 'border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600'}
                      `}
                    >
                      <Globe size={12} />
                      Web
                    </button>
                    <button
                      type="button"
                      onClick={() => setReasoningEnabled(v => !v)}
                      className={`
                        flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                        border transition-all duration-150
                        ${reasoningEnabled
                          ? 'bg-nerdplexity-600/20 border-nerdplexity-500/50 text-nerdplexity-300'
                          : 'border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600'}
                      `}
                    >
                      <Brain size={12} />
                      Reason
                    </button>
                  </div>

                  {/* Send button */}
                  <button
                    type="submit"
                    disabled={!input.trim() || isLoading}
                    className="
                      flex items-center justify-center w-8 h-8 rounded-lg
                      bg-nerdplexity-600 hover:bg-nerdplexity-500
                      text-white transition-all duration-150
                      disabled:opacity-30 disabled:cursor-not-allowed
                    "
                  >
                    {isLoading
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Send size={14} />}
                  </button>
                </div>
              </div>

              {/* Hint */}
              <p className="mt-2 text-center text-[10px] text-neutral-700">
                Enter to send · Shift+Enter for new line · ⌘K settings
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};