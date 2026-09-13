import { useEffect, useState } from 'react';
import { ServerOff } from 'lucide-react';
import { API_BASE, backendReachable } from '../lib/backend';

const DEPLOY_DOCS = 'https://github.com/sanketmuchhala/Nerdplexity#deploying';

/** Shown when the backend does not answer, for example on a hosted preview with no server connected. */
export function BackendNotice() {
  const [state, setState] = useState<'checking' | 'ok' | 'down'>('checking');
  const check = async (signal?: AbortSignal) => {
    setState('checking');
    const ok = await backendReachable(signal);
    if (!signal?.aborted) setState(ok ? 'ok' : 'down');
  };
  useEffect(() => {
    const controller = new AbortController();
    void check(controller.signal);
    return () => controller.abort();
  }, []);
  if (state !== 'down') return null;
  return (
    <div className="np-backend-notice" role="status">
      <ServerOff size={16} aria-hidden />
      <p>
        <strong>{API_BASE ? `The Nerdplexity server at ${API_BASE} is not responding.` : 'No Nerdplexity server is connected.'}</strong>{' '}
        You can look around, but chat, model lists, and tools need the server. Run Nerdplexity on your computer with{' '}
        <code>pnpm dev</code>, or <a href={DEPLOY_DOCS} target="_blank" rel="noopener noreferrer">deploy the server</a>.
      </p>
      <button type="button" className="np-button ghost small" onClick={() => void check()}>Retry</button>
    </div>
  );
}
