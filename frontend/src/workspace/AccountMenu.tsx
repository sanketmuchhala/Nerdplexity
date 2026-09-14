import { useEffect, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import useAccount from '../state/account';

/** The top-bar avatar: who is signed in, and sign out on a server with accounts. */
export function AccountMenu() {
  const account = useAccount(state => state.account);
  const signOut = useAccount(state => state.signOut);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const signedIn = !!account && !account.local;
  const initial = signedIn ? (account.name || account.email).trim().charAt(0).toUpperCase() || 'N' : 'N';

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  return (
    <div className="np-account" ref={root}>
      <button type="button" className="np-avatar" aria-label="Account" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>{initial}</button>
      {open && (
        <div className="np-account-menu" role="group" aria-label="Account">
          {signedIn ? (
            <>
              <strong>{account.name || account.email}</strong>
              {account.name && <p>{account.email}</p>}
              <p>Threads, documents, and run history are saved to this account. API keys stay in this browser.</p>
              <button type="button" className="np-button ghost small" disabled={busy}
                onClick={async () => { setBusy(true); await signOut(); window.location.assign('/app'); }}>
                <LogOut size={13} /> {busy ? 'Signing out' : 'Sign out'}
              </button>
            </>
          ) : (
            <>
              <strong>This computer</strong>
              <p>Everything is saved by the Nerdplexity server running here. No account is needed.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
