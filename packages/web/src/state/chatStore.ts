import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { db, Conversation, Message, AppSettings, Provider } from '../lib/db';
import { getDefaultModelForProvider } from '../constants/models';

interface ChatStore {
  // State
  conversations: Conversation[];
  activeConversationId: string | null;
  settings: AppSettings | null;
  isLoading: boolean;
  
  // Computed getters
  activeConversation: () => Conversation | null;
  
  // Actions
  loadConversations: () => Promise<void>;
  loadSettings: () => Promise<void>;
  newConversation: (defaults?: Partial<Conversation>) => Promise<void>;
  selectConversation: (id: string) => void;
  addMessage: (role: 'user' | 'assistant' | 'system', content: string, metadata?: { webSearchResults?: import('../lib/db').WebSearchResult[]; reasoning?: string }, conversationId?: string) => Promise<void>;
  updateConversationTitle: (id: string, title: string) => Promise<void>;
  updateConversationSettings: (id: string, updates: Partial<Pick<Conversation, 'provider' | 'model'> & Conversation['settings']>) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  saveSettings: (partial: Partial<AppSettings>) => Promise<void>;
  setApiKey: (provider: Provider, key: string) => Promise<void>;
  getApiKey: (provider: Provider) => string;
  testApiKey: (provider: Provider, model?: string) => Promise<{ ok: boolean; message?: string }>;
  
  // Helper methods
  persistActiveIfDirty: () => Promise<void>;
  getCurrentProvider: () => Provider;
  getDefaultSettings: () => Pick<AppSettings, 'temperature' | 'max_tokens' | 'web_enabled'>;
}

const useChat = create<ChatStore>((set, get) => ({
  // Initial state
  conversations: [],
  activeConversationId: null,
  settings: null,
  isLoading: false,
  
  // Computed getters
  activeConversation: () => {
    const state = get();
    return state.conversations.find(c => c.id === state.activeConversationId) || null;
  },
  
  // Load conversations from IndexedDB
  loadConversations: async () => {
    try {
      const conversations = await db.conversations.orderBy('updatedAt').reverse().toArray();
      set({ conversations });
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  },
  
  // Load settings from IndexedDB
  loadSettings: async () => {
    try {
      const settings = await db.settings.get(1);
      if (settings) {
        set({ settings });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  },
  
  // Create new conversation
  newConversation: async (defaults = {}) => {    
    // Persist current conversation if it has changes
    await get().persistActiveIfDirty();
    
    const id = uuidv4();
    const currentProvider = get().getCurrentProvider();
    
    const conversation: Conversation = {
      id,
      title: "New chat",
      provider: currentProvider,
      model: currentProvider === 'local-ollama' ? (get().settings?.localModels?.[get().settings?.localRuntime || 'ollama'] || '') : getDefaultModelForProvider(currentProvider),
      runtime: get().settings?.localRuntime || 'ollama',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      settings: get().getDefaultSettings(),
      ...defaults
    };
    
    try {
      await db.conversations.put(conversation);
      set(state => ({
        conversations: [conversation, ...state.conversations],
        activeConversationId: id
      }));
    } catch (error) {
      console.error('Failed to create new conversation:', error);
    }
  },
  
  // Select conversation by ID
  selectConversation: (id: string) => {
    set({ activeConversationId: id });
  },
  
  // Add message to active conversation
  addMessage: async (role: 'user' | 'assistant' | 'system', content: string, metadata?: { webSearchResults?: import('../lib/db').WebSearchResult[]; reasoning?: string }, conversationId?: string) => {
    const state = get();
    const activeConv = conversationId ? state.conversations.find(c => c.id === conversationId) : state.activeConversation();
    
    if (!activeConv) {
      console.error('No active conversation');
      return;
    }
    
    const message: Message = {
      id: uuidv4(),
      role,
      content,
      createdAt: Date.now(),
      ...(metadata && { metadata })
    };
    
    const updatedConversation: Conversation = {
      ...activeConv,
      messages: [...activeConv.messages, message],
      updatedAt: Date.now(),
      // Auto-generate title from first user message
      title: activeConv.messages.length === 0 && role === 'user' 
        ? content.slice(0, 50) + (content.length > 50 ? '...' : '')
        : activeConv.title
    };
    
    try {
      await db.conversations.put(updatedConversation);
      set(state => ({
        conversations: state.conversations.map(c => 
          c.id === activeConv.id ? updatedConversation : c
        )
      }));
    } catch (error) {
      console.error('Failed to add message:', error);
    }
  },
  
  // Update conversation title
  updateConversationTitle: async (id: string, title: string) => {
    const state = get();
    const conversation = state.conversations.find(c => c.id === id);
    
    if (!conversation) return;
    
    const updated = { ...conversation, title, updatedAt: Date.now() };
    
    try {
      await db.conversations.put(updated);
      set(state => ({
        conversations: state.conversations.map(c => c.id === id ? updated : c)
      }));
    } catch (error) {
      console.error('Failed to update conversation title:', error);
    }
  },
  
  // Update conversation settings (provider, model, etc.)
  updateConversationSettings: async (id: string, updates: Partial<Pick<Conversation, 'provider' | 'model'> & Conversation['settings']>) => {
    const state = get();
    const conversation = state.conversations.find(c => c.id === id);
    
    if (!conversation) return;
    
    const updated: Conversation = {
      ...conversation,
      provider: updates.provider || conversation.provider,
      model: updates.model || conversation.model,
      settings: {
        ...conversation.settings,
        temperature: updates.temperature !== undefined ? updates.temperature : conversation.settings.temperature,
        max_tokens: updates.max_tokens !== undefined ? updates.max_tokens : conversation.settings.max_tokens,
        web_enabled: updates.web_enabled !== undefined ? updates.web_enabled : conversation.settings.web_enabled
      },
      updatedAt: Date.now()
    };
    
    try {
      await db.conversations.put(updated);
      set(state => ({
        conversations: state.conversations.map(c => c.id === id ? updated : c)
      }));
    } catch (error) {
      console.error('Failed to update conversation settings:', error);
    }
  },
  
  // Delete conversation
  deleteConversation: async (id: string) => {
    try {
      await db.conversations.delete(id);
      set(state => ({
        conversations: state.conversations.filter(c => c.id !== id),
        activeConversationId: state.activeConversationId === id ? null : state.activeConversationId
      }));
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  },
  
  // Save settings
  saveSettings: async (partial: Partial<AppSettings>) => {
    const state = get();
    const currentSettings = state.settings;
    
    if (!currentSettings) return;
    
    const updatedSettings = { ...currentSettings, ...partial };
    
    try {
      await db.settings.put(updatedSettings);
      set({ settings: updatedSettings });
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  },
  
  // Set API key for provider
  setApiKey: async (provider: Provider, key: string) => {
    const state = get();
    if (!state.settings) return;
    
    const updatedApiKeys = { ...state.settings.apiKeys, [provider]: key };
    await get().saveSettings({ apiKeys: updatedApiKeys });
  },
  
  // Get API key for provider
  getApiKey: (provider: Provider) => {
    const state = get();
    return state.settings?.apiKeys[provider] || '';
  },
  
  // Test API key
  testApiKey: async (provider: Provider, model?: string) => {
    const apiKey = get().getApiKey(provider);
    
    if (!apiKey) {
      return { ok: false, message: 'No API key provided' };
    }
    
    try {
      let response: Response;
      
      // Use specific GET endpoint for DeepSeek
      if (provider === 'deepseek') {
        response = await fetch(`/v1/ping?provider=deepseek&api_key=${encodeURIComponent(apiKey)}`);
      } else {
        // Use existing POST endpoint for other providers
        response = await fetch('/v1/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, model, api_key: apiKey })
        });
      }
      
      const data = await response.json();
      
      if (response.ok && data.ok) {
        return { ok: true, message: data.message || `API key valid for ${provider}` };
      } else {
        return { ok: false, message: data.message || 'API key test failed' };
      }
    } catch (error) {
      return { ok: false, message: 'Network error testing API key' };
    }
  },
  
  // Helper: persist active conversation if it has unsaved changes
  persistActiveIfDirty: async () => {
    const state = get();
    const activeConv = state.activeConversation();
    
    if (activeConv && activeConv.messages.length > 0) {
      try {
        await db.conversations.put(activeConv);
      } catch (error) {
        console.error('Failed to persist active conversation:', error);
      }
    }
  },
  
  // Helper: get current provider from settings
  getCurrentProvider: (): Provider => {
    const state = get();
    return state.settings?.selectedProvider || 'local-ollama';
  },
  
  // Helper: get default settings
  getDefaultSettings: () => {
    const state = get();
    return {
      temperature: state.settings?.temperature ?? 0.7,
      max_tokens: state.settings?.max_tokens ?? 2048,
      web_enabled: state.settings?.web_enabled || false
    };
  }
}));

export default useChat;
