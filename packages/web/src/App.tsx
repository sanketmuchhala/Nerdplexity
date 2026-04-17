import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';
import { SettingsModal } from './components/SettingsModal';
import useChat from './state/chatStore';
import { initializeDatabase } from './lib/db';
import MetricsDashboard from './promptops/MetricsDashboard';
import EventsPage from './promptops/EventsPage';
import PromptOpsLanding from './promptops/PromptOpsLanding';
import BenchmarkPage from './promptops/BenchmarkPage';


function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  
  const {
    conversations,
    activeConversationId,
    newConversation,
    selectConversation,
    deleteConversation,
    updateConversationTitle,
    loadConversations,
    loadSettings
  } = useChat();

  // Initialize database and load data on app start
  useEffect(() => {
    const init = async () => {
      await initializeDatabase();
      await loadSettings();
      await loadConversations();
      setIsInitialized(true);
    };
    init();
  }, [loadSettings, loadConversations]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        newConversation();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSettingsOpen(true);
      }
      if (e.key === 'Escape' && isSettingsOpen) {
        setIsSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [newConversation, isSettingsOpen]);

  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-screen bg-neutral-950 text-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-nerdplexity-400 mx-auto mb-4 nerdplexity-glow"></div>
          <p>Initializing Nerdplexity...</p>
        </div>
      </div>
    );
  }

  const MainLayout = ({ children }: { children: React.ReactNode }) => (
    <div className="flex h-screen bg-neutral-950 text-white">
      <Sidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onNewChat={() => {
          console.log('App.tsx: onNewChat triggered');
          newConversation();
        }}
        onLoadChat={selectConversation}
        onDeleteChat={deleteConversation}
        onRenameChat={updateConversationTitle}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
      {children}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );

  const showPromptScopeLink = (localStorage.getItem("PROMPTOPS_ENABLED")||"true") !== "false";

  // Component to conditionally show PromptOps link
  const ConditionalPromptOpsLink = () => {
    const location = useLocation();
    const shouldShow = showPromptScopeLink && location.pathname === '/';

    if (!shouldShow) return null;

    return (
      <div className="fixed top-4 right-4 z-10">
        <Link
          to="/promptops"
          className="text-neutral-300 hover:text-nerdplexity-300 px-4 py-2 bg-neutral-900 border border-neutral-700 rounded-lg transition-all hover:bg-neutral-800 hover:border-nerdplexity-600 nerdplexity-glow text-sm font-medium"
        >
          PromptOps
        </Link>
      </div>
    );
  };

  return (
    <Router>
      <Routes>
        <Route path="/" element={
          <MainLayout>
            <Chat onOpenSettings={() => setIsSettingsOpen(true)} />
          </MainLayout>
        } />
        <Route path="/promptops" element={<PromptOpsLanding />} />
        <Route path="/dashboard" element={<MetricsDashboard />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/benchmark" element={<BenchmarkPage />} />
      </Routes>
      <ConditionalPromptOpsLink />
    </Router>
  );
}

export default App;