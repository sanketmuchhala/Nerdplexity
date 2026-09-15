import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { chooseAgentByDefault, isAgent, isRouter, routerName } from '../lib/router';
import { RouterMark } from './RouterMark';
import {
  ArrowUpRight,
  ChevronRight,
  Clock3,
  FlaskConical,
  GitCompare,
  Command,
  Cpu,
  FolderOpen,
  Github,
  Menu,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import useChat from '../state/chatStore';
import type { WorkspaceDocument } from '../lib/db';
import { AccountMenu } from './AccountMenu';
import useAccount from '../state/account';
import * as store from '../lib/store';
import useConnections, { currentRouterPool } from '../state/connections';
import { WorkbenchDialog } from './WorkbenchDialog';
import { ChatWorkspace } from './ChatWorkspace';
import { Models } from './Models';
import { Documents } from './Documents';
import { Runs } from './Runs';
import { useRun } from './useRun';
import { Compare } from './Compare';
import { Bench } from './Bench';
import { BackendNotice } from './BackendNotice';
import './workspace.css';

const destinations = [
  { id: 'chat', label: 'Chat', icon: MessageSquare, path: '/app' },
  { id: 'models', label: 'Models', icon: Cpu, path: '/app/models' },
  {
    id: 'connections',
    label: 'Connections',
    icon: Settings2,
    path: '/app/connections',
  },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: FolderOpen,
    path: '/app/workspace',
  },
  { id: 'runs', label: 'Run history', icon: Clock3, path: '/app/runs' },
  { id: 'compare', label: 'Compare', icon: GitCompare, path: '/app/compare' },
  { id: 'bench', label: 'Bench', icon: FlaskConical, path: '/app/bench' },
];

export default function Workspace() {
  const state = useChat();
  const {
    settings,
    conversations,
    activeConversationId,
    selectConversation,
    newConversation,
    deleteConversation,
  } = state;
  const navigate = useNavigate();
  const location = useLocation();
  const view = location.pathname.split('/')[2] || 'chat';
  const current = destinations.find((d) => d.id === view) || destinations[0];
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [storageError, setStorageError] = useState('');
  const { account, importedThreads } = useAccount();
  const [sidebar, setSidebar] = useState(false);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const collapsed = settings?.sidebarCollapsed ?? false;
  const theme = settings?.theme ?? 'dark';
  const run = useRun();
  const { connections, catalog, discoverAll } = useConnections();
  const defaultedRouter = useRef(false);
  useEffect(() => {
    void discoverAll();
  }, [discoverAll]);
  // The Free Agent is the default: chosen when nothing is chosen yet, and once in place of the
  // Free Router, which was the automatic default before. A model someone picked is never replaced.
  useEffect(() => {
    if (defaultedRouter.current || !settings) return;
    const earlierDefault = !settings.agentDefault && isRouter(settings.activeModel) && !isAgent(settings.activeModel);
    if (settings.activeModel && !earlierDefault) return;
    if (!currentRouterPool(connections, catalog).models) return;
    defaultedRouter.current = true;
    void chooseAgentByDefault(state).catch(() => { defaultedRouter.current = false; });
  }, [catalog, connections, settings, state]);
  const checking = Object.values(catalog).some((c) => c.status === 'loading');
  const modelCount = Object.values(catalog).reduce(
    (n, c) =>
      n + (c.status === 'done' && c.result.ok ? c.result.models.length : 0),
    0,
  );
  const activeConnection = connections.find(
    (c) => c.id === settings?.activeModel?.connectionId,
  );
  const refreshDocuments = useCallback(async () => {
    try {
      setDocuments(await store.documents.list());
    } catch (reason) {
      setStorageError(`Unable to read workspace documents. ${(reason as Error).message}`);
    }
  }, []);
  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);
  const go = (path: string) => {
    navigate(path);
    setSidebar(false);
    setPalette(false);
  };
  const newThread = async () => {
    try {
      await newConversation();
      go('/app');
    } catch {
      setStorageError('Unable to create a thread.');
    }
  };
  const openConversation = (id: string) => {
    if (!useChat.getState().conversations.some((c) => c.id === id)) {
      setStorageError(
        'This thread was deleted. Its saved output remains in Run history.',
      );
      return;
    }
    selectConversation(id);
    go('/app');
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuery('');
        setPalette((p) => !p);
      }
      if (e.key === 'Escape') {
        setPalette(false);
        setSidebar(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    if (!sidebar) return;
    const previous = document.activeElement as HTMLElement | null;
    const main = document.getElementById('workspace-content');
    if (main) main.inert = true;
    const aside = navigationRef.current;
    const controls = () =>
      Array.from(
        aside?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.getClientRects().length);
    controls()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = controls();
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault();
        items[0]?.focus();
      }
    };
    aside?.addEventListener('keydown', trap);
    return () => {
      if (main) main.inert = false;
      aside?.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, [sidebar]);

  return (
    <div
      className={`np-app ${collapsed ? 'sidebar-collapsed' : ''}`}
      data-theme={theme}
    >
      <a href="#workspace-content" className="np-skip">
        Skip to content
      </a>
      {sidebar && (
        <button
          className="np-sidebar-backdrop"
          tabIndex={-1}
          aria-label="Dismiss navigation backdrop"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside
        ref={navigationRef}
        className={`np-sidebar ${sidebar ? 'open' : ''}`}
        role={sidebar ? 'dialog' : undefined}
        aria-modal={sidebar || undefined}
        aria-label={sidebar ? 'Navigation' : undefined}
      >
        <button
          className="np-icon-button np-close-nav"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        >
          <X size={18} />
        </button>
        <button
          className="np-brand"
          onClick={() => go('/app')}
          aria-label="Nerdplexity home"
        >
          <img
            src="/brand/nerdplexity-lockup-on-dark.svg"
            alt="Nerdplexity"
            width={184}
            height={42}
          />
        </button>
        <button className="np-new-thread" onClick={() => void newThread()}>
          <Plus size={16} />
          <span>New thread</span>
        </button>
        <button
          className="np-import-thread"
          onClick={() => importRef.current?.click()}
        >
          <Upload size={14} />
          Import thread
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          className="np-visually-hidden"
          tabIndex={-1}
          aria-label="Import thread file"
          onChange={async (e) => {
            const input = e.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            try {
              if (file.size > 2_000_000)
                throw new Error('Import a thread smaller than 2 MB.');
              const text = await file.text();
              await state.importThread(text);
              go('/app');
            } catch (error) {
              setStorageError((error as Error).message);
            } finally {
              input.value = '';
            }
          }}
        />
        <button
          className="np-search-trigger"
          onClick={() => {
            setQuery('');
            setSidebar(false);
            setPalette(true);
          }}
        >
          <Search size={15} />
          <span>Search anything</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="np-sidebar-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {destinations.map(({ id, label, icon: Icon, path }) => (
            <button
              key={id}
              className={`np-nav-item ${current.id === id ? 'active' : ''}`}
              aria-current={current.id === id ? 'page' : undefined}
              onClick={() => go(path)}
            >
              <Icon size={16} />
              <span>{label}</span>
              {id === 'workspace' && documents.length > 0 && (
                <small>{documents.length}</small>
              )}
              {current.id === id && <span className="np-nav-indicator" />}
            </button>
          ))}
        </nav>
        <div className="np-sidebar-label np-recent-label">
          RECENT THREADS <span>{conversations.length}</span>
        </div>
        <div className="np-history">
          {conversations.slice(0, 30).map((c) => (
            <div
              className={`np-history-row ${c.id === activeConversationId && current.id === 'chat' ? 'active' : ''}`}
              key={c.id}
            >
              <button onClick={() => openConversation(c.id)} title={c.title}>
                <MessageSquare size={12} />
                <span>{c.title}</span>
              </button>
              <button
                className="np-history-delete"
                aria-label={`Delete thread ${c.title}`}
                title="Delete thread"
                onClick={async () => {
                  if (run.running && run.runConversationId === c.id) {
                    setStorageError(
                      'Stop the active run before deleting its thread.',
                    );
                    return;
                  }
                  if (window.confirm(`Delete “${c.title}”?`))
                    await deleteConversation(c.id);
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {!conversations.length && (
            <p className="np-no-history">
              A fresh start.
              <br />
              Your threads will live here.
            </p>
          )}
        </div>
        {run.running && (
          <button
            className="np-sidebar-run"
            onClick={() => {
              if (run.runConversationId)
                openConversation(run.runConversationId);
            }}
          >
            <span className="np-status ready">
              <i />
            </span>
            Run in progress
            <ChevronRight size={13} />
          </button>
        )}
        <div className="np-sidebar-bottom">
          <button
            className="np-runtime-summary"
            onClick={() => go('/app/models')}
          >
            <span className={`np-status ${modelCount ? 'ready' : ''}`}>
              <i />
            </span>
            <div>
              <strong>
                {isRouter(settings?.activeModel) ? <><RouterMark size={13} /> {routerName(settings?.activeModel)}</> : settings?.activeModel?.modelId || 'No model chosen'}
              </strong>
              <span>
                {checking
                  ? 'Checking connections'
                  : activeConnection
                    ? `${activeConnection.name} · ${modelCount} available`
                    : modelCount
                      ? `${modelCount} model${modelCount === 1 ? '' : 's'} available`
                      : 'Connect a model'}
              </span>
            </div>
            <ChevronRight size={14} />
          </button>
          <div className="np-sidebar-footer">
            <button onClick={() => go('/app/connections')}>
              <Settings2 size={15} />
              Connections
            </button>
            <a
              href="https://github.com/sanketmuchhala/Nerdplexity"
              target="_blank"
              rel="noreferrer"
              aria-label="Nerdplexity on GitHub"
            >
              <Github size={15} />
            </a>
            <span>LOCAL WORKSPACE</span>
          </div>
        </div>
      </aside>
      <main id="workspace-content" className="np-main">
        <header className="np-topbar">
          <div>
            <button
              className="np-icon-button np-menu"
              aria-label="Open navigation"
              onClick={() => setSidebar(true)}
            >
              <Menu size={18} />
            </button>
            <button
              className="np-icon-button np-collapse-nav"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() =>
                void state.saveSettings({ sidebarCollapsed: !collapsed })
              }
            >
              {collapsed ? (
                <PanelLeftOpen size={17} />
              ) : (
                <PanelLeftClose size={17} />
              )}
            </button>
            <span className="np-breadcrumb">Personal workspace</span>
            <ChevronRight size={12} />
            <span>{current.label}</span>
          </div>
          <div>
            <button
              className="np-icon-button"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={() =>
                void state.saveSettings({
                  theme: theme === 'dark' ? 'light' : 'dark',
                })
              }
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <span className="np-top-note">Your space. Your rules.</span>
            <AccountMenu />
          </div>
        </header>
        <BackendNotice />
        {importedThreads ? (
          <div className="np-success np-storage-error" role="status">
            Copied {importedThreads} {importedThreads === 1 ? 'thread' : 'threads'} from this browser to {account?.local === false ? 'your account' : 'the Nerdplexity server'}.
            <button onClick={() => useAccount.setState({ importedThreads: undefined })} className="np-icon-button" aria-label="Dismiss">
              <X size={13} />
            </button>
          </div>
        ) : null}
        {storageError && (
          <div className="np-error np-storage-error" role="alert">
            {storageError}
            <button
              onClick={() => setStorageError('')}
              className="np-icon-button"
              aria-label="Dismiss storage error"
            >
              <X size={13} />
            </button>
          </div>
        )}
        {current.id === 'models' || current.id === 'connections' ? (
          <Models
            onChat={() => go('/app')}
            connectionsOnly={current.id === 'connections'}
          />
        ) : current.id === 'workspace' ? (
          <Documents documents={documents} refresh={refreshDocuments} />
        ) : current.id === 'runs' ? (
          <Runs openConversation={openConversation} />
        ) : current.id === 'compare' ? (
          <Compare onChat={() => go('/app')} />
        ) : current.id === 'bench' ? (
          <Bench />
        ) : (
          <ChatWorkspace
            run={run}
            documents={documents}
            onModels={() => go('/app/models')}
            onDocuments={() => go('/app/workspace')}
          />
        )}
      </main>
      {palette && (
        <WorkbenchDialog
          title="Search workspace"
          onClose={() => setPalette(false)}
        >
          <div className="np-command-dialog">
            <div className="np-command-input">
              <Search size={19} />
              <input
                autoFocus
                placeholder="Search pages and threads…"
                aria-label="Search pages and threads"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className="np-icon-button"
                onClick={() => setPalette(false)}
                aria-label="Close search"
              >
                <X size={16} />
              </button>
            </div>
            <div className="np-command-results">
              {destinations
                .filter((d) =>
                  d.label.toLowerCase().includes(query.toLowerCase()),
                )
                .map((d) => (
                  <button key={d.id} onClick={() => go(d.path)}>
                    <d.icon size={16} />
                    {d.label}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              {conversations
                .filter((c) =>
                  `${c.title} ${c.messages.map((m) => m.content).join(' ')}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .slice(0, 10)
                .map((c) => (
                  <button key={c.id} onClick={() => openConversation(c.id)}>
                    <MessageSquare size={15} />
                    <span>{c.title}</span>
                    <ChevronRight size={13} />
                  </button>
                ))}
              {query &&
                !destinations.some((d) =>
                  d.label.toLowerCase().includes(query.toLowerCase()),
                ) &&
                !conversations.some((c) =>
                  `${c.title} ${c.messages.map((m) => m.content).join(' ')}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                ) && <p>No matching pages or threads.</p>}
            </div>
            <footer>
              <Command size={12} />
              Search your workspace <span>Escape to close</span>
            </footer>
          </div>
        </WorkbenchDialog>
      )}
    </div>
  );
}
