import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { ModelRef } from '@app/types';
import { Conversation, Message, AppSettings, Provider, defaultSettings, legacyProvider, type ThreadAttachment } from '../lib/db';
import * as store from '../lib/store';
import useConnections from './connections';
import { parseConversation, settingsErrors, workbenchSettings, type Preset, type WorkbenchSettings } from '../lib/workbench';

/** Legacy provider label for a connection, for screens that still read `provider`. */
const providerFor = (connectionId: string | undefined, fallback: Provider): Provider => {
  const connection = useConnections.getState().connections.find(c => c.id === connectionId);
  return connection ? legacyProvider(connection.kind) : fallback;
};

type MessageExtra = Partial<Pick<Message, 'provenance' | 'runId' | 'runStatus' | 'finishReason'>>;

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
  addMessage: (role: 'user' | 'assistant' | 'system', content: string, metadata?: Message['metadata'], conversationId?: string, extra?: MessageExtra) => Promise<void>;
  setConversationModel: (id: string, ref: ModelRef) => Promise<void>;
  setAllowCharges: (id: string, allow: boolean) => Promise<void>;
  setWorkbench: (id: string, settings: WorkbenchSettings) => Promise<void>;
  applyPreset: (preset: Preset) => Promise<void>;
  forkConversation: (id: string, beforeMessageId: string) => Promise<void>;
  importThread: (text: string) => Promise<void>;
  addAttachment: (conversationId: string, attachment: ThreadAttachment) => Promise<void>;
  removeAttachment: (conversationId: string, attachmentId: string) => Promise<void>;
  setMessageFeedback: (conversationId: string, messageId: string, feedback?: Message['feedback']) => Promise<void>;
  updateConversationTitle: (id: string, title: string) => Promise<void>;
  updateConversationSettings: (id: string, updates: Partial<Pick<Conversation, 'provider' | 'model'> & Conversation['settings']>) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  saveSettings: (partial: Partial<AppSettings>) => Promise<void>;

  // Helper methods
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

  // Saved data comes from the server. Failures reach the caller, which offers a retry.
  loadConversations: async () => {
    set({ conversations: await store.conversations.list() });
  },

  loadSettings: async () => {
    const saved = await store.settings.get();
    if (saved) { set({ settings: saved }); return; }
    const { apiKeys: _keys, ...defaults } = defaultSettings();
    set({ settings: await store.settings.patch(defaults) });
  },

  // Create new conversation
  newConversation: async (defaults = {}) => {
    const id = uuidv4();
    // New threads use the chosen model; with none chosen, the thread waits for a selection.
    const active = get().settings?.activeModel;

    const conversation: Conversation = {
      id,
      title: "New chat",
      provider: providerFor(active?.connectionId, get().getCurrentProvider()),
      model: active?.modelId || '',
      connectionId: active?.connectionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      settings: get().getDefaultSettings(),
      ...defaults
    };

    try {
      await store.conversations.create(conversation);
    } catch (error) {
      throw new Error(`Unable to save the new thread. ${(error as Error).message}`);
    }
    set(state => ({
      conversations: [conversation, ...state.conversations],
      activeConversationId: id
    }));
  },

  // Select conversation by ID
  selectConversation: (id: string) => {
    set({ activeConversationId: id });
  },

  // Add message to active conversation
  addMessage: async (role: 'user' | 'assistant' | 'system', content: string, metadata?: Message['metadata'], conversationId?: string, extra?: MessageExtra) => {
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
      ...(metadata && { metadata }),
      ...extra
    };

    const updatedConversation: Conversation = {
      ...activeConv,
      messages: [...activeConv.messages, message],
      updatedAt: Date.now(),
      // Auto-generate title from first user message
      title: activeConv.title === 'New chat' && activeConv.messages.length === 0 && role === 'user'
        ? content.slice(0, 50) + (content.length > 50 ? '...' : '')
        : activeConv.title
    };

    try {
      await store.conversations.appendMessage(activeConv.id, message, {
        ...(updatedConversation.title !== activeConv.title ? { title: updatedConversation.title } : {}),
        updatedAt: updatedConversation.updatedAt,
      });
    } catch (error) {
      throw new Error(`Unable to save the message. ${(error as Error).message}`);
    }
    // Merge into the latest state: another message may have been added while this one saved.
    set(state => ({
      conversations: state.conversations.map(c =>
        c.id === activeConv.id ? { ...c, title: updatedConversation.title, updatedAt: updatedConversation.updatedAt, messages: [...c.messages, message] } : c
      )
    }));
  },

  // Update conversation title
  updateConversationTitle: async (id: string, title: string) => {
    const state = get();
    const conversation = state.conversations.find(c => c.id === id);

    if (!conversation) return;

    const updated = { ...conversation, title, updatedAt: Date.now() };

    try {
      await store.conversations.update(id, { title, updatedAt: updated.updatedAt });
    } catch (error) {
      throw new Error(`Unable to save the thread title. ${(error as Error).message}`);
    }
    set(state => ({
      conversations: state.conversations.map(c => c.id === id ? { ...c, title, updatedAt: updated.updatedAt } : c)
    }));
  },

  // Point a thread at a connection and model for its next run. History keeps its provenance.
  setConversationModel: async (id: string, ref: ModelRef) => {
    const conversation = get().conversations.find(c => c.id === id);
    if (!conversation) return;
    const updated: Conversation = {
      ...conversation,
      connectionId: ref.connectionId,
      model: ref.modelId,
      provider: providerFor(ref.connectionId, conversation.provider),
      updatedAt: Date.now()
    };
    await store.conversations.update(id, { connectionId: ref.connectionId, model: ref.modelId, provider: updated.provider, updatedAt: updated.updatedAt });
    set(state => ({ conversations: state.conversations.map(c => c.id === id ? updated : c) }));
  },

  setAllowCharges: async (id: string, allow: boolean) => {
    const conversation = get().conversations.find(c => c.id === id);
    if (!conversation) return;
    const updated: Conversation = { ...conversation, allowCharges: allow, updatedAt: Date.now() };
    await store.conversations.update(id, { allowCharges: allow, updatedAt: updated.updatedAt });
    set(state => ({ conversations: state.conversations.map(c => c.id === id ? updated : c) }));
  },

  setWorkbench: async (id, settings) => {
    if (settingsErrors(settings).length) throw new Error(settingsErrors(settings)[0]);
    const conversation = get().conversations.find(c => c.id === id);
    if (!conversation) throw new Error('This thread is no longer available.');
    const updated = { ...conversation, workbench: structuredClone(settings), updatedAt: Date.now() };
    await store.conversations.update(id, { workbench: updated.workbench, updatedAt: updated.updatedAt });
    set(state => ({ conversations: state.conversations.map(c => c.id === id ? updated : c) }));
  },

  applyPreset: async preset => {
    if (settingsErrors(preset.settings).length) throw new Error(settingsErrors(preset.settings)[0]);
    if (!useConnections.getState().connections.some(c => c.id === preset.model.connectionId)) throw new Error('This preset’s connection was removed. Choose another model and save a new preset.');
    if (!get().activeConversation()) await get().newConversation();
    const conversation = get().activeConversation();
    if (!conversation) throw new Error('Unable to create a thread.');
    const updated: Conversation = { ...conversation, connectionId: preset.model.connectionId, model: preset.model.modelId,
      provider: providerFor(preset.model.connectionId, conversation.provider), workbench: structuredClone(preset.settings), updatedAt: Date.now() };
    await store.conversations.update(updated.id, { connectionId: updated.connectionId, model: updated.model, provider: updated.provider, workbench: updated.workbench, updatedAt: updated.updatedAt });
    set(state => ({ conversations: state.conversations.map(c => c.id === updated.id ? updated : c) }));
  },

  forkConversation: async (id, beforeMessageId) => {
    const conversation = get().conversations.find(c => c.id === id);
    const index = conversation?.messages.findIndex(m => m.id === beforeMessageId) ?? -1;
    if (!conversation || index < 0) throw new Error('The source message is no longer available.');
    // The server copies the earlier messages and attachments, so nothing is uploaded again.
    // A new branch does not inherit permission to charge an account.
    const branch = await store.conversations.fork(id, {
      id: uuidv4(), beforeMessageId, title: `${conversation.title.slice(0, 170)} (branch)`,
      workbench: structuredClone(workbenchSettings(conversation, get().settings)), createdAt: Date.now(),
    });
    set(state => ({ conversations: [branch, ...state.conversations], activeConversationId: branch.id }));
  },

  importThread: async text => {
    const imported = parseConversation(text);
    // Imported IDs and model destinations cannot overwrite or auto-route a local thread.
    await get().newConversation({ ...imported, connectionId: undefined, model: '', allowCharges: false });
  },

  addAttachment: async (conversationId, attachment) => {
    const conversation = get().conversations.find(c => c.id === conversationId);
    if (!conversation) throw new Error('Create a thread before attaching a file.');
    const updated = { ...conversation, attachments: [...(conversation.attachments ?? []), attachment], updatedAt: Date.now() };
    await store.conversations.addAttachment(conversationId, attachment);
    set(state => ({ conversations: state.conversations.map(c => c.id === conversationId ? updated : c) }));
  },

  removeAttachment: async (conversationId, attachmentId) => {
    const conversation = get().conversations.find(c => c.id === conversationId);
    if (!conversation) return;
    const updated = { ...conversation, attachments: (conversation.attachments ?? []).filter(file => file.id !== attachmentId), updatedAt: Date.now() };
    await store.conversations.removeAttachment(conversationId, attachmentId);
    set(state => ({ conversations: state.conversations.map(c => c.id === conversationId ? updated : c) }));
  },

  setMessageFeedback: async (conversationId, messageId, feedback) => {
    const conversation = get().conversations.find(c => c.id === conversationId);
    if (!conversation) throw new Error('This thread is no longer available.');
    const updated: Conversation = {
      ...conversation,
      messages: conversation.messages.map(message => message.id === messageId ? { ...message, feedback } : message),
      updatedAt: Date.now(),
    };
    await store.conversations.setFeedback(conversationId, messageId, feedback);
    set(state => ({ conversations: state.conversations.map(item => item.id === conversationId ? updated : item) }));
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
      await store.conversations.update(id, { provider: updated.provider, model: updated.model, settings: updated.settings, updatedAt: updated.updatedAt });
      set(state => ({
        conversations: state.conversations.map(c => c.id === id ? updated : c)
      }));
    } catch (error) {
      console.error('Failed to update conversation settings:', (error as Error).message);
    }
  },

  // Delete conversation
  deleteConversation: async (id: string) => {
    try {
      await store.conversations.remove(id);
      set(state => ({
        conversations: state.conversations.filter(c => c.id !== id),
        activeConversationId: state.activeConversationId === id ? null : state.activeConversationId
      }));
    } catch (error) {
      console.error('Failed to delete conversation:', (error as Error).message);
    }
  },

  // Save settings
  saveSettings: async (partial: Partial<AppSettings>) => {
    const state = get();
    const currentSettings = state.settings;

    if (!currentSettings) return;

    try {
      // Publish the value only after it is durable. The server merges, so independent saves do not overwrite each other.
      set({ settings: await store.settings.patch(partial) });
    } catch (error) {
      console.error('Failed to save settings:', (error as Error).message);
    }
  },

  // Helper: get current provider from settings
  getCurrentProvider: (): Provider => {
    const settings = get().settings;
    return providerFor(settings?.activeModel?.connectionId, settings?.selectedProvider || 'local-ollama');
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
