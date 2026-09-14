import { FormEvent, useEffect, useState } from 'react';
import { Eye, EyeOff, Globe } from 'lucide-react';
import useConnections from '../state/connections';
import useChat from '../state/chatStore';
import { maskKey } from '../lib/credentials';
import { clearSearchKey, hasSearchKey, searchKey, searchKeyRemembered, setSearchKey } from '../lib/searchKey';

/** Exa key for the Web search tool. Stored like provider keys: this tab only unless remembered. */
export function WebSearchSettings() {
  useConnections((state) => state.keyVersion);
  const { settings, saveSettings } = useChat();
  // Shown at once when toggled; the saved setting wins once it loads or changes.
  const [automatic, setAutomatic] = useState(settings?.webSearch !== 'off');
  useEffect(() => { setAutomatic(settings?.webSearch !== 'off'); }, [settings?.webSearch]);
  const toggleAutomatic = async (on: boolean) => {
    setAutomatic(on);
    setError('');
    try { await saveSettings({ webSearch: on ? 'auto' : 'off' }); }
    catch { setAutomatic(!on); setError('Unable to save this setting.'); }
  };
  const saved = hasSearchKey();
  const [key, setKeyValue] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { void searchKeyRemembered().then(setRemember).catch(() => undefined); }, [saved]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setNotice('');
    const trimmed = key.trim();
    if (!trimmed && !saved) { setError('Paste your Exa API key.'); return; }
    if (trimmed && !/^[\x21-\x7e]{8,200}$/.test(trimmed)) { setError('That does not look like an Exa API key.'); return; }
    try {
      await setSearchKey(trimmed || searchKey(), remember);
      setKeyValue('');
      setNotice(remember ? 'Key saved on this device.' : 'Key saved for this tab. It is forgotten when you close or reload it.');
    } catch { setError('Unable to save the key. Check browser storage.'); }
  };

  const forget = async () => {
    setError(''); setNotice('');
    try { await clearSearchKey(); setRemember(false); setNotice('Key removed.'); }
    catch { setError('Unable to remove the key. Check browser storage.'); }
  };

  return (
    <section className="np-panel np-web-search" aria-labelledby="web-search-title">
      <div className="np-section-title">
        <div>
          <h2 id="web-search-title"><Globe size={16} /> Web search</h2>
          <p>
            With a key saved, Nerdplexity searches the web on its own when a message needs current information: news,
            prices, recent releases, a link, or a request like &ldquo;search for&hellip;&rdquo;. The model then answers from the
            results and the sources are shown. Searches use Exa with your own key, and queries go to Exa even when the
            model runs on this machine. Exa bills after its free allowance; check your usage at exa.ai.
          </p>
        </div>
        <span className={`np-label ${saved ? '' : 'error'}`} role="status">{saved ? `Key ${maskKey(searchKey())}` : 'No key'}</span>
      </div>
      <form className="np-web-search-form" onSubmit={save}>
        <label className="np-field">
          <span>Exa API key</span>
          <div className="np-key-input">
            <input
              aria-label="Exa API key"
              type={show ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKeyValue(e.target.value)}
              placeholder={saved ? 'Saved. Enter a new key to replace it.' : 'Paste your key'}
              spellCheck={false}
              autoComplete="off"
            />
            <button type="button" className="np-icon-button" aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow(!show)}>
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </label>
        <label className="np-check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>
            <strong>Remember this key on this device</strong>Saved unencrypted in this browser profile's storage. Otherwise the key
            is forgotten when you close or reload the tab.
          </span>
        </label>
        <label className="np-check">
          <input
            type="checkbox"
            checked={automatic}
            onChange={(e) => void toggleAutomatic(e.target.checked)}
          />
          <span>
            <strong>Search automatically</strong>When a message needs current information, search before the model answers.
            Turn off to never search the web.
          </span>
        </label>
        {error && <p className="np-error" role="alert">{error}</p>}
        {notice && <p className="np-conn-hint" role="status">{notice}</p>}
        <div className="np-conn-actions">
          {saved && <button type="button" className="np-button ghost small" onClick={() => void forget()}>Forget key</button>}
          <button type="submit" className="np-button small">Save key</button>
        </div>
      </form>
    </section>
  );
}
