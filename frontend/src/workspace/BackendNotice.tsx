import { useEffect } from 'react';
import { ServerOff } from 'lucide-react';
import { API_BASE } from '../lib/backend';
import useBackend from '../state/backend';

const DEPLOY_DOCS = 'https://github.com/sanketmuchhala/Nerdplexity#deploying';

/** Explains why the server cannot be used: not running or unreachable, or not allowing this site. */
export function BackendNotice() {
  const { status, check } = useBackend();
  useEffect(() => { void check(); }, [check]);
  if (status !== 'down' && status !== 'blocked') return null;
  return (
    <div className="np-backend-notice" role="status">
      <ServerOff size={16} aria-hidden />
      {status === 'blocked' ? (
        <p>
          <strong>This Nerdplexity server does not allow this site.</strong>{' '}
          Add <code>{window.location.origin}</code> to <code>ALLOWED_ORIGINS</code> on the server, restart it, then retry.
        </p>
      ) : (
        <p>
          <strong>{API_BASE ? `The Nerdplexity server at ${API_BASE} is not responding.` : 'No Nerdplexity server is connected.'}</strong>{' '}
          You can look around, but chat, model lists, and tools need the server. Run Nerdplexity on your computer with{' '}
          <code>pnpm dev</code>, or <a href={DEPLOY_DOCS} target="_blank" rel="noopener noreferrer">deploy the server</a>.
        </p>
      )}
      <button type="button" className="np-button ghost small" onClick={() => void check()}>Retry</button>
    </div>
  );
}
