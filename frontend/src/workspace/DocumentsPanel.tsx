import { FileText, FolderOpen, Plus } from 'lucide-react';
import type { WorkspaceDocument } from '../lib/db';
import { WorkbenchDialog } from './WorkbenchDialog';

/**
 * The Documents tool: the workspace documents a model on this machine may search and read,
 * and the switch that allows it for this thread. Opens even when the current model cannot use
 * them, so the documents are always one click away.
 */
export function DocumentsPanel({
  documents, enabled, modelChosen, local, toolsSupported, onToggle, onManage, onChooseModel, onClose,
}: {
  documents: WorkspaceDocument[];
  enabled: boolean;
  modelChosen: boolean;
  local: boolean;
  toolsSupported: boolean;
  onToggle: (on: boolean) => void;
  onManage: () => void;
  onChooseModel: () => void;
  onClose: () => void;
}) {
  const usable = documents.length > 0 && modelChosen && local && toolsSupported;
  const reason = !documents.length
    ? 'Add a document to let a model search it.'
    : !modelChosen
      ? 'Choose a model on this machine (Ollama or LM Studio) to use these documents.'
      : !local
        ? 'Documents never leave this machine, so they work only with models running here. The current model runs online.'
        : !toolsSupported
          ? 'This model does not support tools, so it cannot search documents. Choose another model on this machine.'
          : null;
  const totalChars = documents.reduce((n, doc) => n + doc.content.length, 0);

  return (
    <WorkbenchDialog title="Documents" onClose={onClose} sheet>
      <p className="np-dialog-note">
        {documents.length
          ? `${documents.length} ${documents.length === 1 ? 'document' : 'documents'} · ${totalChars.toLocaleString()} characters. The model can search and read them, one page at a time; each call appears with the answer.`
          : 'Your workspace is empty. Documents stay in this browser.'}
      </p>

      <div className={`np-docs-switch ${enabled ? 'on' : ''}`}>
        <div>
          <strong>Let the model search and read these</strong>
          <span>{enabled ? 'On for this thread.' : reason ?? 'Off for this thread.'}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Use documents in this thread"
          className="np-switch"
          disabled={!enabled && !usable}
          onClick={() => onToggle(!enabled)}
        >
          <i />
        </button>
      </div>

      {documents.length > 0 ? (
        <ul className="np-docs-list" aria-label="Workspace documents">
          {documents.map((doc, index) => (
            <li key={doc.id} style={{ ['--i' as string]: index }}>
              <FileText size={15} aria-hidden />
              <div>
                <strong>{doc.title}</strong>
                <span>{doc.content.length.toLocaleString()} characters · updated {new Date(doc.updatedAt).toLocaleDateString()}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="np-docs-empty">
          <FolderOpen size={26} aria-hidden />
          <p>Add a project brief, meeting notes, or a README. Then ask about it in chat.</p>
        </div>
      )}

      <footer>
        {modelChosen && (!local || !toolsSupported) && documents.length > 0 && (
          <button type="button" className="np-button ghost" onClick={onChooseModel}>Choose another model</button>
        )}
        <button type="button" className={`np-button ${documents.length ? 'ghost' : 'primary'}`} onClick={onManage}>
          {documents.length ? <><FolderOpen size={14} /> Manage in Workspace</> : <><Plus size={14} /> Add a document</>}
        </button>
      </footer>
    </WorkbenchDialog>
  );
}
