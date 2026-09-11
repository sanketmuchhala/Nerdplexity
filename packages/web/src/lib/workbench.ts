import type {
  Connection,
  ModelDescriptor,
  ModelRef,
  RunMessage,
  RunStartRequest,
} from '@app/types';
import type { AppSettings, Conversation, Message } from './db';

export interface WorkbenchSettings {
  systemPrompt: string;
  temperature: number;
  temperatureMode: 'default' | 'custom';
  maxTokens: number;
  contextBudget: number;
  history: 'all' | 'recent';
  recentTurns: number;
}

export interface Preset {
  id: string;
  name: string;
  model: ModelRef;
  settings: WorkbenchSettings;
  updatedAt: number;
}

export interface InputSnapshot {
  messages: RunMessage[];
  settings: NonNullable<RunStartRequest['settings']>;
  configured: WorkbenchSettings;
  context: {
    estimatedTokens: number;
    budget: number;
    omittedMessages: number;
    limitKnown: boolean;
  };
  documents: { id: string; title: string; content: string }[];
}

export function workbenchSettings(
  conversation?: Conversation | null,
  defaults?: AppSettings | null,
): WorkbenchSettings {
  return {
    systemPrompt: '',
    temperature:
      conversation?.settings.temperature ?? defaults?.temperature ?? 0.7,
    temperatureMode: 'default',
    maxTokens:
      conversation?.settings.max_tokens ?? defaults?.max_tokens ?? 2048,
    contextBudget: defaults?.num_ctx ?? 8192,
    history: 'all',
    recentTurns: 6,
    ...conversation?.workbench,
  };
}

/** An estimate for preview only. Provider tokenizers and chat templates differ. */
export function estimateTokens(messages: RunMessage[]): number {
  return messages.reduce(
    (total, message) =>
      total +
      Math.ceil(new TextEncoder().encode(message.content).length / 3) +
      8,
    0,
  );
}

export function settingsErrors(settings: WorkbenchSettings): string[] {
  const errors: string[] = [];
  if (
    typeof settings.systemPrompt !== 'string' ||
    settings.systemPrompt.length > 20_000
  )
    errors.push('Keep the system instruction under 20,000 characters.');
  if (
    !['default', 'custom'].includes(settings.temperatureMode) ||
    !Number.isFinite(settings.temperature) ||
    settings.temperature < 0 ||
    settings.temperature > 2
  )
    errors.push('Use a temperature from 0 to 2.');
  if (
    !Number.isInteger(settings.maxTokens) ||
    settings.maxTokens < 1 ||
    settings.maxTokens > 128_000
  )
    errors.push('Use 1–128,000 maximum output tokens.');
  if (
    !Number.isInteger(settings.contextBudget) ||
    settings.contextBudget < 1024 ||
    settings.contextBudget > 1_048_576
  )
    errors.push('Use a context budget from 1,024 to 1,048,576 tokens.');
  if (
    !['all', 'recent'].includes(settings.history) ||
    !Number.isInteger(settings.recentTurns) ||
    settings.recentTurns < 1 ||
    settings.recentTurns > 100
  )
    errors.push('Include between 1 and 100 recent turns.');
  return errors;
}

export function buildContext(
  history: Pick<Message, 'role' | 'content'>[],
  prompt: string,
  settings: WorkbenchSettings,
  model?: ModelDescriptor,
  connection?: Connection,
) {
  const system = history.filter((m) => m.role === 'system');
  const dialog = history.filter((m) => m.role !== 'system');
  let included = dialog;
  if (settings.history === 'recent') {
    const starts = dialog.flatMap((m, index) =>
      m.role === 'user' ? [index] : [],
    );
    const start = starts[Math.max(0, starts.length - settings.recentTurns)];
    included = start === undefined ? dialog : dialog.slice(start);
  }
  const messages: RunMessage[] = [
    ...system.map(({ role, content }) => ({ role, content })),
    ...(settings.systemPrompt.trim()
      ? [{ role: 'system' as const, content: settings.systemPrompt }]
      : []),
    ...included.map(({ role, content }) => ({ role, content })),
    ...(prompt.trim() ? [{ role: 'user' as const, content: prompt }] : []),
  ];
  const budget = Math.min(
    settings.contextBudget,
    model?.contextLength ?? Infinity,
  );
  const estimatedTokens = estimateTokens(messages);
  const omittedMessages = dialog.length - included.length;
  // Gemini's catalog describes its input limit; conservatively reserve output in the workbench budget anyway.
  const warnings = settingsErrors(settings);
  if (estimatedTokens + settings.maxTokens > budget)
    warnings.push(
      'The estimated input plus reserved output exceeds the context budget. Reduce output, increase the budget, or explicitly include fewer recent turns.',
    );
  if (model?.maxOutputTokens && settings.maxTokens > model.maxOutputTokens)
    warnings.push(
      `This model reports a maximum output of ${model.maxOutputTokens.toLocaleString()} tokens.`,
    );
  if (
    messages.length > 200 ||
    messages.reduce((n, m) => n + m.content.length, 0) > 200_000
  )
    warnings.push(
      'This request exceeds the app’s message or text limit. Include fewer recent turns.',
    );
  if (
    settings.temperatureMode === 'custom' &&
    model?.capabilities.temperature === false
  )
    warnings.push(
      'This model does not accept temperature. Choose the model default.',
    );
  if (
    settings.temperatureMode === 'custom' &&
    connection?.kind === 'anthropic' &&
    settings.temperature > 1
  )
    warnings.push('Use a temperature of 0–1 for this connection.');
  const effective: InputSnapshot['settings'] = {
    maxTokens: settings.maxTokens,
    ...(settings.temperatureMode === 'custom'
      ? { temperature: settings.temperature }
      : {}),
    ...(connection?.kind === 'ollama' ? { numCtx: budget } : {}),
  };
  return {
    messages,
    effective,
    estimatedTokens,
    budget,
    omittedMessages,
    limitKnown: !!model?.contextLength,
    warnings,
  };
}

export function exportConversation(conversation: Conversation): string {
  // A whitelist prevents credentials, connection destinations, or charge permissions entering an export.
  return JSON.stringify(
    {
      format: 'nerdplexity-thread',
      version: 1,
      title: conversation.title,
      messages: conversation.messages.map((m) => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        ...(m.provenance
          ? {
              provenance: {
                connectionId: m.provenance.connectionId,
                modelId: m.provenance.modelId,
              },
            }
          : {}),
        ...(m.metadata?.reasoning ? { reasoning: m.metadata.reasoning } : {}),
      })),
    },
    null,
    2,
  );
}

export function parseConversation(
  text: string,
): Pick<Conversation, 'title' | 'messages'> {
  if (new TextEncoder().encode(text).length > 2_000_000)
    throw new Error('Import a thread smaller than 2 MB.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!data || typeof data !== 'object')
    throw new Error('Choose a Nerdplexity thread export.');
  const value = data as Record<string, unknown>;
  if (
    value.format !== 'nerdplexity-thread' ||
    value.version !== 1 ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    value.title.length > 200 ||
    !Array.isArray(value.messages) ||
    value.messages.length > 1000
  )
    throw new Error('Choose a supported Nerdplexity thread export.');
  const messages: Message[] = value.messages.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object')
      throw new Error('A message in this file is invalid.');
    const m = entry as Record<string, unknown>;
    if (
      !['user', 'assistant', 'system'].includes(m.role as string) ||
      typeof m.content !== 'string' ||
      m.content.length > 200_000
    )
      throw new Error('A message in this file is invalid or too large.');
    const p = m.provenance as Record<string, unknown> | undefined;
    return {
      id: crypto.randomUUID(),
      role: m.role as Message['role'],
      content: m.content,
      createdAt:
        typeof m.createdAt === 'number' && Number.isFinite(m.createdAt)
          ? m.createdAt
          : Date.now(),
      ...(p &&
      typeof p.connectionId === 'string' &&
      typeof p.modelId === 'string'
        ? { provenance: { connectionId: p.connectionId, modelId: p.modelId } }
        : {}),
      ...(typeof m.reasoning === 'string'
        ? { metadata: { reasoning: m.reasoning } }
        : {}),
    };
  });
  return { title: value.title, messages };
}
