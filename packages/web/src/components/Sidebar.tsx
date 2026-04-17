import React, { useState } from 'react';
import { Plus, Trash2, Settings, Edit2, Check, X } from 'lucide-react';
import { Conversation } from '../lib/db';
import { sanitizeDisplayText } from '../lib/stripEmojis';

// Nerdplexity Logo Component
const NerdplexityLogo: React.FC<{ size?: number; className?: string }> = ({ size = 20, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
  >
    {/* Nerdplexity symbol - outer circle with nerdplexity symbol */}
    <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1" fill="none"/>

    {/* Nerdplexity symbol */}
    <path
      d="M12 4 L16 8 L16 16 L8 16 L8 8 Z M10 8 L14 8 M8 20 L16 20 M12 16 L12 20"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />

    {/* Center glow dot */}
    <circle cx="12" cy="12" r="1" fill="currentColor" className="opacity-80"/>
  </svg>
);

const MessageIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
  >
    <path
      d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

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
  onOpenSettings
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  
  const handleStartEdit = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };
  
  const handleSaveEdit = () => {
    if (editingId && editTitle.trim()) {
      onRenameChat(editingId, editTitle.trim());
    }
    setEditingId(null);
    setEditTitle('');
  };
  
  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
  };
  return (
    <div className="w-64 border-r flex flex-col h-screen bg-neutral-900 border-neutral-700 nerdplexity-glow">
      <div className="p-4 border-b border-neutral-700 nerdplexity-border">
        <div className="flex items-center gap-2 mb-3">
          <NerdplexityLogo size={24} className="text-nerdplexity-400 nerdplexity-text-glow" />
          <span className="font-semibold text-white">Nerdplexity</span>
        </div>

        <button
          onClick={() => {
            console.log('New Chat clicked!');
            onNewChat();
          }}
          className="w-full flex items-center justify-center gap-2 p-3 rounded-lg font-medium bg-nerdplexity-600 hover:bg-nerdplexity-700 text-white transition-all duration-200 border-none outline-none cursor-pointer nerdplexity-glow"
        >
          <Plus size={16} />
          New Chat
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <div className="text-center text-sm py-8 text-neutral-400">
            No chat history yet.
            <br />
            Start a new conversation!
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center gap-2 p-2 rounded cursor-pointer transition-all duration-200 ${
                  activeConversationId === conv.id
                    ? 'bg-neutral-800 nerdplexity-border nerdplexity-glow'
                    : 'hover:bg-neutral-800 hover:bg-opacity-50 hover:border hover:border-nerdplexity-700'
                }`}
                onClick={() => editingId !== conv.id && onLoadChat(conv.id)}
              >
                <MessageIcon size={14} className="text-nerdplexity-300 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  {editingId === conv.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="flex-1 text-sm bg-neutral-800 text-white px-2 py-1 rounded nerdplexity-border focus-ring"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit();
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSaveEdit();
                        }}
                        className="p-1 text-nerdplexity-400 hover:bg-neutral-700 hover:text-nerdplexity-300 rounded transition-colors"
                      >
                        <Check size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelEdit();
                        }}
                        className="p-1 text-red-400 hover:bg-neutral-700 hover:text-red-300 rounded transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="text-sm font-medium truncate text-white">{sanitizeDisplayText(conv.title)}</div>
                      <div className="text-xs text-neutral-400">
                        {new Date(conv.updatedAt).toLocaleDateString()}
                      </div>
                    </>
                  )}
                </div>
                {editingId !== conv.id && (
                  <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartEdit(conv);
                      }}
                      className="p-1 text-nerdplexity-400 hover:bg-neutral-700 hover:text-nerdplexity-300 rounded transition-all"
                    >
                      <Edit2 size={12} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('Are you sure you want to delete this conversation?')) {
                          onDeleteChat(conv.id);
                        }
                      }}
                      className="p-1 text-red-400 hover:bg-neutral-700 hover:text-red-300 rounded transition-all"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      
      <div className="p-4 border-t border-neutral-700 nerdplexity-border">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2 p-2 hover:bg-neutral-800 rounded transition-all duration-200 text-left hover:nerdplexity-glow"
        >
          <Settings size={16} className="text-nerdplexity-400" />
          <span className="text-sm text-white">Keys & Settings</span>
        </button>

        <div className="mt-3 text-xs text-neutral-400">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-nerdplexity-500 rounded-full nerdplexity-glow-strong"></div>
            <span>Push disabled (local-only)</span>
          </div>
        </div>
      </div>
    </div>
  );
};