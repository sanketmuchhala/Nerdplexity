import { useState } from 'react';
import { Check, Search, Star } from 'lucide-react';
import type { ModelDescriptor, ModelRef } from '@app/types';
import useConnections, {
  currentRouterPool,
  isLocal,
  latestResult,
  modelKey,
} from '../state/connections';
import { AGENT_NAME, AGENT_REF, isAgent, isRouter, ROUTER_NAME, ROUTER_REF } from '../lib/router';
import { RouterMark } from './RouterMark';
import useChat from '../state/chatStore';
import { WorkbenchDialog } from './WorkbenchDialog';

export function ModelPicker({
  selected,
  onClose,
  onConnections,
}: {
  selected?: ModelRef;
  onClose: () => void;
  onConnections: () => void;
}) {
  const { connections, catalog } = useConnections();
  const { settings, saveSettings } = useChat();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const favorites = settings?.favoriteModels ?? [];
  const pool = currentRouterPool(connections, catalog);
  const search = query.toLowerCase().trim();
  const showRouter = `${ROUTER_NAME} free auto best`.toLowerCase().includes(search);
  const showAgent = `${AGENT_NAME} free agent best specialists team`.toLowerCase().includes(search);
  const routerActive = isRouter(selected) && !isAgent(selected);
  const agentActive = isAgent(selected);
  const entries = connections
    .filter((c) => c.enabled)
    .flatMap((connection) => {
      const result = latestResult(catalog[connection.id]);
      const models: ModelDescriptor[] = result?.ok ? [...result.models] : [];
      if (
        selected?.connectionId === connection.id &&
        !models.some((m) => m.id === selected.modelId)
      )
        models.unshift({
          id: selected.modelId,
          displayName: selected.modelId,
          capabilities: { tools: null, vision: null },
          pricing: 'unknown',
          source: 'manual',
        });
      return models.map((model) => ({ connection, model }));
    })
    .filter(({ connection, model }) =>
      `${connection.name} ${model.displayName} ${model.id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(favorites.includes(modelKey(b.connection.id, b.model.id))) -
          Number(favorites.includes(modelKey(a.connection.id, a.model.id))) ||
        a.model.displayName.localeCompare(b.model.displayName),
    );

  const choose = async (ref: ModelRef) => {
    try {
      const chat = useChat.getState();
      const conversation = chat.activeConversation();
      if (conversation) await chat.setConversationModel(conversation.id, ref);
      else await chat.saveSettings({ activeModel: ref });
      onClose();
    } catch {
      setError('Could not save the model selection. Try again.');
    }
  };
  return (
    <WorkbenchDialog title="Choose a model" onClose={onClose}>
      <p className="np-dialog-note">
        The next turn uses your selection. Earlier answers keep their original
        model. Context and cost limits are checked before sending.
      </p>
      <label className="np-picker-search">
        <Search size={17} />
        <input
          autoFocus
          aria-label="Search models"
          placeholder="Search model or connection…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {error && (
        <p className="np-error" role="alert">
          {error}
        </p>
      )}
      <div className="np-picker-list">
        {showRouter && (
          <div className={`np-picker-row np-picker-router ${routerActive ? 'active' : ''}`}>
            <button
              className="np-picker-choice"
              aria-label={`Use the ${ROUTER_NAME}`}
              aria-pressed={routerActive}
              onClick={() => void choose(ROUTER_REF)}
            >
              <span>
                <strong><RouterMark size={18} /> {ROUTER_NAME}</strong>
                <small>
                  {pool.models
                    ? `Picks the best of ${pool.models} free model${pool.models === 1 ? '' : 's'} on ${pool.connections} connection${pool.connections === 1 ? '' : 's'} for each message, and tries the next when one is busy`
                    : 'No free models yet: connect OpenRouter with a free key, or a model on this machine'}
                </small>
              </span>
              {routerActive && <Check size={17} />}
            </button>
          </div>
        )}
        {showAgent && (
          <div className={`np-picker-row np-picker-router ${agentActive ? 'active' : ''}`}>
            <button
              className="np-picker-choice"
              aria-label={`Use the ${AGENT_NAME}`}
              aria-pressed={agentActive}
              onClick={() => void choose(AGENT_REF)}
            >
              <span>
                <strong><RouterMark size={18} /> {AGENT_NAME}</strong>
                <small>
                  {pool.models > 1
                    ? `For harder questions, asks the free models best at each kind of task, then the strongest checks their work and writes one answer. Up to 5 free requests per message`
                    : pool.models === 1
                      ? 'Needs two or more free models to combine; with one it answers like the Free Router'
                      : 'No free models yet: connect OpenRouter with a free key, or a model on this machine'}
                </small>
              </span>
              {agentActive && <Check size={17} />}
            </button>
          </div>
        )}
        {entries.map(({ connection, model }) => {
          const key = modelKey(connection.id, model.id);
          const active =
            connection.id === selected?.connectionId &&
            model.id === selected.modelId;
          const favorite = favorites.includes(key);
          return (
            <div
              className={`np-picker-row ${active ? 'active' : ''}`}
              key={key}
            >
              <button
                className="np-picker-choice"
                aria-label={`Use ${model.id} on ${connection.name}`}
                aria-pressed={active}
                onClick={() =>
                  void choose({
                    connectionId: connection.id,
                    modelId: model.id,
                  })
                }
              >
                <span>
                  <strong>{model.displayName}</strong>
                  <small>
                    {connection.name} ·{' '}
                    {isLocal(connection) ? 'Local' : 'Online'}
                    {model.contextLength
                      ? ` · ${model.contextLength.toLocaleString()} context`
                      : ''}
                  </small>
                </span>
                {active && <Check size={17} />}
              </button>
              <button
                className="np-icon-button"
                aria-label={`${favorite ? 'Unfavorite' : 'Favorite'} ${model.id}`}
                aria-pressed={favorite}
                onClick={() =>
                  void saveSettings({
                    favoriteModels: favorite
                      ? favorites.filter((k) => k !== key)
                      : [...favorites, key],
                  })
                }
              >
                <Star size={16} fill={favorite ? 'currentColor' : 'none'} />
              </button>
            </div>
          );
        })}
        {!entries.length && !showRouter && !showAgent && (
          <div className="np-empty-panel">
            <h3>No matching models</h3>
            <p>
              Connect a provider, refresh its catalog, or add a manual model ID
              in Models.
            </p>
          </div>
        )}
      </div>
      <footer>
        <button
          className="np-button ghost"
          onClick={() => {
            onClose();
            onConnections();
          }}
        >
          Manage connections and models
        </button>
      </footer>
    </WorkbenchDialog>
  );
}
