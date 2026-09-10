import { useRef, useState } from 'react';
import { FileText, Plus, Save, Trash2, Upload } from 'lucide-react';
import { db, WorkspaceDocument } from '../lib/db';

export function Documents({ documents, refresh }: { documents: WorkspaceDocument[]; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState<WorkspaceDocument | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const add = () => { setError(''); setNotice(''); setEditing({ id: crypto.randomUUID(), title: '', content: '', updatedAt: Date.now() }); };
  const importFile = async (file?: File) => {
    if (!file) return;
    setError(''); setNotice('');
    if (file.size > 100_000 || !/\.(md|txt|csv|json|log)$/i.test(file.name)) { setError('Choose a text, Markdown, CSV, JSON, or log file under 100 KB.'); return; }
    try { setEditing({ id: crypto.randomUUID(), title: file.name, content: await file.text(), updatedAt: Date.now() }); }
    catch { setError('Unable to read that file.'); }
  };
  const save = async () => {
    if (!editing) return;
    setError(''); setNotice('');
    const others = documents.filter(d => d.id !== editing.id);
    if (!editing.title.trim() || !editing.content.trim()) { setError('Add a title and some content.'); return; }
    if (editing.content.length > 100_000 || others.length >= 20 || others.reduce((sum, doc) => sum + doc.content.length, 0) + editing.content.length > 400_000) { setError('Workspace limit: 20 documents, 100,000 characters per document, 400,000 total.'); return; }
    setSaving(true);
    try { await db.documents.put({ ...editing, title: editing.title.trim(), updatedAt: Date.now() }); await refresh(); setEditing(null); setNotice('Document saved. Enable Document agent in a local thread to use it.'); }
    catch { setError('Unable to save. Check browser storage.'); }
    finally { setSaving(false); }
  };
  const remove = async (doc: WorkspaceDocument) => {
    if (!window.confirm(`Delete “${doc.title}” from your workspace?`)) return;
    try { await db.documents.delete(doc.id); await refresh(); if (editing?.id === doc.id) setEditing(null); }
    catch { setError('Unable to delete this document.'); }
  };
  return <div className="np-page">
    <div className="np-page-heading"><div><span className="np-eyebrow">YOUR CONTEXT</span><h1>A workspace with memory.</h1><p>Keep the notes, source material, and project context your local agent needs.</p></div><button className="np-button primary" onClick={add}><Plus size={15}/>New document</button></div>
    <div className="np-context-banner"><FileText size={20}/><div><strong>Documents stay in this browser.</strong><p>Document agent sends these documents to your local runtime. Each search and read appears in the run trace.</p></div><span className="np-label">{documents.length} / 20 documents</span></div>
    {error && <p className="np-error" role="alert">{error}</p>}{notice && <p className="np-success" role="status">{notice}</p>}
    {editing ? <section className="np-panel np-editor">
      <label className="np-field"><span>Document title</span><input maxLength={200} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Project brief"/></label>
      <label className="np-field"><span>Content</span><textarea value={editing.content} onChange={e => setEditing({ ...editing, content: e.target.value })} placeholder="Paste notes, documentation, or source material…" rows={17}/></label>
      <div className="np-editor-footer"><span>{editing.content.length.toLocaleString()} characters</span><button className="np-button ghost" onClick={() => setEditing(null)}>Cancel</button><button className="np-button primary" onClick={() => void save()} disabled={saving}><Save size={14}/>{saving ? 'Saving' : 'Save document'}</button></div>
    </section> : <>
      <input ref={input} type="file" accept=".md,.txt,.csv,.json,.log" className="np-visually-hidden" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }}/>
      <button className="np-import" onClick={() => input.current?.click()}><Upload size={22}/><strong>Bring in a document</strong><span>Markdown, text, CSV, JSON, or logs · up to 100 KB</span></button>
      <div className="np-document-grid">{documents.map(doc => <article className="np-document" key={doc.id}><FileText size={20}/><button className="np-document-open" onClick={() => { setEditing(doc); setNotice(''); }}><h3>{doc.title}</h3><p>{doc.content.slice(0, 160)}</p><span>Updated {new Date(doc.updatedAt).toLocaleDateString()} · {doc.content.length.toLocaleString()} characters</span></button><button className="np-icon-button" title={`Delete ${doc.title}`} aria-label={`Delete ${doc.title}`} onClick={() => void remove(doc)}><Trash2 size={14}/></button></article>)}</div>
      {!documents.length && <div className="np-empty-panel"><h3>Your next answer starts with better context.</h3><p>Add a project brief, meeting notes, or a README. Then ask a local document agent to find answers in it.</p></div>}
    </>}
  </div>;
}
