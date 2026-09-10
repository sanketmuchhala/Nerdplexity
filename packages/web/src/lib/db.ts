import Dexie, { Table } from 'dexie';

export type Provider = "openai" | "anthropic" | "gemini" | "deepseek" | "local-ollama";
export type Role = "system" | "user" | "assistant";
export type RuntimeKind = 'ollama' | 'openai-compatible';
export interface WorkspaceDocument { id: string; title: string; content: string; updatedAt: number }
export interface RunRecord {
  id: string; conversationId: string; model: string; provider: string;
  prompt: string; startedAt: number; durationMs: number;
  status: 'completed' | 'stopped' | 'failed'; mode: 'chat' | 'agent';
  output: string; error?: string; ttftMs?: number;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  tools: { name: string; input: unknown; output: unknown; step: number }[];
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishDate?: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  metadata?: {
    webSearchResults?: WebSearchResult[];
    reasoning?: string;
  };
}

export interface Conversation {
  id: string;
  title: string;
  provider: Provider;
  model: string;
  runtime?: RuntimeKind;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  settings: {
    temperature: number;
    max_tokens?: number;
    web_enabled?: boolean;
  };
  meta?: {
    tokenCounts?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  };
}

export interface PromptEvent {
  id: string;
  ts: string;
  corr_id: string;
  session_id?: string;
  provider: string;
  model: string;
  settings?: any;
  business?: any;
  prompt?: any;
  usage?: any;
  safety?: any;
  quality?: any;
  timing?: {
    latency_ms: number;
    ttft_ms?: number;
  };
  result: {
    status: 'ok' | 'error' | 'refusal';
  };
  retrieval?: {
    web_enabled?: boolean;
    q_plan_ms?: number;
    fetch_ms?: number;
    k?: number;
    hits?: number;
    hosts?: number;
  };
  answer?: {
    text?: string;
    citations?: string[];
  };
}

export interface AppSettings {
  id: number;
  selectedProvider: Provider;
  apiKeys: Record<Provider, string>;
  temperature: number;
  max_tokens: number;
  web_enabled: boolean;
  mode: 'direct' | 'research' | 'coach';
  // Local Ollama specific settings
  baseURL?: string;
  num_ctx?: number;
  performanceMode?: boolean;
  numPredict?: number;
  topP?: number;
  topK?: number;
  numThread?: number;
  localRuntime?: RuntimeKind;
  compatibleBaseURL?: string;
  localModels?: Partial<Record<RuntimeKind, string>>;
}

export class ChatDatabase extends Dexie {
  conversations!: Table<Conversation>;
  settings!: Table<AppSettings>;
  events!: Table<PromptEvent>;
  documents!: Table<WorkspaceDocument>;
  runs!: Table<RunRecord>;

  constructor() {
    super('ChatDatabase');
    
    this.version(1).stores({
      conversations: 'id, title, provider, model, createdAt, updatedAt',
      settings: '++id'
    });
    
    this.version(2).stores({
      conversations: 'id, title, provider, model, createdAt, updatedAt',
      settings: '++id',
      events: 'id, ts, corr_id, provider, model'
    });
    this.version(3).stores({
      conversations: 'id, title, provider, model, createdAt, updatedAt',
      settings: '++id',
      events: 'id, ts, corr_id, provider, model',
      documents: 'id, title, updatedAt',
      runs: 'id, conversationId, startedAt, status'
    });
  }
}

export const db = new ChatDatabase();

// Migration from localStorage if detected
export const migrateFromLocalStorage = async () => {
  try {
    // Check if we have old data in localStorage
    const oldChatHistory = localStorage.getItem('chatHistory');
    const oldSettings = localStorage.getItem('byok-settings');
    const oldApiKeys = localStorage.getItem('byok-api-keys');
    
    if (oldChatHistory || oldSettings || oldApiKeys) {
      console.log('Migrating data from localStorage to IndexedDB...');
      
      // Migrate settings
      if (oldSettings || oldApiKeys) {
        let parsedSettings: any = {};
        let parsedApiKeys: any = {};
        
        try {
          if (oldSettings) parsedSettings = JSON.parse(oldSettings);
          if (oldApiKeys) parsedApiKeys = JSON.parse(oldApiKeys);
        } catch (e) {
          console.warn('Failed to parse old settings/keys', e);
        }
        
        const migratedSettings: AppSettings = {
          id: 1,
          selectedProvider: parsedSettings.selectedProvider || 'openai',
          apiKeys: {
            openai: parsedApiKeys.apiKey || parsedApiKeys.openai || '',
            anthropic: parsedApiKeys.anthropic || '',
            gemini: parsedApiKeys.gemini || '',
            deepseek: parsedApiKeys.deepseek || '',
            'local-ollama': ''
          },
          temperature: parsedSettings.temperature || 0.7,
          max_tokens: parsedSettings.max_tokens || 4000,
          web_enabled: parsedSettings.web_enabled || false,
          mode: parsedSettings.mode || 'direct',
          baseURL: 'http://localhost:11434',
          num_ctx: 4096
        };
        
        await db.settings.put(migratedSettings);
      }
      
      // Migrate conversations
      if (oldChatHistory) {
        try {
          const parsedHistory = JSON.parse(oldChatHistory);
          if (Array.isArray(parsedHistory)) {
            for (const oldChat of parsedHistory) {
              const conversation: Conversation = {
                id: oldChat.id || `migrated-${Date.now()}-${Math.random()}`,
                title: oldChat.title || 'Migrated Chat',
                provider: 'openai', // Default for migrated chats
                model: 'gpt-4o-mini', // Default model
                createdAt: oldChat.timestamp || oldChat.createdAt || Date.now(),
                updatedAt: oldChat.timestamp || oldChat.updatedAt || Date.now(),
                messages: (oldChat.messages || []).map((msg: any, index: number) => ({
                  id: msg.id || `msg-${index}`,
                  role: msg.role,
                  content: msg.content,
                  createdAt: msg.timestamp || msg.createdAt || Date.now()
                })),
                settings: {
                  temperature: 0.7,
                  max_tokens: 4000,
                  web_enabled: false
                }
              };
              
              await db.conversations.put(conversation);
            }
          }
        } catch (e) {
          console.warn('Failed to migrate chat history', e);
        }
      }
      
      // Clear old localStorage data
      localStorage.removeItem('chatHistory');
      localStorage.removeItem('byok-settings');
      localStorage.removeItem('byok-api-keys');
      
      console.log('Migration completed successfully');
    }
  } catch (error) {
    console.error('Migration failed:', error);
  }
};

// Initialize database and run migration
export const initializeDatabase = async () => {
  try {
    await db.open();
    await migrateFromLocalStorage();
    
    // Ensure we have default settings
    const existingSettings = await db.settings.get(1);
    if (!existingSettings) {
      const defaultSettings: AppSettings = {
        id: 1,
        selectedProvider: 'local-ollama',
        apiKeys: {
          openai: '',
          anthropic: '',
          gemini: '',
          deepseek: '',
          'local-ollama': ''
        },
        temperature: 0.7,
        max_tokens: 2048,
        web_enabled: false,
        mode: 'direct',
        baseURL: 'http://localhost:11434',
        num_ctx: 8192,
        localRuntime: 'ollama'
      };
      await db.settings.put(defaultSettings);
    }
  } catch (error) {
    console.error('Database initialization failed:', error);
  }
};
