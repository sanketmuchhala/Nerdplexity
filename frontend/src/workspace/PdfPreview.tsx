import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, ZoomIn, ZoomOut } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ThreadAttachment } from '../lib/db';
import { fileBase64, isPdf, loadPdf, pdfBytes, readDocument } from '../lib/documents';
import * as store from '../lib/store';
import { WorkbenchDialog } from './WorkbenchDialog';

export function PdfPreview({ conversationId, file, onClose, onRestored, onRemove, removingDisabled }: {
  conversationId: string;
  file: ThreadAttachment;
  onClose: () => void;
  onRestored: () => void;
  onRemove: () => Promise<void>;
  removingDisabled: boolean;
}) {
  const [source, setSource] = useState<string>();
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [splitView, setSplitView] = useState(false);
  const [width, setWidth] = useState(600);
  const [loading, setLoading] = useState(!!file.hasPdf);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const [download, setDownload] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!file.hasPdf) return;
    const controller = new AbortController();
    setLoading(true);
    store.conversations.pdf(conversationId, file.id, controller.signal)
      .then(result => { if (!controller.signal.aborted) setSource(result.pdfBase64); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message || 'Unable to load the original PDF.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [conversationId, file.id, file.hasPdf]);

  useEffect(() => {
    if (!source) return;
    let canceled = false;
    let task: Awaited<ReturnType<typeof loadPdf>> | undefined;
    let url: string | undefined;
    setLoading(true);
    setError('');
    void (async () => {
      url = URL.createObjectURL(new Blob([pdfBytes(source)], { type: 'application/pdf' }));
      setDownload(url);
      task = await loadPdf(pdfBytes(source));
      if (canceled) { await task.destroy(); return; }
      const pdf = await task.promise;
      if (!canceled) { setDocument(pdf); setPageNumber(1); }
    })().catch(reason => { if (!canceled) setError(reason.message || 'Unable to display this PDF.'); })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; if (url) URL.revokeObjectURL(url); void task?.destroy(); };
  }, [source]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(160, entry.contentRect.width - 32)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!document || !canvas.current) return;
    let canceled = false;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setRendering(true);
    setError('');
    void (async () => {
      const page = await document.getPage(pageNumber);
      if (canceled || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(width / base.width, 1.5) * zoom;
      const view = page.getViewport({ scale });
      // Keep large pages/zoom bounded while rendering sharply on Retina displays.
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (view.width * view.height)));
      const element = canvas.current;
      element.width = Math.ceil(view.width * ratio);
      element.height = Math.ceil(view.height * ratio);
      element.style.width = `${view.width}px`;
      element.style.height = `${view.height}px`;
      render = page.render({ canvas: element, viewport: view, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
    })().catch(reason => { if (!canceled) setError(reason.message || 'Unable to render this page.'); })
      .finally(() => { if (!canceled) setRendering(false); });
    return () => { canceled = true; render?.cancel(); };
  }, [document, pageNumber, zoom, width]);

  const restore = async (original?: File) => {
    if (!original) return;
    setLoading(true); setError('');
    try {
      if (!isPdf(original)) throw new Error('Choose the original PDF file.');
      const text = await readDocument(original);
      if (text !== file.content) throw new Error('This PDF does not match the saved attachment text. Choose the original file, or attach this PDF as a new file.');
      const pdfBase64 = await fileBase64(original);
      await store.conversations.restorePdf(conversationId, file.id, pdfBase64);
      setSource(pdfBase64);
      onRestored();
    } catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  };

  return <WorkbenchDialog title={file.name} onClose={onClose} className={`np-pdf-dialog ${splitView ? "np-dialog-split" : ""}`}>
    <div className="np-pdf-toolbar" aria-label="PDF controls">
      <button type="button" className="np-icon-button" aria-label="Previous page" disabled={!document || pageNumber <= 1} onClick={() => setPageNumber(n => n - 1)}><ChevronLeft size={18} /></button>
      <span aria-live="polite">Page {document ? pageNumber : '—'} of {document?.numPages ?? '—'}</span>
      <button type="button" className="np-icon-button" aria-label="Next page" disabled={!document || pageNumber >= document.numPages} onClick={() => setPageNumber(n => n + 1)}><ChevronRight size={18} /></button>
      <button type="button" className="np-icon-button" aria-label="Zoom out" disabled={!document || zoom <= .5} onClick={() => setZoom(n => Math.max(.5, n - .25))}><ZoomOut size={17} /></button>
      <span>{Math.round(zoom * 100)}%</span>
      <button type="button" className="np-icon-button" aria-label="Zoom in" disabled={!document || zoom >= 2} onClick={() => setZoom(n => Math.min(2, n + .25))}><ZoomIn size={17} /></button>
      <button type="button" className="np-button small ghost" onClick={() => setSplitView(!splitView)} style={{ marginLeft: "auto" }}>{splitView ? "Full View" : "Split View"}</button>
      {download && <div className="np-pdf-actions">
        <a className="np-button small ghost" href={download} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Open in browser</a>
        <a className="np-button small ghost" href={download} download={file.name}><Download size={15} />Download PDF</a>
      </div>}
    </div>
    {error && <p className="np-error" role="alert">{error}</p>}
    {!file.hasPdf && !source && <div className="np-pdf-restore">
      <p>This older attachment saved only extracted text. Choose the original PDF once to restore its page preview.</p>
      <label className="np-button small">Choose original PDF<input type="file" accept="application/pdf,.pdf" aria-label="Choose original PDF" disabled={loading} onChange={event => { void restore(event.target.files?.[0]); event.target.value = ''; }} /></label>
    </div>}
    {(loading || rendering) && <p role="status">{loading ? 'Loading PDF…' : 'Rendering page…'}</p>}
    <div ref={viewport} className="np-pdf-viewport" aria-busy={loading || rendering}>
      {document && <canvas ref={canvas} role="img" aria-label={`Page ${pageNumber} of ${document.numPages}`} style={{ visibility: rendering ? 'hidden' : 'visible' }} />}
    </div>
    <details className="np-pdf-text"><summary>Extracted text used in chat</summary><pre>{file.content}</pre></details>
    <footer><button type="button" className="np-button ghost small" disabled={removingDisabled} onClick={() => { void onRemove().then(onClose).catch(reason => setError(reason.message || 'Unable to remove this attachment.')); }}>Remove from context</button></footer>
  </WorkbenchDialog>;
}
