import React, { useState } from 'react';
import { Plus, Trash2, Settings, Edit2, Check, X, MessageSquare } from 'lucide-react';
import { Conversation } from '../lib/db';
import { sanitizeDisplayText } from '../lib/stripEmojis';

const Logo: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="flex-shrink-0">
    <rect x="1" y="1" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    <path
      d="M6 6h3l2 4 2-4h1M6 14h8M10 10v4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const groupByDate = (conversations: Conversation[]) => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfWeek = startOfToday - 6 * 86_400_000;

  const groups: { label: string; items: Conversation[] }[] = [
    { label: 'Today',     items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This week', items: [] },
    { label: 'Older',     items: [] },
  ];

  for (const conv of conversations) {
    const t = new Date(conv.updatedAt).getTime();
    if (t >= startOfToday)     groups[0].items.push(conv);
    else if (t >= startOfYesterday) groups[1].items.push(conv);
    else if (t >= startOfWeek) groups[2].items.push(conv);
    else                       groups[3].items.push(conv);
  }

  return groups.filter(g => g.items.length > 0);
};

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onNewChat: () => void;
  onLoadChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, newTitle: string) => void;
  onOpenSettings: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeConversationId,
  onNewChat,
  onLoadChat,
  onDeleteChat,
  onRenameChat,
  onOpenSettings,
}) => {
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editTitle, setEditTitle]   = useState('');

  const handleStartEdit = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const handleSaveEdit = () => {
    if (editingId && editTitle.trim()) onRenameChat(editingId, editTitle.trim());
    setEditingId(null);
    setEditTitle('');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
  };

  const groups = groupByDate(conversations);

  return (
    <div
      className="flex flex-col h-screen bg-neutral-950 border-r border-neutral-700/60"
      style={{ width: 240, minWidth: 240 }}
    >
      {/* Header */}
      <div className="px-4 pt-5 pb-3">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="text-nerdplexity-400">
            <Logo />
          </span>
          <span className="text-sm font-semibold tracking-tight text-neutral-100">
            Nerdplexity
          </span>
        </div>

        <button
          onClick={onNewChat}
          className="
            w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
            text-neutral-300 border border-neutral-700 hover:border-nerdplexity-500/40
            hover:text-neutral-100 hover:bg-neutral-800/60
            transition-all duration-150 cursor-pointer
          "
        >
          <Plus size={14} className="text-nerdplexity-400" />
          New Thread
        </button>
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-1">
        {conversations.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <MessageSquare size={20} className="text-neutral-700 mx-auto mb-2" />
            <p className="text-xs text-neutral-600">No threads yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map(group => (
              <div key={group.label}>
                <div className="px-2 mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600">
                    {group.label}
                  </span>
                </div>

                <div className="space-y-0.5">
                  {group.items.map(conv => {
                    const isActive  = activeConversationId === conv.id;
                    const isEditing = editingId === conv.id;

                    return (
                      <div
                        key={conv.id}
                        onClick={() => !isEditing && onLoadChat(conv.id)}
                        className={`
                          group relative flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer
                          transition-all duration-100
                          ${isActive
                            ? 'bg-neutral-800/70 border-l-2 border-nerdplexity-500'
                            : 'border-l-2 border-transparent hover:bg-neutral-800/40'}
                        `}
                      >
                        {isEditing ? (
                          <div className="flex items-center gap-1 flex-1 min-w-0">
                            <input
                              type="text"
                              value={editTitle}
                              onChange={e => setEditTitle(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter')  handleSaveEdit();
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                              onClick={e => e.stopPropagation()}
                              autoFocus
                              className="
                                flex-1 min-w-0 text-sm bg-neutral-800 text-neutral-100
                                border border-neutral-600 rounded px-2 py-0.5
                                focus:outline-none focus:border-nerdplexity-500/60
                              "
                            />
                            <button
                              onClick={e => { e.stopPropagation(); handleSaveEdit(); }}
                              className="p-1 text-nerdplexity-400 hover:text-nerdplexity-300 rounded"
                            >
                              <Check size={11} />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); handleCancelEdit(); }}
                              className="p-1 text-neutral-500 hover:text-neutral-300 rounded"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm truncate leading-snug ${isActive ? 'text-neutral-100' : 'text-neutral-400 group-hover:text-neutral-200'}`}>
                                {sanitizeDisplayText(conv.title)}
                              </div>
                            </div>

                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0 transition-opacity">
                              <button
                                onClick={e => { e.stopPropagation(); handleStartEdit(conv); }}
                                className="p-1 text-neutral-600 hover:text-neutral-300 rounded transition-colors"
                              >
                                <Edit2 size={11} />
                              </button>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  if (confirm('Delete this conversation?')) onDeleteChat(conv.id);
                                }}
                                className="p-1 text-neutral-600 hover:text-red-400 rounded transition-colors"
                              >
                                <Trash2 size={11} />
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

      {/* Footer */}
      <div className="px-3 py-4 border-t border-neutral-700/60">
        <button
          onClick={onOpenSettings}
          className="
            w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm
            text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50
            transition-all duration-150
          "
        >
          <Settings size={14} />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
};
