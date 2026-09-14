import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Workspace from './workspace/Workspace';
import { SignIn } from './workspace/SignIn';
import useChat           from './state/chatStore';
import useConnections    from './state/connections';
import useBackend        from './state/backend';
import useAccount        from './state/account';
import { initializeDatabase } from './lib/db';
import { AuthRequired, session, whenAuthRequired } from './lib/api';
import * as store from './lib/store';
import { importBrowserData } from './lib/importBrowserData';

type Phase = 'loading' | 'sign-in' | 'ready';

export default function App() {
  const [phase,     setPhase]     = useState<Phase>('loading');
  const [initError, setInitError] = useState('');
  const { loadConversations, loadSettings } = useChat();

  const initialize = useCallback(async () => {
    setInitError('');
    setPhase('loading');
    try {
      // This browser's storage keeps remembered API keys and the data imported below.
      await initializeDatabase();
      await useBackend.getState().check();
      const health = useBackend.getState().health;
      if (health?.authRequired && !session.token) { setPhase('sign-in'); return; }
      const account = await useAccount.getState().load();
      // The first time this account opens the app here, copy this browser's earlier data to the server.
      if (!(await store.status()).imported) {
        const threads = await importBrowserData(account.id);
        if (threads) useAccount.setState({ importedThreads: threads });
      }
      await loadSettings();
      await useConnections.getState().load();
      await loadConversations();
      setPhase('ready');
    } catch (error) {
      if (error instanceof AuthRequired) { setPhase('sign-in'); return; }
      setInitError((error as Error)?.message || 'Your saved data could not be loaded.');
    }
  }, [loadConversations, loadSettings]);

  useEffect(() => { void initialize(); }, [initialize]);
  // A session that expires while the app is open returns to sign-in.
  useEffect(() => { whenAuthRequired(() => setPhase('sign-in')); }, []);

  if (initError) {
    return (
      <div className="flex items-center justify-center h-screen px-6" style={{ background: 'var(--bg)' }}>
        <div role="alert" className="text-center max-w-md">
          <p className="text-sm mb-2" style={{ color: 'var(--t1)' }}>Nerdplexity could not load your saved data.</p>
          <p className="text-xs mb-4" style={{ color: 'var(--t3)' }}>{initError} Nothing was changed. Retry when the server is running.</p>
          <button onClick={() => void initialize()} className="px-4 py-2 rounded-lg text-sm" style={{ background: 'var(--s2)', border: '1px solid var(--b-hi)', color: 'var(--t2)' }}>Retry</button>
        </div>
      </div>
    );
  }

  if (phase === 'sign-in') {
    return <SignIn signupsOpen={useBackend.getState().health?.signupsOpen ?? false} onSignedIn={() => void initialize()} />;
  }

  if (phase === 'loading') {
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

        {/* Retired screens open the closest current workspace page. */}
        <Route path="/app/analytics/*" element={<Navigate to="/app/runs" replace />} />
        <Route path="/promptops" element={<Navigate to="/app/runs" replace />} />
        <Route path="/dashboard" element={<Navigate to="/app/runs" replace />} />
        <Route path="/events" element={<Navigate to="/app/runs" replace />} />
        <Route path="/benchmark" element={<Navigate to="/app/compare" replace />} />

        {/* App shell */}
        <Route path="/app/*" element={<Workspace />} />
      </Routes>
    </BrowserRouter>
  );
}
