import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';
import { SettingsModal } from './components/SettingsModal';
import useChat from './state/chatStore';
import { initializeDatabase } from './lib/db';
import MetricsDashboard from './promptops/MetricsDashboard';
import EventsPage from './promptops/EventsPage';
import PromptOpsLanding from './promptops/PromptOpsLanding';
import BenchmarkPage from './promptops/BenchmarkPage';
import Landing from './pages/Landing';

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const {
    conversations, activeConversationId,
    newConversation, selectConversation, deleteConversation,
    updateConversationTitle, loadConversations, loadSettings,
  } = useChat();

  useEffect(() => {
    const init = async () => {
      await initializeDatabase();
      await loadSettings();
      await loadConversations();
      setIsInitialized(true);
    };
    init();
  }, [loadSettings, loadConversations]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); newConversation(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setIsSettingsOpen(true); }
      if (e.key === 'Escape' && isSettingsOpen) setIsSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newConversation, isSettingsOpen]);

  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg)' }}>
        <div className="text-center">
          <div
            className="w-8 h-8 rounded-full border-2 border-transparent mx-auto mb-4 animate-spin"
            style={{ borderTopColor: 'var(--blue)', borderRightColor: 'rgba(78,107,255,.3)' }}
          />
          <p className="text-xs text-[var(--t3)]">Initializing…</p>
        </div>
      </div>
    );
  }

  const AppShell = () => (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      <Sidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onNewChat={newConversation}
        onLoadChat={selectConversation}
        onDeleteChat={deleteConversation}
        onRenameChat={updateConversationTitle}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
      <Chat onOpenSettings={() => setIsSettingsOpen(true)} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );

  return (
    <Router>
      <Routes>
        <Route path="/"          element={<Landing />} />
        <Route path="/app"       element={<AppShell />} />
        <Route path="/promptops" element={<PromptOpsLanding />} />
        <Route path="/dashboard" element={<MetricsDashboard />} />
        <Route path="/events"    element={<EventsPage />} />
        <Route path="/benchmark" element={<BenchmarkPage />} />
      </Routes>
    </Router>
  );
}

export default App;
