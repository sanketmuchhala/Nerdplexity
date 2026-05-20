import React, { useState } from 'react';
import { Plus, Trash2, Edit2, Check, X, Settings, MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Conversation } from '../lib/db';
import { sanitizeDisplayText } from '../lib/stripEmojis';

/* ── Group conversations by recency ── */
const group = (convs: Conversation[]) => {
  const now = Date.now(), d = 86_400_000;
  const buckets: { label: string; items: Conversation[] }[] = [
    { label: 'Today',     items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This week', items: [] },
    { label: 'Earlier',   items: [] },
  ];
  for (const c of convs) {
    const age = now - new Date(c.updatedAt).getTime();
    if (age < d)       buckets[0].items.push(c);
    else if (age < 2*d) buckets[1].items.push(c);
    else if (age < 7*d) buckets[2].items.push(c);
    else               buckets[3].items.push(c);
  }
  return buckets.filter(b => b.items.length);
};

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onNewChat: () => void;
  onLoadChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  onOpenSettings: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  conversations, activeConversationId,
  onNewChat, onLoadChat, onDeleteChat, onRenameChat, onOpenSettings,
}) => {
  const [editId, setEditId]     = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const startEdit = (c: Conversation) => { setEditId(c.id); setEditTitle(c.title); };
  const saveEdit  = () => { if (editId && editTitle.trim()) onRenameChat(editId, editTitle.trim()); setEditId(null); };
  const cancelEdit = () => setEditId(null);

  const groups = group(conversations);

  return (
    <aside
      className="flex flex-col h-screen flex-shrink-0 relative"
      style={{
        width: 260,
        background: 'var(--s1)',
        borderRight: '1px solid var(--b)',
      }}
    >
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 px-4 pt-5 pb-4" style={{ borderBottom: '1px solid var(--b)' }}>
        {/* Logo row */}
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all"
              style={{ background: 'var(--blue)', boxShadow: '0 0 12px rgba(78,107,255,.35)' }}
            >
              <span
                className="text-xs font-bold text-white"
                style={{ fontFamily: 'Syne, sans-serif' }}
              >N</span>
            </div>
            <span
              className="text-sm font-semibold text-[var(--t1)] group-hover:text-white transition-colors"
              style={{ fontFamily: 'Syne, sans-serif', letterSpacing: '-0.01em' }}
            >
              Nerdplexity
            </span>
          </Link>
        </div>

        {/* New thread button */}
        <button
          onClick={onNewChat}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-[var(--t2)] transition-all duration-150 hover:text-[var(--t1)]"
          style={{ background: 'var(--s2)', border: '1px solid var(--b)' }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(78,107,255,.3)';
            (e.currentTarget as HTMLElement).style.color = 'var(--t1)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--b)';
            (e.currentTarget as HTMLElement).style.color = 'var(--t2)';
          }}
        >
          <Plus size={14} style={{ color: 'var(--blue-hi)' }} />
          <span className="text-[13px] font-medium">New thread</span>
        </button>
      </div>

      {/* ── Thread list ── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-2">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 px-4 text-center">
            <MessageSquare size={20} style={{ color: 'var(--t4)' }} />
            <p className="text-xs text-[var(--t3)]">No threads yet</p>
            <p className="text-xs text-[var(--t4)]">Click "New thread" to start</p>
          </div>
        ) : (
          <div className="px-2 space-y-4">
            {groups.map(grp => (
              <div key={grp.label}>
                <div className="px-2 pb-1.5">
                  <span className="t-label">{grp.label}</span>
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
                          padding: active ? '6px 10px 6px 8px' : '6px 10px',
                          background: active ? 'rgba(78,107,255,.1)' : 'transparent',
                          borderLeft: active ? '2px solid var(--blue)' : '2px solid transparent',
                        }}
                        onMouseEnter={e => {
                          if (!active) {
                            (e.currentTarget as HTMLElement).style.background = 'var(--s2)';
                          }
                        }}
                        onMouseLeave={e => {
                          if (!active) {
                            (e.currentTarget as HTMLElement).style.background = 'transparent';
                          }
                        }}
                      >
                        {editing ? (
                          <div
                            className="flex items-center gap-1 flex-1 min-w-0"
                            onClick={e => e.stopPropagation()}
                          >
                            <input
                              autoFocus
                              value={editTitle}
                              onChange={e => setEditTitle(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                              className="flex-1 min-w-0 text-[12px] px-2 py-0.5 rounded outline-none"
                              style={{
                                background: 'var(--s3)',
                                border: '1px solid rgba(78,107,255,.3)',
                                color: 'var(--t1)',
                              }}
                            />
                            <button onClick={saveEdit}   className="p-1 rounded" style={{ color: 'var(--blue-hi)' }}><Check size={11}/></button>
                            <button onClick={cancelEdit} className="p-1 rounded" style={{ color: 'var(--t3)' }}><X size={11}/></button>
                          </div>
                        ) : (
                          <>
                            <span
                              className="flex-1 min-w-0 text-[12px] truncate leading-snug"
                              style={{ color: active ? '#8fa5ff' : 'var(--t3)' }}
                            >
                              {sanitizeDisplayText(conv.title)}
                            </span>
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                              <button
                                onClick={e => { e.stopPropagation(); startEdit(conv); }}
                                className="p-1 rounded transition-colors"
                                style={{ color: 'var(--t4)' }}
                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--t2)'}
                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--t4)'}
                              >
                                <Edit2 size={10}/>
                              </button>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  if (confirm('Delete this thread?')) onDeleteChat(conv.id);
                                }}
                                className="p-1 rounded transition-colors"
                                style={{ color: 'var(--t4)' }}
                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#f87171'}
                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--t4)'}
                              >
                                <Trash2 size={10}/>
                              </button>
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
      <div className="px-3 py-3" style={{ borderTop: '1px solid var(--b)' }}>
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[12px] transition-all"
          style={{ color: 'var(--t3)' }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = 'var(--s2)';
            (e.currentTarget as HTMLElement).style.color = 'var(--t1)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = 'var(--t3)';
          }}
        >
          <Settings size={14} />
          Settings
        </button>
      </div>
    </aside>
  );
};
