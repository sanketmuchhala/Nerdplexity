// Shared types for BYOK Research Copilot

export type Provider = "openai" | "anthropic" | "gemini" | "deepseek";
export type Role = "system" | "user" | "assistant";
export type TaskType = 'direct' | 'research' | 'write' | 'code' | 'math' | 'critique';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

// Core Message Types
export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  metadata?: MessageMetadata;
}

export interface MessageMetadata {
  webSearchResults?: WebSearchResult[];
  reasoning?: string;
  assumptions?: string[];
  confidence?: ConfidenceLevel;
  followUps?: string[];
  reportCard?: ReportCardItem[];
  contextUsed?: MemoryItem[];
}

// Web Search
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishDate?: string;
}

// Memory System
export interface MemoryItem {
  id: string;
  conversationId?: string;
  text: string;
  type: 'fact' | 'decision' | 'definition' | 'todo' | 'code';
  timestamp: number;
  vector?: number[];
  userPin?: boolean;
  relevanceScore?: number;
}

// Report Card
export interface ReportCardItem {
  category: 'correctness' | 'completeness' | 'evidence' | 'safety' | 'clarity' | 'actionability';
  status: 'pass' | 'warning';
  note?: string;
}

// Orchestrator
export interface PromptOrchestration {
  originalQuery: string;
  rewrittenQuery?: string;
  assumptions?: string[];
  taskType: TaskType;
  reasoningPlan?: string[];
  sourcePlan?: string[];
  confidence?: ConfidenceLevel;
  webSearchEnabled?: boolean;
  reasoningEnabled?: boolean;
}

// API Types
export interface ChatRequest {
  messages: ChatMessage[];
  provider: Provider | 'auto';
  model: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  api_key: string;
  web_search?: boolean;
  show_reasoning?: boolean;
  orchestration?: PromptOrchestration;
}

export interface ChatResponse {
  message: ChatMessage;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  webSearchResults?: WebSearchResult[];
  reasoning?: string;
  assumptions?: string[];
  confidence?: ConfidenceLevel;
  followUps?: string[];
  reportCard?: ReportCardItem[];
}

// Database Types  
export interface Conversation {
  id: string;
  title: string;
  provider: Provider;
  model: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  settings: ConversationSettings;
  summary?: string;
}

export interface ConversationSettings {
  temperature: number;
  max_tokens?: number;
  web_enabled?: boolean;
  reasoning_enabled?: boolean;
}

export interface AppSettings {
  id: number;
  selectedProvider: Provider;
  apiKeys: Record<Provider, string>;
  temperature: number;
  max_tokens: number;
  web_enabled: boolean;
  reasoning_enabled: boolean;
  mode: 'direct' | 'research' | 'coach';
  theme: 'dark' | 'light';
}

// Error Types
export interface APIError {
  code: string;
  message: string;
  provider?: Provider;
  status?: number;
}
export * from "./connections";
