import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Workspace from './workspace/Workspace';
import useChat           from './state/chatStore';
import useConnections    from './state/connections';
import { initializeDatabase } from './lib/db';

// Analytics pages — lazy-ish (kept sync for simplicity)
import MetricsDashboard  from './promptops/MetricsDashboard';
import EventsPage        from './promptops/EventsPage';
import PromptOpsLanding  from './promptops/PromptOpsLanding';
import BenchmarkPage     from './promptops/BenchmarkPage';

export default function App() {
  const [initialized,   setInitialized]   = useState(false);
  const [initError,     setInitError]     = useState('');
  const { loadConversations, loadSettings } = useChat();

  const initialize = useCallback(async () => {
    setInitError('');
    try {
      await initializeDatabase();
      await loadSettings();
      await useConnections.getState().load();
      await loadConversations();
      setInitialized(true);
    } catch (error) {
      // Failed upgrades roll back, so existing data is intact; offer a retry.
      setInitError((error as Error)?.message || 'Browser storage could not be opened.');
    }
  }, [loadConversations, loadSettings]);

  useEffect(() => { void initialize(); }, [initialize]);

  if (initError) {
    return (
      <div className="flex items-center justify-center h-screen px-6" style={{ background: 'var(--bg)' }}>
        <div role="alert" className="text-center max-w-md">
          <p className="text-sm mb-2" style={{ color: 'var(--t1)' }}>Nerdplexity could not open its browser storage.</p>
          <p className="text-xs mb-4" style={{ color: 'var(--t3)' }}>{initError} Your saved data has not been changed. Close other Nerdplexity tabs, then retry.</p>
          <button onClick={() => void initialize()} className="px-4 py-2 rounded-lg text-sm" style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)', color: 'var(--t2)' }}>Retry</button>
        </div>
      </div>
    );
  }

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
      <Routes>
        {/* Marketing */}
        <Route path="/" element={<Navigate to="/app" replace />} />

        {/* App shell */}
        <Route path="/app/*" element={<Workspace />} />

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
