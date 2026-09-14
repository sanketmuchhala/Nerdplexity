import { FormEvent, useState } from 'react';
import { ArrowRight, Lock } from 'lucide-react';
import useAccount from '../state/account';
import { API_BASE } from '../lib/backend';

/**
 * Sign in to a hosted Nerdplexity server. Shown before anything loads when the server has
 * accounts (NERDPLEXITY_HOSTED) and this browser has no valid session.
 */
export function SignIn({ signupsOpen, onSignedIn }: { signupsOpen: boolean; onSignedIn: () => void }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>(signupsOpen ? 'sign-up' : 'sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { signIn, signUp } = useAccount();
  const creating = mode === 'sign-up';
  const host = API_BASE ? new URL(API_BASE).host : window.location.host;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (creating && password.length < 8) { setError('Use a password of at least 8 characters.'); return; }
    setBusy(true);
    try {
      if (creating) await signUp(name, email, password); else await signIn(email, password);
      onSignedIn();
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  };

  const switchTo = (next: typeof mode) => { setMode(next); setError(''); };

  return (
    <div className="np-app np-auth" data-theme="dark">
      <main className="np-auth-card">
        <span className="np-brand-mark" aria-hidden>n<span>.</span></span>
        <h1>{creating ? 'Create your account' : 'Sign in to Nerdplexity'}</h1>
        <p className="np-auth-sub">
          {creating
            ? 'Your threads, documents, and run history are saved to this account on the server.'
            : 'Welcome back. Your threads are waiting.'}
        </p>
        <form onSubmit={e => void submit(e)} aria-label={creating ? 'Create account' : 'Sign in'}>
          {creating && (
            <label className="np-field"><span>Name</span>
              <input value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={100} placeholder="Optional" />
            </label>
          )}
          <label className="np-field"><span>Email</span>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" autoFocus maxLength={200} />
          </label>
          <label className="np-field"><span>Password</span>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
              autoComplete={creating ? 'new-password' : 'current-password'} maxLength={128} />
          </label>
          {error && <p className="np-error" role="alert">{error}</p>}
          <button className="np-button primary np-auth-submit" type="submit" disabled={busy}>
            {busy ? (creating ? 'Creating account' : 'Signing in') : (creating ? 'Create account' : 'Sign in')}
            {!busy && <ArrowRight size={15} />}
          </button>
        </form>
        <p className="np-auth-switch">
          {creating
            ? <>Already have an account? <button type="button" onClick={() => switchTo('sign-in')}>Sign in</button></>
            : signupsOpen
              ? <>New here? <button type="button" onClick={() => switchTo('sign-up')}>Create an account</button></>
              : 'New accounts are closed on this server.'}
        </p>
        <p className="np-auth-foot"><Lock size={12} aria-hidden /> {host} · API keys stay in this browser and are never saved to your account.</p>
      </main>
    </div>
  );
}
