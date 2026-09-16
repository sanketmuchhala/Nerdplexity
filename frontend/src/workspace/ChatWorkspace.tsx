import { Fragment, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Calculator,
  Code2,
  Copy,
  Download,
  FileText,
  GitBranch,
  Lightbulb,
  Paperclip,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  Square,
  ThumbsDown,
  ThumbsUp,
  Workflow,
  X,
} from 'lucide-react';
import useChat from '../state/chatStore';
import type { WorkspaceDocument } from '../lib/db';
import { Message } from '../components/Message';
import { hasKey } from '../lib/credentials';
import { AGENT_NAME, isAgent, isRouter, ROUTER_NAME, routerName } from '../lib/router';
import { RouteActivity } from './RouteActivity';
import { AgentActivity } from './AgentActivity';
import { RouterMark } from './RouterMark';
import useConnections, {
  currentRouterPool,
  isLocal,
  latestResult,
  requiresKey,
} from '../state/connections';
import { exportText } from './api';
import { policyBlock, useRun } from './useRun';
import {
  attachmentFromFile,
  buildContext,
  exportConversation,
  workbenchSettings,
  type WorkbenchTool,
  pdfBlobUrls,
} from '../lib/workbench';
import { ToolActivity } from './ToolActivity';
import { DocumentsPanel } from './DocumentsPanel';
import { autoWebSearch } from '../lib/searchKey';
import { ModelPicker } from './ModelPicker';
import { RunSettings } from './RunSettings';
import { WorkbenchDialog } from './WorkbenchDialog';

const RUN_STATUS_LABEL = {
  canceled: 'Stopped · partial answer',
  failed: 'Failed · partial answer',
  interrupted: 'Interrupted · partial answer',
} as const;

export function ChatWorkspace({
  run,
  documents,
  onModels,
  onDocuments,
}: {
  run: ReturnType<typeof useRun>;
  documents: WorkspaceDocument[];
  onModels: () => void;
  onDocuments: () => void;
}) {
  const {
    activeConversation,
    settings,
    newConversation,
    setAllowCharges,
    forkConversation,
    updateConversationTitle,
    addAttachment,
    removeAttachment,
    setMessageFeedback,
    setWorkbench,
  } = useChat();
  const connections = useConnections((state) => state.connections);
  useConnections((state) => state.keyVersion);
  const catalog = useConnections((state) => state.catalog);
  const conversation = activeConversation();
  // An empty screen previews the default model that a new thread will use.
  const ref = conversation
    ? conversation.connectionId
      ? { connectionId: conversation.connectionId, modelId: conversation.model }
      : undefined
    : settings?.activeModel;
  const routed = isRouter(ref);
  const pool = routed ? currentRouterPool(connections, catalog) : undefined;
  const connection = connections.find((c) => c.id === ref?.connectionId);
  const model = ref?.modelId;
  const local = !!connection && isLocal(connection);
  const needsKey =
    !!connection && requiresKey(connection.kind) && !hasKey(connection.id);
  const [input, setInput] = useState('');
  const [showControls, setShowControls] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [edit, setEdit] = useState<{
    messageId: string;
    content: string;
  } | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [viewPdf, setViewPdf] = useState<{ id: string, name: string, url: string } | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const branchDraft = useRef<string | null>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const discovered = ref ? latestResult(catalog[ref.connectionId]) : undefined;
  const descriptor = discovered?.ok
    ? discovered.models.find((m) => m.id === model)
    : undefined;
  const configured = workbenchSettings(conversation, settings);
  /** Logo and name for the model behind an answer; the catalog name when it is known. */
  const answerModel = (source?: { connectionId: string; modelId: string }) => {
    if (!source) return undefined;
    const owner = connections.find((c) => c.id === source.connectionId);
    const listed = latestResult(catalog[source.connectionId]);
    return {
      id: source.modelId,
      displayName: listed?.ok ? listed.models.find((m) => m.id === source.modelId)?.displayName : undefined,
      provider: owner ? (owner.kind === 'openai-compatible' ? owner.name : owner.kind) : '',
    };
  };
  const enabledTools = configured.tools;
  // Searches run on their own when a message needs current information; there is no Web button.
  const webAuto = autoWebSearch(settings?.webSearch);
  const documentsOn = enabledTools.includes('documents');
  const preview = buildContext(
    conversation?.messages ?? [],
    input,
    configured,
    descriptor,
    connection,
    conversation?.attachments,
  );

  const textarea = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const sticky = useRef(true);
  const [showScroll, setShowScroll] = useState(false);
  const ownRun = run.runConversationId === conversation?.id;
  // Once the answer is saved, show the saved message only, never both.
  const saved =
    !!run.streamRunId &&
    (conversation?.messages ?? []).some((m) => m.runId === run.streamRunId);
  const messages = conversation?.messages || [];
  const empty = messages.length === 0;
  const freeOnly = settings?.costPolicy === 'free-only';
  const blockedReason =
    model && connection
      ? policyBlock(
          { connectionId: connection.id, modelId: model },
          conversation?.id,
        )
      : null;
  const ready = !!model && (routed ? !!pool?.route : !!connection && !needsKey) && !blockedReason;
  const allowCharges = async () => {
    if (!conversation) await newConversation();
    const current = useChat.getState().activeConversation();
    if (current) await setAllowCharges(current.id, true);
  };
  const nameOf = (connectionId: string) =>
    connections.find((c) => c.id === connectionId)?.name ??
    'removed connection';
  // The live answer shows the model being asked: the Free Router's current attempt, or the chosen
  // model, replaced by the concrete model when a provider's own router (openrouter/free) reports it.
  // For the Free Agent, the live answer is the writer's; drafts show in the steps, not as the answer.
  const asking = [...run.route].reverse().find((step) => step.status === 'trying');
  const writing = [...run.agent].reverse().find((step) => step.role === 'writer' && step.status === 'running' && step.model && step.connectionId);
  const liveRef = isAgent(ref)
    ? writing && { connectionId: writing.connectionId!, modelId: writing.model! }
    : routed
    ? asking && { connectionId: asking.connectionId, modelId: asking.model }
    : ref && model ? { connectionId: ref.connectionId, modelId: model } : undefined;
  const liveListed = liveRef ? answerModel({ connectionId: liveRef.connectionId, modelId: run.selectedModel || liveRef.modelId }) : undefined;
  const liveModel = liveListed && { ...liveListed, ...(run.selectedProvider ? { provider: run.selectedProvider } : {}) };
  useEffect(() => {
    setInput(branchDraft.current ?? '');
    branchDraft.current = null;
    setActionError('');
    sticky.current = true;
  }, [conversation?.id]);
  useEffect(() => {
    if (sticky.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages.length, run.partial, run.reasoning, run.activities.length, run.tools.length]);
  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = 'auto';
      textarea.current.style.height =
        Math.min(textarea.current.scrollHeight, 180) + 'px';
    }
  }, [input]);
  const submit = () => {
    if (!input.trim() || run.running || !ready || preview.warnings.length)
      return;
    const prompt = input.trim();
    setInput('');
    sticky.current = true;
    void run.send(prompt, documents);
  };
  /** Tools are a per-thread setting, so presets save them and they stay visible until turned off. */
  const setTool = async (tool: WorkbenchTool, on: boolean) => {
    try {
      if (!conversation) await newConversation();
      const current = useChat.getState().activeConversation();
      if (!current) throw new Error('Unable to create a thread.');
      const now = workbenchSettings(current, settings);
      await setWorkbench(current.id, { ...now, tools: on ? [...new Set([...now.tools, tool])] : now.tools.filter((t) => t !== tool) });
      setActionError('');
    } catch (error) {
      setActionError((error as Error).message);
    }
  };
  const toggleTool = async (tool: WorkbenchTool) => {
    // Documents open their panel: the documents are shown even when this model cannot use them.
    if (tool === 'documents') { setShowDocs(true); return; }
    await setTool(tool, !enabledTools.includes(tool));
  };
  const branch = async (
    messageId: string,
    text: string,
    regenerate = false,
  ) => {
    if (!conversation || run.running) return;
    try {
      if (!regenerate) branchDraft.current = text;
      await forkConversation(conversation.id, messageId);
      setEdit(null);
      if (regenerate) await run.send(text, documents);
    } catch (error) {
      branchDraft.current = null;
      setActionError((error as Error).message);
    }
  };
  const suggestions = [
    {
      icon: Code2,
      title: 'Build something',
      text: 'Help me design a small project. Start by asking what I want to build.',
    },
    {
      icon: FileText,
      title: 'Work with my notes',
      text: 'Search my workspace documents and summarize the main decisions, open questions, and next steps.',
    },
    {
      icon: Lightbulb,
      title: 'Think it through',
      text: 'Help me think through an idea. Ask me about the goal and constraints first.',
    },
  ];
  return (
    <div className="np-chat">
      <div className="np-chat-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            style={{ fontWeight: 500, fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--np-text)' }}
            onClick={() => { if (conversation) setRename(conversation.title); }}
            title={empty ? 'New chat' : 'Rename thread'}
            disabled={empty}
          >
            {empty ? 'New chat' : conversation!.title}
            {!empty && <Pencil size={11} />}
          </button>
          {conversation?.branchOf && (
            <span className="np-label" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <GitBranch size={11} />
              Branch
            </span>
          )}
          <div style={{ width: '1px', height: '14px', background: 'var(--np-line)' }} />
          <button
            className="np-model-switch"
          aria-label="Choose model"
          disabled={run.running}
          onClick={() => setShowPicker(true)}
        >
          {routed ? <RouterMark size={16} /> : <span className="np-model-dot" />}
          <span>{routed ? routerName(ref) : model || 'Choose a model'}</span>
          <span className="np-model-source">
            {routed
              ? `${pool?.models ?? 0} free model${pool?.models === 1 ? '' : 's'}`
              : connection?.name ?? (model ? 'Connection removed' : '')}
          </span>
          <ArrowRight size={13} />
        </button>
        </div>
        <div className="np-toolbar-actions">
          {freeOnly && (
            <button
              className={`np-label np-policy-pill ${conversation?.allowCharges ? 'error' : ''}`}
              title={
                conversation?.allowCharges
                  ? 'Charges are allowed in this thread. Select to block them again.'
                  : 'Free only is on. Change it in Models.'
              }
              onClick={() => {
                if (conversation?.allowCharges)
                  void setAllowCharges(conversation.id, false);
                else onModels();
              }}
            >
              {conversation?.allowCharges
                ? 'Charges allowed here'
                : 'Free only'}
            </button>
          )}
          {messages.length > 0 && (
            <button
              className="np-icon-button"
              aria-label="Export thread"
              title="Export thread"
              onClick={() => {
                if (conversation)
                  exportText(
                    'nerdplexity-thread.json',
                    exportConversation(conversation),
                    'application/json',
                  );
              }}
            >
              <Download size={16} />
            </button>
          )}
          <button
            className={`np-icon-button ${showControls ? 'active' : ''}`}
            disabled={run.running}
            aria-label="Generation settings"
            aria-expanded={showControls}
            title="Generation settings"
            onClick={() => setShowControls(!showControls)}
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </div>
      
      {showDocs && (
        <DocumentsPanel
          documents={documents}
          enabled={documentsOn}
          modelChosen={!!model && !!connection}
          local={local}
          toolsSupported={descriptor?.capabilities.tools !== false}
          onToggle={(on) => void setTool('documents', on)}
          onManage={() => { setShowDocs(false); onDocuments(); }}
          onChooseModel={() => { setShowDocs(false); setShowPicker(true); }}
          onClose={() => setShowDocs(false)}
        />
      )}
      {showPicker && (
        <ModelPicker
          selected={ref}
          onClose={() => setShowPicker(false)}
          onConnections={onModels}
        />
      )}
      {showControls && (
        <RunSettings
          conversation={conversation}
          connection={connection}
          model={descriptor}
          selected={ref}
          prompt={input}
          onClose={() => setShowControls(false)}
        />
      )}
      {rename !== null && (
        <WorkbenchDialog title="Rename thread" onClose={() => setRename(null)}>
          <form
            className="np-settings-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                if (conversation)
                  await updateConversationTitle(conversation.id, rename.trim());
                setRename(null);
              } catch {
                setActionError('Unable to rename this thread.');
              }
            }}
          >
            <label className="np-field">
              <span>Thread title</span>
              <input
                autoFocus
                aria-label="Thread title"
                value={rename}
                maxLength={200}
                required
                onChange={(e) => setRename(e.target.value)}
              />
            </label>
            <footer>
              <button className="np-button primary" disabled={!rename.trim()}>
                Save title
              </button>
            </footer>
          </form>
        </WorkbenchDialog>
      )}
      {edit && (
        <WorkbenchDialog
          title="Edit in a new branch"
          onClose={() => setEdit(null)}
        >
          <form
            className="np-settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              void branch(edit.messageId, edit.content);
            }}
          >
            <p className="np-dialog-note">
              The original thread is kept. Your edited message will be ready in
              the new branch; send it when you are ready.
            </p>
            <label className="np-field">
              <span>Message</span>
              <textarea
                autoFocus
                aria-label="Branch message"
                rows={6}
                required
                maxLength={200_000}
                value={edit.content}
                onChange={(e) => setEdit({ ...edit, content: e.target.value })}
              />
            </label>
            <footer>
              <button
                className="np-button primary"
                disabled={!edit.content.trim()}
              >
                Start branch
              </button>
            </footer>
          </form>
        </WorkbenchDialog>
      )}

      <div
        className={`np-chat-scroll ${empty ? 'empty' : ''}`}
        ref={scroll}
        onScroll={() => {
          const el = scroll.current;
          if (el) {
            sticky.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 90;
            setShowScroll(!sticky.current);
          }
        }}
      >
        {empty ? (
          <div className="np-welcome-minimal">
            <h1>Nerdplexity</h1>
            <p>A quiet space for intelligence that runs on your terms.</p>
            <div className="np-suggestions">
              {suggestions.map(({ icon: Icon, title, text }) => (
                <button
                  key={title}
                  onClick={() => {
                    if (title === 'Work with my notes') {
                      if (!documents.length || !local || !model) {
                        setShowDocs(true);
                        return;
                      }
                      if (!documentsOn) void setTool('documents', true);
                    }
                    setInput(text);
                    textarea.current?.focus();
                  }}
                >
                  <Icon size={18} />
                  <span>{title}</span>
                </button>
              ))}
            </div>
            {!ready && (
              <button className="np-connect-prompt" onClick={onModels}>
                {needsKey
                  ? `Add your ${connection?.name} API key to get started`
                  : routed
                    ? 'The Free Router needs a free model: connect OpenRouter or a local runtime'
                  : model && !connection
                    ? 'This thread’s connection was removed. Choose a model'
                    : 'Choose a model to get started'}
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        ) : (
          <div className="np-thread">
            {messages.map((message, index) => (
              <Fragment key={message.id}>
                {message.role === 'assistant' && (message.metadata?.route || message.metadata?.agent || message.metadata?.tools || message.metadata?.activities) && (
                  // Above a saved answer, the panels sit in the transcript column.
                  <div className="np-inline-tools">
                    {message.metadata.route && <RouteActivity steps={message.metadata.route.steps} task={message.metadata.route.task} nameOf={nameOf} />}
                    {message.metadata.agent && <AgentActivity steps={message.metadata.agent.steps} calls={message.metadata.agent.calls} nameOf={nameOf} />}
                    {(message.metadata.tools || message.metadata.activities) && <ToolActivity tools={message.metadata.tools ?? []} activities={message.metadata.activities} />}
                  </div>
                )}
                <Message
                  message={{ ...message, timestamp: message.createdAt }}
                  animate={!message.runId}
                  model={message.role === 'assistant' ? answerModel(message.provenance) : undefined}
                />
                {message.role === 'assistant' &&
                  (message.provenance ||
                    message.runStatus ||
                    message.finishReason === 'length' ||
                    message.finishReason === 'max_tokens') && (
                    <p
                      className={`np-provenance ${message.runStatus ? 'partial' : ''}`}
                    >
                      {[
                        message.provenance &&
                          `${message.provenance.modelId} · ${connections.find((c) => c.id === message.provenance!.connectionId)?.name ?? 'removed connection'}`,
                        message.metadata?.agent ? `via ${AGENT_NAME}` : message.metadata?.route && `via ${ROUTER_NAME}`,
                        message.runStatus &&
                          RUN_STATUS_LABEL[message.runStatus],
                        (message.finishReason === 'length' ||
                          message.finishReason === 'max_tokens') &&
                          'Stopped at the output limit',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                <div className="np-message-actions">
                  <button
                    className="np-icon-button"
                    aria-label={`Copy message ${index + 1}`}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(message.content);
                        setActionNotice('Message copied.');
                      } catch {
                        setActionError(
                          'Clipboard is unavailable. Select and copy the message text.',
                        );
                      }
                    }}
                  >
                    <Copy size={13} />
                    <span>Copy</span>
                  </button>
                  {message.role === 'user' && (
                    <button
                      className="np-icon-button"
                      disabled={run.running}
                      aria-label={`Edit message ${index + 1} in a branch`}
                      onClick={() =>
                        setEdit({
                          messageId: message.id,
                          content: message.content,
                        })
                      }
                    >
                      <GitBranch size={13} />
                      <span>Edit in branch</span>
                    </button>
                  )}
                  {message.role === 'assistant' && (
                    <>
                      <button
                        className={`np-icon-button ${message.feedback === 'helpful' ? 'active' : ''}`}
                        aria-label={`Mark message ${index + 1} helpful`}
                        aria-pressed={message.feedback === 'helpful'}
                        title="Helpful"
                        onClick={() => conversation && void setMessageFeedback(conversation.id, message.id, message.feedback === 'helpful' ? undefined : 'helpful').catch(() => setActionError('Unable to save feedback.'))}
                      >
                        <ThumbsUp size={13} />
                        <span>Helpful</span>
                      </button>
                      <button
                        className={`np-icon-button ${message.feedback === 'unhelpful' ? 'active' : ''}`}
                        aria-label={`Mark message ${index + 1} unhelpful`}
                        aria-pressed={message.feedback === 'unhelpful'}
                        title="Unhelpful"
                        onClick={() => conversation && void setMessageFeedback(conversation.id, message.id, message.feedback === 'unhelpful' ? undefined : 'unhelpful').catch(() => setActionError('Unable to save feedback.'))}
                      >
                        <ThumbsDown size={13} />
                        <span>Unhelpful</span>
                      </button>
                      <button
                        className="np-icon-button"
                        disabled={run.running}
                        aria-label={`Regenerate message ${index + 1}`}
                        onClick={() => {
                          const user = messages
                            .slice(0, index)
                            .reverse()
                            .find((m) => m.role === 'user');
                          if (user) void branch(user.id, user.content, true);
                        }}
                      >
                        <RotateCcw size={13} />
                        <span>Regenerate in branch</span>
                      </button>
                    </>
                  )}
                </div>
              </Fragment>
            ))}
            {ownRun && !saved && (run.running || run.partial || run.reasoning || run.route?.length > 0 || run.agent?.length > 0 || run.tools?.length > 0 || run.activities?.length > 0) && (
              <Message
                message={{
                  id: 'stream',
                  role: 'assistant',
                  content: run.partial || '',
                  timestamp: Date.now(),
                  metadata: run.reasoning
                    ? { reasoning: run.reasoning }
                    : undefined,
                }}
                model={liveModel}
                streaming={run.running}
                status={run.running ? run.phase : undefined}
              >
                {run.route?.length > 0 && <RouteActivity steps={run.route} nameOf={nameOf} live={run.running} />}
                {run.agent?.length > 0 && <AgentActivity steps={run.agent} nameOf={nameOf} />}
                {(run.tools?.length > 0 || run.activities?.length > 0) && <ToolActivity tools={run.tools} activities={run.activities} />}
              </Message>
            )}
            {ownRun && !run.running && run.phase && (
              <div className="np-live-status">{run.phase}</div>
            )}
          </div>
        )}
      </div>
      {showScroll && (
        <button
          className="np-scroll-bottom np-icon-button"
          aria-label="Scroll to latest message"
          onClick={() => {
            if (scroll.current)
              scroll.current.scrollTop = scroll.current.scrollHeight;
            sticky.current = true;
            setShowScroll(false);
          }}
        >
          <ArrowDown size={16} />
        </button>
      )}
      <div className="np-composer-area">
        {actionError && (
          <div className="np-error" role="alert" style={{ whiteSpace: 'pre-line' }}>
            {actionError}
            <button
              className="np-icon-button"
              aria-label="Dismiss action error"
              onClick={() => setActionError('')}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {actionNotice && (
          <p className="np-action-notice" role="status">
            {actionNotice}
          </p>
        )}
        {preview.warnings.length > 0 && (
          <div className="np-policy-block" role="alert">
            <span>{preview.warnings[0]}</span>
            <button
              className="np-button small"
              onClick={() => setShowControls(true)}
            >
              Review context
            </button>
          </div>
        )}
        {preview.notices.length > 0 && (
          <div className="np-policy-block" role="status">
            <span>{preview.notices[0]}</span>
            <button
              className="np-button small"
              onClick={() => setShowControls(true)}
            >
              Review context
            </button>
          </div>
        )}
        <button
          className="np-context-trigger"
          type="button"
          disabled={run.running}
          onClick={() => setShowControls(true)}
          aria-label="Inspect context"
        >
          <span>
            ~{preview.estimatedTokens.toLocaleString()} input tokens ·{' '}
            {preview.budget.toLocaleString()} budget
          </span>
          <span>
            {preview.omittedMessages
              ? `${preview.omittedMessages} messages omitted`
              : 'Full thread included'}
            <SlidersHorizontal size={12} />
          </span>
        </button>
        {run.error && (
          <div className="np-error np-chat-error" role="alert">
            <span>
              {run.error.message}
              {run.error.retryAfterMs !== undefined &&
                ` Try again in ${Math.ceil(run.error.retryAfterMs / 1000)}s.`}
            </span>
            {run.error.suggestions?.map((ref) => (
              <button
                key={`${ref.connectionId}::${ref.modelId}`}
                className="np-button small"
                onClick={() => void run.retry(ref)}
              >
                Try {ref.modelId}
                {ref.connectionId !== connection?.id
                  ? ` (${nameOf(ref.connectionId)})`
                  : ''}
              </button>
            ))}
            {run.canRetry && run.error.retryable && (
              <button
                className="np-button small"
                onClick={() => void run.retry()}
              >
                Retry
              </button>
            )}
            <button
              aria-label="Dismiss error"
              className="np-icon-button"
              onClick={run.clearError}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {blockedReason && !run.running && (
          <div className="np-policy-block" role="note">
            <span>{blockedReason}</span>
            <div>
              <button className="np-button ghost small" onClick={onModels}>
                Choose a free model
              </button>
              <button
                className="np-button small"
                onClick={() => void allowCharges()}
              >
                Allow charges in this thread
              </button>
            </div>
          </div>
        )}
        {!!conversation?.attachments?.length && (
          <div className="np-attachments" aria-label="Thread attachments">
            {conversation.attachments.map((file) => (
              <details key={file.id} className="np-attachment">
                <summary>
                  {file.kind === 'image' ? <Paperclip size={13} /> : <FileText size={13} />}
                  <span>{file.name}</span>
                  <small>{Math.max(1, Math.ceil(file.size / 1024))} KB · inspect</small>
                </summary>
                <div>
                  {file.kind === 'image' ? (
                    <img className="np-attachment-image" src={`data:${file.mimeType};base64,${file.content}`} alt={file.name} />
                  ) : file.kind === 'pdf' ? (
                    pdfBlobUrls.has(file.id) ? (
                      <div className="np-attachment-pdf-actions">
                        <p>PDF Document</p>
                        <button type="button" className="np-button primary small" onClick={() => setViewPdf({ id: file.id, name: file.name, url: pdfBlobUrls.get(file.id)! })}>
                          Open PDF
                        </button>
                      </div>
                    ) : (
                      <div className="np-attachment-pdf-actions">
                        <p>PDF Document (Text Only)</p>
                        <p className="np-text-small">This document was uploaded in a previous session. Re-upload it to view the original PDF.</p>
                      </div>
                    )
                  ) : (
                    <pre>{file.content}</pre>
                  )}
                  <button type="button" className="np-button ghost small np-remove-attachment" disabled={run.running} onClick={() => void removeAttachment(conversation.id, file.id)}>
                    <X size={12} /> Remove from context
                  </button>
                </div>
              </details>
            ))}
          </div>
        )}
        <form
          className="np-composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            ref={textarea}
            rows={2}
            aria-label="Message"
            placeholder={
              documentsOn
                ? 'Ask your workspace a question…'
                : 'Where do you want to start?'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="np-composer-toolbar">
            <div className="np-composer-modes">
              <button
                type="button"
                className="np-mode"
                disabled={run.running}
                onClick={() => attachmentInput.current?.click()}
              >
                <Paperclip size={13} /> <span className="np-mode-label">Attach</span>
              </button>
              <input
                ref={attachmentInput}
                className="np-visually-hidden"
                tabIndex={-1}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf,text/*,.md,.markdown,.csv,.json,.jsonl,.log,.xml,.yaml,.yml,.toml,.ini,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.rs,.go,.java,.kt,.c,.h,.cpp,.hpp,.cs,.php,.swift,.sql,.sh,.zsh,.fish,.html,.css,.scss,.less,.vue,.svelte"
                aria-label="Attach files"
                onChange={async (event) => {
                  const control = event.currentTarget;
                  const files = [...(control.files ?? [])];
                  try {
                    if (!conversation) await newConversation();
                    const current = useChat.getState().activeConversation();
                    if (!current) throw new Error('Unable to create a thread.');
                    let existing = current.attachments ?? [];
                    let failed = 0;
                    const errors: string[] = [];
                    for (const file of files) {
                      try {
                        const attachment = await attachmentFromFile(file, existing);
                        await addAttachment(current.id, attachment);
                        existing = [...existing, attachment];
                      } catch (e) {
                        failed++;
                        console.error('Attachment failed:', e);
                        errors.push((e as Error).message);
                      }
                    }
                    if (errors.length > 0) {
                      setActionError(errors.join('\n'));
                    }
                    const successes = files.length - failed;
                    if (successes > 0) {
                      setActionNotice(`${successes} file${successes === 1 ? '' : 's'} attached to this thread.`);
                    }
                  } catch (error) {
                    setActionError((error as Error).message);
                  } finally {
                    control.value = '';
                  }
                }}
              />
              {([
                ['calculator', Calculator, 'Calculator', 'Lets the model do exact arithmetic with an app calculator'],
                ['documents', Workflow, 'Documents', 'Open your Workspace documents and choose whether this thread may search them'],
              ] as const).map(([tool, Icon, name, hint]) => (
                <button
                  key={tool}
                  type="button"
                  className={`np-mode ${enabledTools.includes(tool) ? 'selected' : ''}`}
                  aria-pressed={enabledTools.includes(tool)}
                  aria-label={`${name} tool`}
                  disabled={run.running || (tool !== 'documents' && descriptor?.capabilities.tools === false)}
                  title={tool !== 'documents' && descriptor?.capabilities.tools === false ? 'This model does not support tools' : hint}
                  onClick={() => void toggleTool(tool)}
                >
                  <Icon size={13} />
                  <span className="np-mode-label">{name}</span>
                </button>
              ))}
            </div>
            <div className="np-composer-send">
              {local && (
                <span className="np-local-label">
                  <i />
                  Local
                </span>
              )}
              {run.running ? (
                <button
                  type="button"
                  className="np-send stop"
                  aria-label="Stop generation"
                  title="Stop generation"
                  onClick={run.stop}
                >
                  <Square size={14} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="np-send"
                  aria-label="Send message"
                  title="Send message"
                  disabled={
                    !input.trim() || !ready || preview.warnings.length > 0
                  }
                >
                  <ArrowUp size={18} />
                </button>
              )}
            </div>
          </div>
        </form>
        <div className="np-composer-footnote">
          <span>
            {[
              (enabledTools.includes('calculator') || documentsOn) &&
                `Tools: ${[
                  enabledTools.includes('calculator') && 'Calculator',
                  documentsOn && `Documents (${documents.length}, search and read only)`,
                ]
                  .filter(Boolean)
                  .join(', ')}`,
              webAuto && 'Web search is automatic (Exa)',
              routed
                ? isAgent(ref)
                  ? `The Free Agent may ask several of your ${pool?.models ?? 0} free models per message (at most 5 requests) and writes one checked answer; prompts go only to the models it asks.`
                  : `The Free Router picks one of ${pool?.models ?? 0} free models for each message; prompts go only to the model it picks.`
                : !connection
                ? 'Choose a model in Models.'
                : local
                  ? webAuto ? 'The model runs on this machine.' : 'Requests stay on this machine.'
                  : `Prompts are sent to ${connection.name}${hasKey(connection.id) ? ' with your API key' : ''}.`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span>Shift + Enter for a new line</span>
        </div>
      </div>
      {viewPdf && (
        <WorkbenchDialog title={viewPdf.name} onClose={() => setViewPdf(null)}>
          <div className="np-pdf-viewer">
            <iframe
              src={viewPdf.url}
              title={viewPdf.name}
              className="np-pdf-iframe"
            />
            <div className="np-pdf-footer">
               <a href={viewPdf.url} download={viewPdf.name} className="np-button ghost small">Download</a>
               <button className="np-button primary small" onClick={() => {
                 window.open(viewPdf.url, '_blank');
               }}>Open in browser</button>
            </div>
          </div>
        </WorkbenchDialog>
      )}
    </div>
  );
}
