import Dexie, { Table } from 'dexie';
import type { Connection, ConnectionKind, ModelRef } from '@app/types';

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
  /** Which model produced an assistant message. Absent on legacy messages: unknown. */
  provenance?: ModelRef;
}

export interface Conversation {
  id: string;
  title: string;
  /** Legacy provider label, kept for older screens. Routing uses connectionId. */
  provider: Provider;
  model: string;
  runtime?: RuntimeKind;
  /** Connection for the next run. `model` is the model ID on that connection. */
  connectionId?: string;
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
  /** Default model for new threads. */
  activeModel?: ModelRef;
  /** Favorite models as `${connectionId}::${modelId}` keys. */
  favoriteModels?: string[];
  /** Set once legacy provider settings have been converted to connections. */
  connectionsVersion?: number;
}

/** A key remembered on this device. Session-only keys never reach IndexedDB. */
export interface StoredCredential {
  connectionId: string;
  key: string;
  savedAt: number;
}

export class ChatDatabase extends Dexie {
  conversations!: Table<Conversation>;
  settings!: Table<AppSettings>;
  events!: Table<PromptEvent>;
  documents!: Table<WorkspaceDocument>;
  runs!: Table<RunRecord>;
  connections!: Table<Connection>;
  credentials!: Table<StoredCredential>;

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
    this.version(4).stores({
      conversations: 'id, title, provider, model, createdAt, updatedAt, connectionId',
      settings: '++id',
      events: 'id, ts, corr_id, provider, model',
      documents: 'id, title, updatedAt',
      runs: 'id, conversationId, startedAt, status',
      connections: 'id, kind',
      credentials: 'connectionId'
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

export const HOSTED_PROVIDERS = ['openai', 'anthropic', 'gemini', 'deepseek'] as const;
export const PROVIDER_LABELS: Record<ConnectionKind, string> = {
  ollama: 'Ollama',
  'openai-compatible': 'OpenAI compatible',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
};
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_COMPATIBLE_URL = 'http://127.0.0.1:1234/v1';
const CONNECTIONS_VERSION = 1;

/** Connection ID for a legacy conversation's provider/runtime pair. */
export const legacyConnectionId = (provider: string, runtime?: RuntimeKind) =>
  provider === 'local-ollama' ? (runtime === 'openai-compatible' ? 'lmstudio' : 'ollama') : provider;

/** Legacy provider label for a connection kind, for screens that still read `provider`. */
export const legacyProvider = (kind: ConnectionKind): Provider =>
  kind === 'ollama' || kind === 'openai-compatible' ? 'local-ollama' : kind;

/**
 * Convert per-provider settings into connections. Idempotent: adds only missing
 * connections, fills only missing conversation connection IDs, and moves saved
 * keys into the credentials table. Runs in one transaction, so a failure leaves
 * the previous data untouched.
 */
export async function migrateLegacyData(database: ChatDatabase = db) {
  await database.transaction('rw', [database.settings, database.conversations, database.connections, database.credentials], async () => {
    const settings = await database.settings.get(1);
    const now = Date.now();
    const existing = new Set((await database.connections.toArray()).map(c => c.id));
    const add = async (connection: Omit<Connection, 'createdAt' | 'updatedAt' | 'enabled'>) => {
      if (existing.has(connection.id)) return;
      await database.connections.add({ ...connection, enabled: true, createdAt: now, updatedAt: now });
      existing.add(connection.id);
    };
    await add({ id: 'ollama', kind: 'ollama', name: 'Ollama', baseURL: settings?.baseURL || DEFAULT_OLLAMA_URL, keyStorage: 'none' });
    await add({ id: 'lmstudio', kind: 'openai-compatible', name: 'LM Studio / llama.cpp', baseURL: settings?.compatibleBaseURL || DEFAULT_COMPATIBLE_URL, keyStorage: 'none' });

    const conversations = await database.conversations.toArray();
    const referenced = new Set<string>(conversations.map(c => c.provider));
    if (settings?.selectedProvider) referenced.add(settings.selectedProvider);
    for (const provider of HOSTED_PROVIDERS) {
      const key = settings?.apiKeys?.[provider]?.trim();
      if (key) await database.credentials.put({ connectionId: provider, key, savedAt: now });
      if (key || referenced.has(provider)) {
        await add({ id: provider, kind: provider, name: PROVIDER_LABELS[provider], keyStorage: key ? 'device' : 'session' });
        if (key) await database.connections.update(provider, { keyStorage: 'device', updatedAt: now });
      }
    }

    for (const conversation of conversations) {
      if (conversation.connectionId) continue;
      await database.conversations.update(conversation.id, { connectionId: legacyConnectionId(conversation.provider, conversation.runtime) });
    }

    if (settings) {
      const runtime = settings.localRuntime || 'ollama';
      const localModel = settings.localModels?.[runtime];
      const activeModel = settings.activeModel ?? (settings.selectedProvider === 'local-ollama' && localModel
        ? { connectionId: legacyConnectionId('local-ollama', runtime), modelId: localModel }
        : undefined);
      const apiKeys = Object.fromEntries(Object.keys(settings.apiKeys || {}).map(k => [k, ''])) as AppSettings['apiKeys'];
      await database.settings.put({ ...settings, apiKeys, activeModel, connectionsVersion: CONNECTIONS_VERSION });
    }
  });
}

const hasLegacyKeys = (settings?: AppSettings) => Object.values(settings?.apiKeys || {}).some(k => typeof k === 'string' && k.trim());

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
        baseURL: DEFAULT_OLLAMA_URL,
        num_ctx: 8192,
        localRuntime: 'ollama'
      };
      await db.settings.put(defaultSettings);
    }
    const settings = await db.settings.get(1);
    if (!settings?.connectionsVersion || hasLegacyKeys(settings)) await migrateLegacyData();
  } catch (error) {
    console.error('Database initialization failed:', error);
    // Surface to the app so it can offer a retry without clearing data.
    throw error;
  }
};
