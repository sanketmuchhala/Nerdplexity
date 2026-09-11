import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, BookOpen, ChevronRight, Clock3, Command, Cpu, FolderOpen, Github, Menu, MessageSquare, Plus, Search, Settings2, Trash2, X } from 'lucide-react';
import useChat from '../state/chatStore';
import { db, WorkspaceDocument } from '../lib/db';
import useConnections from '../state/connections';
import { ChatWorkspace } from './ChatWorkspace';
import { Models } from './Models';
import { Documents } from './Documents';
import { Runs } from './Runs';
import { useRun } from './useRun';
import './workspace.css';

const destinations = [
  { id: 'chat', label: 'Chat', icon: MessageSquare, path: '/app' },
  { id: 'models', label: 'Models', icon: Cpu, path: '/app/models' },
  { id: 'workspace', label: 'Workspace', icon: FolderOpen, path: '/app/workspace' },
  { id: 'runs', label: 'Run history', icon: Clock3, path: '/app/runs' },
];

export default function Workspace() {
  const state = useChat();
  const { settings, conversations, activeConversationId, selectConversation, newConversation, deleteConversation } = state;
  const navigate = useNavigate();
  const location = useLocation();
  const view = location.pathname.split('/')[2] || 'chat';
  const current = destinations.find(d => d.id === view) || destinations[0];
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [storageError, setStorageError] = useState('');
  const [sidebar, setSidebar] = useState(false);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState('');
  const paletteRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const run = useRun();
  const { connections, catalog, discoverAll } = useConnections();
  useEffect(() => { void discoverAll(); }, [discoverAll]);
  const checking = Object.values(catalog).some(c => c.status === 'loading');
  const modelCount = Object.values(catalog).reduce((n, c) => n + (c.status === 'done' && c.result.ok ? c.result.models.length : 0), 0);
  const activeConnection = connections.find(c => c.id === settings?.activeModel?.connectionId);
  const refreshDocuments = useCallback(async () => { try { setDocuments(await db.documents.orderBy('updatedAt').reverse().toArray()); } catch { setStorageError('Unable to read workspace documents. Check browser storage.'); } }, []);
  useEffect(() => { void refreshDocuments(); }, [refreshDocuments]);
  const go = (path: string) => { navigate(path); setSidebar(false); setPalette(false); };
  const newThread = async () => { try { await newConversation(); go('/app'); } catch { setStorageError('Unable to create a thread.'); } };
  const openConversation = (id: string) => { if (!useChat.getState().conversations.some(c => c.id === id)) { setStorageError('This thread was deleted. Its saved output remains in Run history.'); return; } selectConversation(id); go('/app'); };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setQuery(''); setPalette(p => !p); }
      if (e.key === 'Escape') { setPalette(false); setSidebar(false); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    if (!palette) return;
    const previous = document.activeElement as HTMLElement | null;
    searchRef.current?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const elements = paletteRef.current?.querySelectorAll<HTMLElement>('button, input, a[href]');
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap); return () => { document.removeEventListener('keydown', trap); previous?.focus(); };
  }, [palette]);

  return <div className="np-app">
    <a href="#workspace-content" className="np-skip">Skip to content</a>
    {sidebar && <button className="np-sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebar(false)}/>}
    <aside className={`np-sidebar ${sidebar ? 'open' : ''}`}>
      <button className="np-brand" onClick={() => go('/app')}><span className="np-brand-mark">n<span>.</span></span><span>Nerdplexity<small>INDEPENDENT INTELLIGENCE</small></span></button>
      <button className="np-new-thread" onClick={() => void newThread()}><Plus size={16}/><span>New thread</span></button>
      <button className="np-search-trigger" onClick={() => { setQuery(''); setPalette(true); }}><Search size={15}/><span>Search anything</span><kbd>⌘ K</kbd></button>
      <div className="np-sidebar-label">WORKSPACE</div><nav aria-label="Main navigation">{destinations.map(({ id, label, icon: Icon, path }) => <button key={id} className={`np-nav-item ${current.id === id ? 'active' : ''}`} aria-current={current.id === id ? 'page' : undefined} onClick={() => go(path)}><Icon size={16}/><span>{label}</span>{id === 'workspace' && documents.length > 0 && <small>{documents.length}</small>}{current.id === id && <span className="np-nav-indicator"/>}</button>)}</nav>
      <div className="np-sidebar-label np-recent-label">RECENT THREADS <span>{conversations.length}</span></div>
      <div className="np-history">{conversations.slice(0, 30).map(c => <div className={`np-history-row ${c.id === activeConversationId && current.id === 'chat' ? 'active' : ''}`} key={c.id}><button onClick={() => openConversation(c.id)} title={c.title}><MessageSquare size={12}/><span>{c.title}</span></button><button className="np-history-delete" aria-label={`Delete thread ${c.title}`} title="Delete thread" onClick={async () => { if (run.running && run.runConversationId === c.id) { setStorageError('Stop the active run before deleting its thread.'); return; } if (window.confirm(`Delete “${c.title}”?`)) await deleteConversation(c.id); }}><Trash2 size={12}/></button></div>)}{!conversations.length && <p className="np-no-history">A fresh start.<br/>Your threads will live here.</p>}</div>
      {run.running && <button className="np-sidebar-run" onClick={() => { if (run.runConversationId) openConversation(run.runConversationId); }}><span className="np-status ready"><i/></span>Run in progress<ChevronRight size={13}/></button>}
      <div className="np-sidebar-bottom"><button className="np-runtime-summary" onClick={() => go('/app/models')}><span className={`np-status ${modelCount ? 'ready' : ''}`}><i/></span><div><strong>{settings?.activeModel?.modelId || 'No model chosen'}</strong><span>{checking ? 'Checking connections' : activeConnection ? `${activeConnection.name} · ${modelCount} available` : modelCount ? `${modelCount} model${modelCount === 1 ? '' : 's'} available` : 'Connect a model'}</span></div><ChevronRight size={14}/></button><div className="np-sidebar-footer"><button onClick={() => go('/app/models')}><Settings2 size={15}/>Connections</button><a href="https://github.com/sanketmuchhala/Nerdplexity" target="_blank" rel="noreferrer" aria-label="Nerdplexity on GitHub"><Github size={15}/></a><span>LOCAL WORKSPACE</span></div></div>
    </aside>
    <main id="workspace-content" className="np-main">
      <header className="np-topbar"><div><button className="np-icon-button np-menu" aria-label="Open navigation" onClick={() => setSidebar(true)}><Menu size={18}/></button><span className="np-breadcrumb">Personal workspace</span><ChevronRight size={12}/><span>{current.label}</span></div><div><span className="np-top-note">Your space. Your rules.</span><span className="np-avatar">N</span></div></header>
      {storageError && <div className="np-error np-storage-error" role="alert">{storageError}<button onClick={() => setStorageError('')} className="np-icon-button" aria-label="Dismiss storage error"><X size={13}/></button></div>}
      {current.id === 'models' ? <Models onChat={() => go('/app')}/> : current.id === 'workspace' ? <Documents documents={documents} refresh={refreshDocuments}/> : current.id === 'runs' ? <Runs openConversation={openConversation}/> : <ChatWorkspace run={run} documents={documents} onModels={() => go('/app/models')} onDocuments={() => go('/app/workspace')}/>}
    </main>
    {palette && <div className="np-dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setPalette(false); }}><div className="np-command-dialog" role="dialog" aria-modal="true" aria-label="Search workspace" ref={paletteRef}><div className="np-command-input"><Search size={19}/><input ref={searchRef} placeholder="Search pages and threads…" aria-label="Search pages and threads" value={query} onChange={e => setQuery(e.target.value)}/><button className="np-icon-button" onClick={() => setPalette(false)} aria-label="Close search"><X size={16}/></button></div><div className="np-command-results">{destinations.filter(d => d.label.toLowerCase().includes(query.toLowerCase())).map(d => <button key={d.id} onClick={() => go(d.path)}><d.icon size={16}/>{d.label}<ArrowUpRight size={13}/></button>)}{conversations.filter(c => c.title.toLowerCase().includes(query.toLowerCase())).slice(0, 10).map(c => <button key={c.id} onClick={() => openConversation(c.id)}><MessageSquare size={15}/><span>{c.title}</span><ChevronRight size={13}/></button>)}{!query && <button onClick={() => go('/app/analytics/dashboard')}><BookOpen size={16}/>Advanced analytics<ArrowUpRight size={13}/></button>}{query && !destinations.some(d => d.label.toLowerCase().includes(query.toLowerCase())) && !conversations.some(c => c.title.toLowerCase().includes(query.toLowerCase())) && <p>No matching pages or threads.</p>}</div><footer><Command size={12}/>Search your workspace <span>Escape to close</span></footer></div></div>}
  </div>;
}
