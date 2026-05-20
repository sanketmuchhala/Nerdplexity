import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar }       from './components/Sidebar';
import { Chat }          from './components/Chat';
import { SettingsModal } from './components/SettingsModal';
import Landing           from './pages/Landing';
import useChat           from './state/chatStore';
import { initializeDatabase } from './lib/db';

// Analytics pages — lazy-ish (kept sync for simplicity)
import MetricsDashboard  from './promptops/MetricsDashboard';
import EventsPage        from './promptops/EventsPage';
import PromptOpsLanding  from './promptops/PromptOpsLanding';
import BenchmarkPage     from './promptops/BenchmarkPage';

function AppShell({ onOpenSettings }: { onOpenSettings: () => void }) {
  const {
    conversations, activeConversationId,
    newConversation, selectConversation, deleteConversation, updateConversationTitle,
  } = useChat();

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      <Sidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onNewChat={newConversation}
        onLoadChat={selectConversation}
        onDeleteChat={deleteConversation}
        onRenameChat={updateConversationTitle}
        onOpenSettings={onOpenSettings}
      />
      <Chat onOpenSettings={onOpenSettings} />
    </div>
  );
}

export default function App() {
  const [settingsOpen,  setSettingsOpen]  = useState(false);
  const [initialized,   setInitialized]   = useState(false);
  const { loadConversations, loadSettings } = useChat();

  useEffect(() => {
    (async () => {
      await initializeDatabase();
      await loadSettings();
      await loadConversations();
      setInitialized(true);
    })();
  }, []);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSettingsOpen(true); }
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  if (!initialized) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg)' }}>
        <div className="text-center">
          <div className="w-8 h-8 rounded-full border-2 border-transparent mx-auto mb-3 animate-spin"
            style={{ borderTopColor: 'var(--blue)', borderRightColor: 'rgba(59,130,246,.2)' }} />
          <p className="text-xs" style={{ color: 'var(--t4)' }}>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Routes>
        {/* Marketing */}
        <Route path="/"   element={<Landing />} />

        {/* App shell */}
        <Route path="/app" element={<AppShell onOpenSettings={() => setSettingsOpen(true)} />} />

        {/* Analytics */}
        <Route path="/app/analytics"           element={<PromptOpsLanding />} />
        <Route path="/app/analytics/dashboard" element={<MetricsDashboard />} />
        <Route path="/app/analytics/events"    element={<EventsPage />} />
        <Route path="/app/analytics/benchmark" element={<BenchmarkPage />} />

        {/* Legacy redirects — old routes still work */}
        <Route path="/promptops" element={<PromptOpsLanding />} />
        <Route path="/dashboard" element={<MetricsDashboard />} />
        <Route path="/events"    element={<EventsPage />} />
        <Route path="/benchmark" element={<BenchmarkPage />} />
      </Routes>
    </BrowserRouter>
  );
}
