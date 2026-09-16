import { useCallback, useEffect, useState } from 'react';
import type { Connection, ModelDescriptor, ModelRef } from '@app/types';
import type { Conversation } from '../lib/db';
import * as store from '../lib/store';
import {
  buildContext,
  settingsErrors,
  workbenchSettings,
  type Preset,
  type WorkbenchSettings,
} from '../lib/workbench';
import useChat from '../state/chatStore';
import { WorkbenchDialog } from './WorkbenchDialog';

export function RunSettings({
  conversation,
  connection,
  model,
  selected,
  prompt,
  onClose,
}: {
  conversation: Conversation | null;
  connection?: Connection;
  model?: ModelDescriptor;
  selected?: ModelRef;
  prompt: string;
  onClose: () => void;
}) {
  const chat = useChat();
  const [draft, setDraft] = useState(() =>
    workbenchSettings(conversation, chat.settings),
  );
  const [presets, setPresets] = useState<Preset[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [presetId, setPresetId] = useState('');
  const preview = buildContext(
    conversation?.messages ?? [],
    prompt,
    draft,
    model,
    connection,
    conversation?.attachments,
  );
  const refreshPresets = useCallback(
    () => store.presets.list().then(setPresets, (err: Error) => setError(`Could not read saved presets. ${err.message}`)),
    [],
  );
  useEffect(() => { void refreshPresets(); }, [refreshPresets]);
  const update = <K extends keyof WorkbenchSettings>(
    key: K,
    value: WorkbenchSettings[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const apply = async () => {
    try {
      if (!chat.activeConversation()) await chat.newConversation();
      const current = useChat.getState().activeConversation();
      if (!current) throw new Error('Unable to create a thread.');
      await chat.setWorkbench(current.id, draft);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const savePreset = async () => {
    try {
      if (settingsErrors(draft).length)
        throw new Error(settingsErrors(draft)[0]);
      if (!selected) throw new Error('Choose a model before saving a preset.');
      if (!name.trim() || name.length > 80)
        throw new Error('Give this preset a name of 1–80 characters.');
      if (presets.length >= 50)
        throw new Error('Remove a preset before saving another (50 maximum).');
      await store.presets.put({
        id: crypto.randomUUID(),
        name: name.trim(),
        model: selected,
        settings: draft,
        updatedAt: Date.now(),
      });
      await refreshPresets();
      setName('');
      setNotice(
        'Preset saved. Apply settings below to use these values in this thread.',
      );
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <WorkbenchDialog title="Run settings" onClose={onClose} sheet>
      <p className="np-dialog-note">
        Settings apply to the next turn in this thread. Every run saves the
        exact input and settings sent.
      </p>
      {error && (
        <p className="np-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="np-success">
          {notice}
        </p>
      )}
      <form
        className="np-settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          void apply();
        }}
      >
        <section>
          <h3>Saved presets</h3>
          <label className="np-field">
            <span>Preset</span>
            <select
              aria-label="Saved preset"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
            >
              <option value="">Choose a preset…</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.model.modelId}
                </option>
              ))}
            </select>
          </label>
          {presetId && (
            <div className="np-settings-actions">
              <button
                type="button"
                className="np-button"
                onClick={async () => {
                  try {
                    const preset = presets.find((p) => p.id === presetId);
                    if (preset) {
                      await chat.applyPreset(preset);
                      onClose();
                    }
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                Use preset
              </button>
              <button
                type="button"
                className="np-button ghost"
                onClick={async () => {
                  try {
                    await store.presets.remove(presetId);
                    setPresetId('');
                    await refreshPresets();
                  } catch {
                    setError('Could not remove the preset.');
                  }
                }}
              >
                Remove preset
              </button>
            </div>
          )}
        </section>
        <section>
          <h3>Instructions and generation</h3>
          <label className="np-field">
            <span>System instruction</span>
            <textarea
              aria-label="System instruction"
              rows={4}
              maxLength={20_000}
              value={draft.systemPrompt}
              placeholder="Optional instructions for this thread"
              onChange={(e) => update('systemPrompt', e.target.value)}
            />
          </label>
          <label className="np-field">
            <span>Temperature</span>
            <select
              aria-label="Temperature mode"
              value={draft.temperatureMode}
              onChange={(e) =>
                update(
                  'temperatureMode',
                  e.target.value as WorkbenchSettings['temperatureMode'],
                )
              }
            >
              <option value="default">Model default (recommended)</option>
              <option
                value="custom"
                disabled={model?.capabilities.temperature === false}
              >
                Custom temperature
                {model?.capabilities.temperature == null
                  ? ' (support unknown)'
                  : ''}
              </option>
            </select>
          </label>
          {draft.temperatureMode === 'custom' && (
            <label className="np-field">
              <span>Temperature value</span>
              <input
                aria-label="Temperature value"
                type="number"
                min={0}
                max={connection?.kind === 'anthropic' ? 1 : 2}
                step={0.1}
                value={draft.temperature}
                onChange={(e) => update('temperature', Number(e.target.value))}
              />
            </label>
          )}
          <label className="np-field">
            <span>Answer length</span>
            <select aria-label="Output limit mode" value={draft.outputMode ?? 'custom'} onChange={(e) => update('outputMode', e.target.value as 'auto' | 'custom')}>
              <option value="auto">Automatic — use available model capacity</option>
              <option value="custom">Custom output limit</option>
            </select>
          </label>
          {draft.outputMode === 'auto' ? <p className="np-dialog-note">Answers can use the model’s available output and context capacity. Providers still enforce their own limits; a higher maximum does not force a longer answer.</p> : (
            <label className="np-field">
              <span>Maximum output tokens</span>
              <input aria-label="Maximum output tokens" type="number" min={1} max={Math.min(model?.maxOutputTokens ?? 128_000, 128_000)} required value={draft.maxTokens} onChange={(e) => update('maxTokens', Number(e.target.value))} />
            </label>
          )}
        </section>
        <section>
          <h3>Context included</h3>
          <label className="np-field">
            <span>Context capacity</span>
            <select aria-label="Context budget mode" value={draft.contextMode ?? 'custom'} onChange={(e) => update('contextMode', e.target.value as 'auto' | 'custom')}>
              <option value="auto">Automatic — use model context</option>
              <option value="custom">Custom context budget</option>
            </select>
          </label>
          {draft.contextMode === 'auto' ? <p className="np-dialog-note">{connection?.kind === 'ollama' ? `Local runtime context stays at ${preview.budget.toLocaleString()} tokens to respect your memory settings.` : preview.limitKnown ? `This model reports ${preview.budget.toLocaleString()} tokens of context.` : 'The server checks the selected model’s limits. The request preview uses a 65,536-token estimate until a model is known.'}</p> : <label className="np-field">
            <span>
              Context budget
              {!model?.contextLength ? ' (model limit unknown)' : ''}
            </span>
            <input
              aria-label="Context budget"
              type="number"
              min={1024}
              max={model?.contextLength ?? 1_048_576}
              required
              value={draft.contextBudget}
              onChange={(e) => update('contextBudget', Number(e.target.value))}
            />
          </label>}
          <label className="np-field">
            <span>Conversation history</span>
            <select
              aria-label="Conversation history"
              value={draft.history}
              onChange={(e) =>
                update(
                  'history',
                  e.target.value as WorkbenchSettings['history'],
                )
              }
            >
              <option value="all">Entire thread</option>
              <option value="recent">
                Recent turns only (keep full transcript)
              </option>
            </select>
          </label>
          {draft.history === 'recent' && (
            <label className="np-field">
              <span>Previous turns to include</span>
              <input
                aria-label="Previous turns to include"
                type="number"
                min={1}
                max={100}
                required
                value={draft.recentTurns}
                onChange={(e) => update('recentTurns', Number(e.target.value))}
              />
            </label>
          )}
          <div className="np-context-summary">
            <strong>
              ~{preview.estimatedTokens.toLocaleString()} input +{' '}
              {preview.effective.maxTokens === undefined ? 'automatic output capacity' : `up to ${preview.effective.maxTokens.toLocaleString()} output tokens`}
            </strong>
            <p>
              {preview.omittedMessages} earlier messages omitted from this
              request. The full transcript is retained.
            </p>
            <p>
              Token estimate uses UTF-8 size, not the model’s tokenizer. Tool
              results add context during agent runs.
            </p>
          </div>
          <details>
            <summary>
              Inspect request messages ({preview.messages.length})
            </summary>
            <div className="np-context-messages">
              {preview.messages.map((m, i) => (
                <div key={i}>
                  <strong>{m.role}</strong>
                  <pre>{typeof m.content === 'string' ? m.content : m.content.map(part => part.type === 'text' ? part.text : `[Image: ${part.mimeType}, ${Math.ceil(part.data.length * 3 / 4 / 1024)} KB]`).join('\n')}</pre>
                </div>
              ))}
            </div>
          </details>
          {preview.warnings.map((w) => (
            <p key={w} className="np-error">
              {w}
            </p>
          ))}
          {preview.notices.map((message) => (
            <p key={message} className="np-success">{message}</p>
          ))}
        </section>
        <section>
          <label className="np-field">
            <span>Save as a reusable preset</span>
            <input
              aria-label="Preset name"
              value={name}
              maxLength={80}
              placeholder="For example: Quick local"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="np-button ghost"
            onClick={() => void savePreset()}
          >
            Save preset
          </button>
        </section>
        <footer>
          <button type="button" className="np-button ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="np-button primary" type="submit">
            Apply to this thread
          </button>
        </footer>
      </form>
    </WorkbenchDialog>
  );
}
