import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Code2, Download, FileText, Lightbulb, SlidersHorizontal, Square, Workflow, X } from 'lucide-react';
import useChat from '../state/chatStore';
import type { WorkspaceDocument } from '../lib/db';
import { Message } from '../components/Message';
import { hasKey } from '../lib/credentials';
import useConnections, { isLocal, requiresKey } from '../state/connections';
import { exportText } from './api';
import { useRun } from './useRun';

export function ChatWorkspace({ run, documents, onModels, onDocuments }: { run: ReturnType<typeof useRun>; documents: WorkspaceDocument[]; onModels: () => void; onDocuments: () => void }) {
  const { activeConversation, settings, saveSettings } = useChat();
  const connections = useConnections(state => state.connections);
  useConnections(state => state.keyVersion);
  const conversation = activeConversation();
  // An empty screen previews the default model that a new thread will use.
  const ref = conversation ? (conversation.connectionId ? { connectionId: conversation.connectionId, modelId: conversation.model } : undefined) : settings?.activeModel;
  const connection = connections.find(c => c.id === ref?.connectionId);
  const model = ref?.modelId;
  const local = !!connection && isLocal(connection);
  const needsKey = !!connection && requiresKey(connection.kind) && !hasKey(connection.id);
  const [input, setInput] = useState('');
  const [agent, setAgent] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const sticky = useRef(true);
  const [showScroll, setShowScroll] = useState(false);
  const ownRun = run.runConversationId === conversation?.id;
  const messages = conversation?.messages || [];
  const empty = messages.length === 0;
  const ready = !!model && !!connection && !needsKey;
  useEffect(() => { setInput(''); setAgent(false); sticky.current = true; }, [conversation?.id]);
  useEffect(() => {
    if (sticky.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages.length, run.partial, run.tools.length]);
  useEffect(() => {
    if (textarea.current) { textarea.current.style.height = 'auto'; textarea.current.style.height = Math.min(textarea.current.scrollHeight, 180) + 'px'; }
  }, [input]);
  const submit = () => {
    if (!input.trim() || run.running || !ready) return;
    const prompt = input.trim(); setInput(''); sticky.current = true;
    void run.send(prompt, agent && local && documents.length > 0, documents);
  };
  const suggestions = [
    { icon: Code2, title: 'Build something', text: 'Help me design a small project. Start by asking what I want to build.' },
    { icon: FileText, title: 'Work with my notes', text: 'Search my workspace documents and summarize the main decisions, open questions, and next steps.' },
    { icon: Lightbulb, title: 'Think it through', text: 'Help me think through an idea. Ask me about the goal and constraints first.' },
  ];
  return <div className="np-chat">
    <div className="np-chat-toolbar"><button className="np-model-switch" onClick={onModels}><span className="np-model-dot"/><span>{model || 'Choose a model'}</span><span className="np-model-source">{connection?.name ?? (model ? 'Connection removed' : '')}</span><ArrowRight size={13}/></button><div className="np-toolbar-actions">{messages.length > 0 && <button className="np-icon-button" aria-label="Export thread" title="Export thread" onClick={() => exportText('nerdplexity-thread.md', `# ${conversation?.title}\n\n${messages.map(m => `## ${m.role}\n\n${m.content}`).join('\n\n')}`)}><Download size={16}/></button>}<button className={`np-icon-button ${showControls ? 'active' : ''}`} aria-label="Generation settings" aria-expanded={showControls} title="Generation settings" onClick={() => setShowControls(!showControls)}><SlidersHorizontal size={16}/></button></div></div>
    {showControls && <div className="np-generation-controls"><label>Temperature <strong>{settings?.temperature ?? 0.7}</strong><input aria-label="Temperature" type="range" min="0" max="2" step="0.1" value={settings?.temperature ?? 0.7} onChange={e => void saveSettings({ temperature: Number(e.target.value) })}/></label><label>Maximum output<select aria-label="Maximum output tokens" value={settings?.max_tokens ?? 2048} onChange={e => void saveSettings({ max_tokens: Number(e.target.value) })}>{Array.from(new Set([512, 1024, 2048, 4096, 8192, settings?.max_tokens ?? 2048])).sort((a,b) => a-b).map(n => <option key={n} value={n}>{n.toLocaleString()} tokens</option>)}</select></label>{connection?.kind === 'ollama' && <label>Context window<select aria-label="Context window" value={settings?.num_ctx ?? 8192} onChange={e => void saveSettings({ num_ctx: Number(e.target.value) })}>{Array.from(new Set([2048, 4096, 8192, 16384, 32768, settings?.num_ctx ?? 8192])).sort((a,b)=>a-b).map(n => <option key={n} value={n}>{n.toLocaleString()} tokens</option>)}</select></label>}</div>}
    <div className={`np-chat-scroll ${empty ? 'empty' : ''}`} ref={scroll} onScroll={() => { const el = scroll.current; if (el) { sticky.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; setShowScroll(!sticky.current); } }}>
      {empty ? <div className="np-welcome">
        <div className="np-orbit" aria-hidden="true"><div className="np-orbit-ring one"/><div className="np-orbit-ring two"/><div className="np-orbit-ring three"/><span className="np-orbit-point a"/><span className="np-orbit-point b"/><span className="np-orbit-point c"/><div className="np-orbit-center">n<span>.</span></div><span className="np-orbit-caption">LOCAL INTELLIGENCE</span></div>
        <div className="np-welcome-label"><span/> A little more independent.</div>
        <h1>Your models.<br/><span>Your possibilities.</span></h1><p>Think, build, and work with your own AI.<br/>A quiet space for intelligence that runs on your terms.</p>
        <div className="np-suggestions">{suggestions.map(({icon: Icon, title, text}) => <button key={title} onClick={() => { if (title === 'Work with my notes' && (!documents.length || !local)) { onDocuments(); return; } setAgent(title === 'Work with my notes'); setInput(text); textarea.current?.focus(); }}><Icon size={18}/><span>{title}</span><ArrowRight size={13}/></button>)}</div>
        {!ready && <button className="np-connect-prompt" onClick={onModels}>{needsKey ? `Add your ${connection?.name} API key to get started` : model && !connection ? 'This thread’s connection was removed. Choose a model' : 'Choose a model to get started'}<ArrowRight size={14}/></button>}
      </div> : <div className="np-thread">
        {messages.map(message => <Fragment key={message.id}><Message message={{ ...message, timestamp: message.createdAt }}/ >{message.role === 'assistant' && message.provenance && <p className="np-provenance">{message.provenance.modelId} · {connections.find(c => c.id === message.provenance!.connectionId)?.name ?? 'removed connection'}</p>}</Fragment>)}
        {ownRun && run.tools.length > 0 && <div className="np-inline-tools">{run.tools.map((tool, i) => <details key={i}><summary><FileText size={13}/>{tool.name.replaceAll('_',' ')}<span>Step {tool.step}</span></summary><pre>{JSON.stringify({ input: tool.input, output: tool.output }, null, 2)}</pre></details>)}</div>}
        {ownRun && run.partial && <Message message={{ id: 'stream', role: 'assistant', content: run.partial, timestamp: Date.now() }}/ >}
        {ownRun && run.running && <div className="np-live-status" role="status"><span className="np-live-dots"><i/><i/><i/></span>{run.phase}</div>}
        {ownRun && !run.running && run.phase && <div className="np-live-status">{run.phase}</div>}
      </div>}
    </div>
    {showScroll && <button className="np-scroll-bottom np-icon-button" aria-label="Scroll to latest message" onClick={() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; sticky.current = true; setShowScroll(false); }}><ArrowDown size={16}/></button>}
    <div className="np-composer-area">
      {run.error && <div className="np-error np-chat-error" role="alert"><span>{run.error}</span><button aria-label="Dismiss error" className="np-icon-button" onClick={run.clearError}><X size={14}/></button></div>}
      <form className="np-composer" onSubmit={e => { e.preventDefault(); submit(); }}>
        <textarea ref={textarea} rows={2} aria-label="Message" placeholder={agent ? 'Ask your workspace a question…' : 'Where do you want to start?'} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}/>
        <div className="np-composer-toolbar"><div className="np-composer-modes"><button type="button" className={`np-mode ${!agent ? 'selected' : ''}`} onClick={() => setAgent(false)}>Chat</button><button type="button" className={`np-mode ${agent ? 'selected' : ''}`} aria-pressed={agent} onClick={() => { if (!local) { onModels(); return; } if (!documents.length) { onDocuments(); return; } setAgent(!agent); }}><Workflow size={13}/>Document agent</button></div><div className="np-composer-send">{local && <span className="np-local-label"><i/>Local</span>}{run.running ? <button type="button" className="np-send stop" aria-label="Stop generation" title="Stop generation" onClick={run.stop}><Square size={14} fill="currentColor"/></button> : <button type="submit" className="np-send" aria-label="Send message" title="Send message" disabled={!input.trim() || !ready}><ArrowUp size={18}/></button>}</div></div>
      </form>
      <div className="np-composer-footnote"><span>{agent ? `Agent access: all ${documents.length} workspace documents · search and read only` : !connection ? 'Choose a model in Models.' : local ? 'Requests stay on this machine.' : `Prompts are sent to ${connection.name}${hasKey(connection.id) ? ' with your API key' : ''}.`}</span><span>Shift + Enter for a new line</span></div>
    </div>
  </div>;
}
