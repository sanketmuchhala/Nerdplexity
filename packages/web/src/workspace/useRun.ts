import { useEffect, useRef, useState } from 'react';
import useChat from '../state/chatStore';
import { db, RunRecord, WorkspaceDocument } from '../lib/db';
import { getKey } from '../lib/credentials';
import useConnections, { isLocal, targetFor, usesBaseURL } from '../state/connections';
import { consumeRun } from './api';

export function useRun() {
  const [running, setRunning] = useState(false);
  const [partial, setPartial] = useState('');
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [tools, setTools] = useState<RunRecord['tools']>([]);
  const [runConversationId, setRunConversationId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const send = async (prompt: string, agent: boolean, documents: WorkspaceDocument[]) => {
    if (controller.current || !prompt.trim()) return;
    const ac = new AbortController();
    controller.current = ac;
    setRunning(true); setPartial(''); setPhase('Preparing'); setError(''); setTools([]);
    let provenance: { connectionId: string; modelId: string } | undefined;
    const record: RunRecord = { id: crypto.randomUUID(), conversationId: '', provider: '', model: '', prompt, startedAt: Date.now(), durationMs: 0, status: 'failed', mode: agent ? 'agent' : 'chat', output: '', tools: [] };
    try {
      let state = useChat.getState();
      if (!state.activeConversation()) { await state.newConversation(); state = useChat.getState(); }
      const conversation = state.activeConversation();
      if (!conversation) throw new Error('Unable to create a thread. Check browser storage.');
      const connection = useConnections.getState().connections.find(c => c.id === conversation.connectionId);
      if (!conversation.model || !conversation.connectionId) throw new Error('Choose a model in Models first.');
      if (!connection) throw new Error('This thread’s connection was removed. Choose another model in Models.');
      // Ollama and compatible endpoints stream through the run route; hosted providers use the legacy JSON route until P2.
      const streaming = usesBaseURL(connection.kind);
      if (agent && !isLocal(connection)) throw new Error('Document agents run only on models on this machine.');
      provenance = { connectionId: connection.id, modelId: conversation.model };
      record.conversationId = conversation.id;
      record.provider = connection.name;
      record.model = conversation.model;
      setRunConversationId(conversation.id);
      await state.addMessage('user', prompt, undefined, conversation.id);
      const messages = [...conversation.messages.map(({ role, content }) => ({ role, content })), { role: 'user', content: prompt }];
      const request = streaming ? {
        target: targetFor(connection), model: conversation.model,
        messages, temperature: state.settings?.temperature ?? 0.7, max_tokens: state.settings?.max_tokens ?? 2048,
        ...(connection.kind === 'ollama' ? { num_ctx: state.settings?.num_ctx ?? 8192 } : {}),
        agent, documents: agent ? documents : [],
      } : {
        provider: connection.kind, model: conversation.model, messages,
        api_key: getKey(connection.id), temperature: state.settings?.temperature ?? 0.7,
        max_tokens: state.settings?.max_tokens ?? 2048,
      };
      setPhase('Connecting to model');
      const response = await fetch(streaming ? '/v1/local/run' : '/v1/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: ac.signal,
      });
      if (streaming) {
        await consumeRun(response, event => {
          if (event.type === 'status') setPhase(event.message);
          if (event.type === 'delta') { record.output += event.text; setPartial(record.output); setPhase('Generating'); }
          if (event.type === 'tool') { record.tools.push({ name: event.name, input: event.input, output: event.output, step: event.step }); setTools([...record.tools]); }
          if (event.type === 'done') { record.usage = event.usage; record.ttftMs = event.ttft_ms; }
        });
      } else {
        const data = await response.json();
        if (!response.ok) throw new Error(data.details || data.error || 'Cloud request failed.');
        if (typeof data.message?.content !== 'string') throw new Error('Provider returned no answer.');
        record.output = data.message.content;
        record.usage = data.usage;
      }
      record.status = 'completed';
    } catch (err) {
      record.status = ac.signal.aborted ? 'stopped' : 'failed';
      if (!ac.signal.aborted) { record.error = (err as Error).message; setError(record.error); }
    } finally {
      record.durationMs = Date.now() - record.startedAt;
      try {
        if (record.output && record.conversationId) await useChat.getState().addMessage('assistant', record.output, undefined, record.conversationId, provenance);
        if (record.conversationId) { await db.runs.put(record); window.dispatchEvent(new Event('nerdplexity:runs')); }
        setPartial('');
      } catch { setError('Browser storage failed. Copy the visible answer before leaving.'); }
      controller.current = null;
      setRunning(false); setPhase(record.status === 'stopped' ? 'Run stopped' : '');
    }
  };
  return { send, running, partial, phase, error, tools, runConversationId, stop: () => controller.current?.abort(), clearError: () => setError('') };
}
