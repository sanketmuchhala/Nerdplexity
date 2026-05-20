import { useState } from 'react';
import { Plus, Trash2, Edit2, Check, X, Settings, MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Conversation } from '../lib/db';
import { sanitizeDisplayText } from '../lib/stripEmojis';

const group = (convs: Conversation[]) => {
  const now = Date.now(), D = 86_400_000;
  const buckets = [
    { label: 'Today',     items: [] as Conversation[] },
    { label: 'Yesterday', items: [] as Conversation[] },
    { label: 'This week', items: [] as Conversation[] },
    { label: 'Earlier',   items: [] as Conversation[] },
  ];
  for (const c of convs) {
    const age = now - new Date(c.updatedAt).getTime();
    if      (age < D)     buckets[0].items.push(c);
    else if (age < 2*D)   buckets[1].items.push(c);
    else if (age < 7*D)   buckets[2].items.push(c);
    else                  buckets[3].items.push(c);
  }
  return buckets.filter(b => b.items.length);
};

interface Props {
  conversations: Conversation[];
  activeConversationId: string | null;
  onNewChat: () => void;
  onLoadChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  onOpenSettings: () => void;
}

export function Sidebar({ conversations, activeConversationId, onNewChat, onLoadChat, onDeleteChat, onRenameChat, onOpenSettings }: Props) {
  const [editId, setEditId]     = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const startEdit = (c: Conversation) => { setEditId(c.id); setEditTitle(c.title); };
  const saveEdit  = () => { if (editId && editTitle.trim()) onRenameChat(editId, editTitle.trim()); setEditId(null); };
  const cancelEdit = () => setEditId(null);

  const groups = group(conversations);

  return (
    <aside
      className="flex flex-col h-screen flex-shrink-0"
      style={{ width: 260, background: 'var(--s1)', boxShadow: '1px 0 0 rgba(255,255,255,.05)' }}
    >
      {/* ── Logo + New thread ── */}
      <div className="px-4 pt-4 pb-3" style={{ boxShadow: '0 1px 0 rgba(255,255,255,.05)' }}>
        <Link to="/" className="flex items-center gap-2.5 mb-3 group">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0 transition-all"
            style={{ background: 'var(--blue-dark)', boxShadow: '0 0 10px rgba(59,130,246,.3)', fontFamily: 'Bricolage Grotesque, sans-serif' }}
          >N</div>
          <span
            className="text-sm font-semibold tracking-tight group-hover:text-white transition-colors"
            style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: 'var(--t1)' }}
          >Nerdplexity</span>
        </Link>

        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all"
          style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)', color: 'var(--t2)' }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(59,130,246,.3)';
            (e.currentTarget as HTMLElement).style.color = 'var(--t1)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--b-hi)';
            (e.currentTarget as HTMLElement).style.color = 'var(--t2)';
          }}
        >
          <Plus size={14} style={{ color: 'var(--blue-bright)' }} />
          New thread
        </button>
      </div>

      {/* ── Thread list ── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-2">
        {conversations.length === 0 ? (
          <div className="py-12 text-center px-4">
            <MessageSquare size={18} className="mx-auto mb-2" style={{ color: 'var(--t4)' }} />
            <p className="text-xs" style={{ color: 'var(--t4)' }}>No threads yet</p>
          </div>
        ) : (
          <div className="px-2 space-y-4">
            {groups.map(grp => (
              <div key={grp.label}>
                <div className="px-2 pb-1.5">
                  <span className="t-caps">{grp.label}</span>
                </div>
                <div className="space-y-px">
                  {grp.items.map(conv => {
                    const active  = activeConversationId === conv.id;
                    const editing = editId === conv.id;
                    return (
                      <div
                        key={conv.id}
                        onClick={() => !editing && onLoadChat(conv.id)}
                        className="group relative flex items-center rounded-lg cursor-pointer transition-all duration-100"
                        style={{
                          padding: '6px 10px',
                          background: active ? 'rgba(66,133,244,.08)' : 'transparent',
                          boxShadow: active ? 'inset 2px 0 0 var(--blue)' : 'none',
                        }}
                        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--s2)'; }}
                        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        {editing ? (
                          <div className="flex items-center gap-1 flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                            <input
                              autoFocus
                              value={editTitle}
                              onChange={e => setEditTitle(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                              className="flex-1 min-w-0 text-xs px-2 py-0.5 rounded outline-none"
                              style={{ background: 'var(--s3)', border: '1px solid rgba(59,130,246,.3)', color: 'var(--t1)' }}
                            />
                            <button onClick={saveEdit}   className="p-1 rounded" style={{ color: 'var(--blue-bright)' }}><Check size={10}/></button>
                            <button onClick={cancelEdit} className="p-1 rounded" style={{ color: 'var(--t3)' }}><X size={10}/></button>
                          </div>
                        ) : (
                          <>
                            <span className="flex-1 min-w-0 text-xs truncate leading-snug" style={{ color: active ? 'var(--blue-bright)' : 'var(--t3)' }}>
                              {sanitizeDisplayText(conv.title)}
                            </span>
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity flex-shrink-0">
                              <button
                                onClick={e => { e.stopPropagation(); startEdit(conv); }}
                                className="p-1 rounded transition-colors"
                                style={{ color: 'var(--t4)' }}
                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--t2)'}
                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--t4)'}
                              ><Edit2 size={10}/></button>
                              <button
                                onClick={e => { e.stopPropagation(); if (confirm('Delete?')) onDeleteChat(conv.id); }}
                                className="p-1 rounded transition-colors"
                                style={{ color: 'var(--t4)' }}
                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#f87171'}
                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--t4)'}
                              ><Trash2 size={10}/></button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-3 py-3" style={{ boxShadow: '0 -1px 0 rgba(255,255,255,.05)' }}>
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-xs font-medium transition-all"
          style={{ color: 'var(--t3)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--s2)'; (e.currentTarget as HTMLElement).style.color = 'var(--t1)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--t3)'; }}
        >
          <Settings size={13} /> Settings & API Keys
        </button>
      </div>
    </aside>
  );
}
