import React, { useState } from 'react';
import { Plus, Trash2, Settings, Edit2, Check, X } from 'lucide-react';
import { Conversation } from '../lib/db';
import { sanitizeDisplayText } from '../lib/stripEmojis';

const groupByDate = (conversations: Conversation[]) => {
  const now = Date.now();
  const day = 86_400_000;
  const groups: { label: string; items: Conversation[] }[] = [
    { label: 'Today',     items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This week', items: [] },
    { label: 'Earlier',   items: [] },
  ];
  for (const c of conversations) {
    const age = now - new Date(c.updatedAt).getTime();
    if (age < day)         groups[0].items.push(c);
    else if (age < 2*day)  groups[1].items.push(c);
    else if (age < 7*day)  groups[2].items.push(c);
    else                   groups[3].items.push(c);
  }
  return groups.filter(g => g.items.length > 0);
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle]  = useState('');

  const startEdit = (c: Conversation) => { setEditingId(c.id); setEditTitle(c.title); };
  const saveEdit  = () => {
    if (editingId && editTitle.trim()) onRenameChat(editingId, editTitle.trim());
    setEditingId(null); setEditTitle('');
  };
  const cancelEdit = () => { setEditingId(null); setEditTitle(''); };

  const groups = groupByDate(conversations);

  return (
    <aside
      className="flex flex-col h-screen border-r border-[#1e1e22] bg-[#09090b] flex-shrink-0"
      style={{ width: 248 }}
    >
      {/* Logo */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5 mb-5">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(244,63,94,.15)', border: '1px solid rgba(244,63,94,.25)' }}
          >
            <span className="text-[11px] font-bold text-nerdplexity-400">N</span>
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-neutral-100">Nerdplexity</span>
        </div>

        <button
          onClick={onNewChat}
          className="
            w-full flex items-center gap-2 px-3 py-2 rounded-lg
            text-[12px] font-medium text-neutral-400
            border border-[#232328] hover:border-[rgba(244,63,94,.3)]
            hover:text-neutral-200 transition-all duration-150
          "
        >
          <Plus size={13} className="text-nerdplexity-400" />
          New thread
        </button>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2">
        {conversations.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <p className="text-[11px] text-neutral-700">No threads yet</p>
          </div>
        ) : (
          <div className="space-y-5 pb-4">
            {groups.map(group => (
              <div key={group.label}>
                <div className="px-3 mb-1.5">
                  <span className="text-[9px] font-semibold uppercase tracking-[.12em] text-neutral-700">
                    {group.label}
                  </span>
                </div>

                <div className="space-y-px">
                  {group.items.map(conv => {
                    const active  = activeConversationId === conv.id;
                    const editing = editingId === conv.id;
                    return (
                      <div
                        key={conv.id}
                        onClick={() => !editing && onLoadChat(conv.id)}
                        className={`
                          group relative flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer
                          transition-all duration-100
                          ${active
                            ? 'bg-[#1a1a1e] border-l-[2px] border-nerdplexity-500 pl-[10px]'
                            : 'border-l-[2px] border-transparent hover:bg-[#141416] hover:pl-[10px]'}
                        `}
                      >
                        {editing ? (
                          <div className="flex items-center gap-1 flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                            <input
                              autoFocus
                              value={editTitle}
                              onChange={e => setEditTitle(e.target.value)}
                              onKeyDown={e => { if (e.key==='Enter') saveEdit(); if (e.key==='Escape') cancelEdit(); }}
                              className="flex-1 min-w-0 text-[12px] bg-[#1c1c20] text-neutral-100 border border-[#2e2e36] rounded px-2 py-0.5 outline-none focus:border-nerdplexity-600"
                            />
                            <button onClick={saveEdit}   className="p-1 text-nerdplexity-400 hover:text-nerdplexity-300"><Check size={11}/></button>
                            <button onClick={cancelEdit} className="p-1 text-neutral-600 hover:text-neutral-400"><X size={11}/></button>
                          </div>
                        ) : (
                          <>
                            <span className={`flex-1 min-w-0 text-[12px] truncate leading-snug ${active ? 'text-neutral-100' : 'text-neutral-500 group-hover:text-neutral-300'}`}>
                              {sanitizeDisplayText(conv.title)}
                            </span>
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0 transition-opacity">
                              <button onClick={e => { e.stopPropagation(); startEdit(conv); }} className="p-1 text-neutral-700 hover:text-neutral-300 rounded"><Edit2 size={10}/></button>
                              <button onClick={e => { e.stopPropagation(); if(confirm('Delete?')) onDeleteChat(conv.id); }} className="p-1 text-neutral-700 hover:text-nerdplexity-400 rounded"><Trash2 size={10}/></button>
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

      {/* Footer */}
      <div className="px-3 py-4 border-t border-[#1e1e22]">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] text-neutral-600 hover:text-neutral-300 hover:bg-[#141416] transition-all"
        >
          <Settings size={13} />
          Settings
        </button>
      </div>
    </aside>
  );
};
