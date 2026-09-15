/** Files are decoded in the browser. Only extracted text is saved or sent to a model. */
export const DOCUMENT_LIMITS = { fileBytes: 20_000_000, textBytes: 2_000_000, workspaceBytes: 4_000_000 } as const;
export const DOCUMENT_FORMATS = 'PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), OpenDocument, EPUB, RTF, HTML, text, data, and code';
const PACKAGED = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub']);
const LEGACY = new Set(['doc', 'xls', 'ppt', 'pages', 'numbers', 'key']);
const TEXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'log', 'xml', 'yaml', 'yml', 'toml', 'ini', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'rs', 'go', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'swift', 'sql', 'sh', 'zsh', 'fish', 'html', 'htm', 'css', 'scss', 'less', 'vue', 'svelte', 'tex', 'rst', 'ipynb', 'r', 'env', 'conf', 'cfg', 'srt', 'vtt', 'rtf']);
const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/epub+zip': 'epub', 'text/html': 'html', 'application/rtf': 'rtf', 'text/rtf': 'rtf',
};
const extensionOf = (file: Pick<File, 'name' | 'type'>) => MIME_EXTENSIONS[file.type] ?? file.name.toLowerCase().split('.').pop() ?? '';

export function documentFileError(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (file.size > DOCUMENT_LIMITS.fileBytes) return 'Keep each document under 20 MB.';
  if (!file.size) return 'This file is empty.';
  if (LEGACY.has(extensionOf(file))) return 'Export this document as PDF, DOCX, XLSX, PPTX, or plain text, then attach the exported file.';
  return null;
}

function checkedText(text: string): string {
  const content = text.replace(/\r\n?/g, '\n').trim();
  if (!content) throw new Error('No readable text was found in this document.');
  if (new TextEncoder().encode(content).length > DOCUMENT_LIMITS.textBytes)
    throw new Error('The extracted document exceeds 2 MB of text. Split it into smaller documents.');
  return content;
}

function decodeText(bytes: Uint8Array): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error('This file is not readable text. Export it as UTF-8 text or a supported document format.'); }
  if (/[\x00-\x08\x0e-\x1f]/.test(text)) throw new Error('This appears to be a binary file. Upload a supported document format.');
  return text;
}

const elements = (node: Document | Element, name: string) => [...node.getElementsByTagNameNS('*', name)];
const attr = (node: Element, name: string) => [...node.attributes].find(a => a.localName === name)?.value ?? '';
const relationId = (node: Element) => [...node.attributes].find(a => a.localName === 'id' && a.namespaceURI)?.value ?? null;
function xml(text: string): Document {
  // No external entities or document type declarations are needed by these formats.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('This document contains unsupported XML declarations.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The document contains damaged XML.');
  return doc;
}

/** Preserve paragraph, row, cell, tab and line boundaries without exposing document markup. */
function structuredText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1 && node.nodeType !== 9) return '';
  const element = node as Element;
  const name = element.localName;
  if (['script', 'style', 'noscript', 'del', 'instrText'].includes(name)) return '';
  if (name === 'tab') return '\t';
  if (['br', 'cr', 'line-break'].includes(name)) return '\n';
  if (name === 's') return ' '.repeat(Math.min(100, Number(attr(element, 'c')) || 1));
  const content = [...node.childNodes].map(structuredText).join('');
  if (['tc', 'table-cell', 'td', 'th'].includes(name)) return content.trim() + '\t';
  return content + (['p', 'h', 'tr', 'table-row', 'div', 'section', 'li', 'h1', 'h2', 'h3', 'h4'].includes(name) ? '\n' : '');
}

function htmlText(text: string): string {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return structuredText(doc.body).replace(/\n[ \t]*\n[ \t]*\n/g, '\n\n');
}

/** Read RTF groups and escapes, excluding metadata, pictures and embedded objects. */
function rtfText(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
  const source = parts.join('');
  if (!/^\{\\rtf\d/.test(source)) throw new Error('This is not a valid RTF document.');
  const hidden = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'objdata', 'filetbl', 'listtable', 'listoverridetable', 'revtbl', 'generator', 'fldinst', 'xmlnstbl', 'datastore', 'themedata', 'colorschememapping']);
  const symbols: Record<string, string> = { par: '\n', line: '\n', row: '\n', cell: '\t', tab: '\t', emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”' };
  let state = { skip: false, invisible: false, uc: 1, encoding: 'windows-1252' };
  const stack: typeof state[] = [];
  const output: string[] = [];
  let fallback = 0;
  const emit = (value: string) => {
    if (fallback) { fallback--; return; }
    if (!state.skip && !state.invisible) output.push(value);
  };
  for (let i = 0; i < source.length;) {
    const char = source[i++];
    if (char === '{') { stack.push({ ...state }); continue; }
    if (char === '}') {
      if (!stack.length) throw new Error('The RTF contains damaged groups.');
      state = stack.pop()!; fallback = 0; continue;
    }
    if (char === '\n' || char === '\r') continue;
    if (char !== '\\') {
      const start = i - 1;
      while (i < source.length && !['{', '}', '\\', '\n', '\r'].includes(source[i])) i++;
      const skip = Math.min(fallback, i - start);
      fallback -= skip;
      if (!state.skip && !state.invisible) output.push(new TextDecoder(state.encoding).decode(bytes.subarray(start + skip, i)));
      continue;
    }
    const next = source[i++];
    if (next === '*') { state.skip = true; continue; }
    if (next === "'") {
      const hex: number[] = [];
      do {
        const pair = source.slice(i, i + 2);
        if (!/^[\da-f]{2}$/i.test(pair)) throw new Error('The RTF contains a damaged character escape.');
        const byte = parseInt(pair, 16);
        if (fallback) fallback--; else hex.push(byte);
        i += 2;
        if (source.slice(i, i + 2) !== "\\'") break;
        i += 2;
      } while (i < source.length);
      if (!state.skip && !state.invisible) output.push(new TextDecoder(state.encoding).decode(new Uint8Array(hex)));
      continue;
    }
    if (['\\', '{', '}'].includes(next)) { emit(next); continue; }
    if (next === '~') { emit('\u00a0'); continue; }
    if (next === '_') { emit('‑'); continue; }
    if (!next || !/[a-z]/i.test(next)) continue;
    let word = next;
    while (i < source.length && /[a-z]/i.test(source[i])) word += source[i++];
    const parameter = /^-?\d+/.exec(source.slice(i, i + 20))?.[0];
    if (parameter) i += parameter.length;
    if (source[i] === ' ') i++;
    const value = Number(parameter);
    if (hidden.has(word)) state.skip = true;
    else if (word === 'bin') {
      if (!parameter || value < 0 || i + value > source.length) throw new Error('The RTF contains damaged binary data.');
      i += value;
    } else if (word === 'ansicpg') {
      const encoding = value === 65001 ? 'utf-8' : value === 932 ? 'shift_jis' : value === 936 ? 'gbk' : value === 949 ? 'euc-kr' : value === 950 ? 'big5' : `windows-${value}`;
      try { new TextDecoder(encoding); } catch { throw new Error('This RTF uses an unsupported character encoding. Export it as DOCX or UTF-8 text.'); }
      state.encoding = encoding;
    } else if (word === 'uc') state.uc = Math.max(0, Math.min(32767, value));
    else if (word === 'u' && parameter) {
      if (!state.skip && !state.invisible) output.push(String.fromCharCode(value & 0xffff));
      fallback = state.uc;
    } else if (word === 'v') state.invisible = value !== 0 || !parameter;
    else if (symbols[word]) emit(symbols[word]);
  }
  if (stack.length) throw new Error('The RTF contains damaged groups.');
  return output.join('');
}

async function packagedText(bytes: Uint8Array, extension: string): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate');
  let expanded = 0;
  let entries = 0;
  const files = unzipSync(bytes, { filter: entry => {
    if (++entries > 10_000) throw new Error('This document contains too many archive entries.');
    if (!/\.(xml|rels|opf|xhtml|html|htm)$/i.test(entry.name)) return false;
    expanded += entry.originalSize;
    if (expanded > 40_000_000 || entry.originalSize > 20_000_000) throw new Error('This document expands beyond the readable size limit.');
    return true;
  } });
  const read = (path: string) => {
    if (!files[path]) throw new Error(`The document is missing ${path}. It may be damaged or encrypted.`);
    return strFromU8(files[path]);
  };
  const parse = (path: string) => xml(read(path));
  if (extension === 'docx') {
    const paths = ['word/document.xml', ...Object.keys(files).filter(p => /^word\/(footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(p)).sort()];
    return paths.map(path => structuredText(parse(path))).join('\n\n');
  }
  if (extension === 'pptx') {
    // Presentation relationships carry the actual slide order, which may differ from filenames.
    const rels = elements(parse('ppt/_rels/presentation.xml.rels'), 'Relationship');
    const targets = new Map(rels.map(r => [r.getAttribute('Id'), r.getAttribute('Target') ?? '']));
    return elements(parse('ppt/presentation.xml'), 'sldId').map((slide, index) => {
      const target = targets.get(relationId(slide));
      if (!target) throw new Error('The presentation contains a missing slide.');
      const path = resolvePath('ppt/presentation.xml', target);
      const relPath = `${path.slice(0, path.lastIndexOf('/') + 1)}_rels/${path.split('/').pop()}.rels`;
      const notes = files[relPath] ? elements(parse(relPath), 'Relationship').find(rel => rel.getAttribute('Type')?.endsWith('/notesSlide'))?.getAttribute('Target') : undefined;
      const notesText = notes ? structuredText(parse(resolvePath(path, notes))) : '';
      return `[Slide ${index + 1}]\n${structuredText(parse(path))}${notesText.trim() ? `\n[Speaker notes]\n${notesText}` : ''}`;
    }).join('\n\n');
  }
  if (extension === 'xlsx') {
    const strings = files['xl/sharedStrings.xml'] ? elements(parse('xl/sharedStrings.xml'), 'si').map(si => elements(si, 't').map(t => t.textContent).join('')) : [];
    const rels = elements(parse('xl/_rels/workbook.xml.rels'), 'Relationship');
    const targets = new Map(rels.map(r => [r.getAttribute('Id'), r.getAttribute('Target') ?? '']));
    const book = parse('xl/workbook.xml');
    const date1904 = ['1', 'true'].includes(elements(book, 'workbookPr')[0]?.getAttribute('date1904') ?? '');
    const styles = files['xl/styles.xml'] ? parse('xl/styles.xml') : undefined;
    const formats = new Map(styles ? elements(styles, 'numFmt').map(format => [Number(format.getAttribute('numFmtId')), format.getAttribute('formatCode') ?? '']) : []);
    const cellStyles = styles ? elements(styles, 'cellXfs')[0]?.children : undefined;
    return elements(book, 'sheet').map(sheet => {
      const target = targets.get(relationId(sheet));
      if (!target) throw new Error('The workbook contains a missing sheet.');
      const rows = elements(parse(resolvePath('xl/workbook.xml', target)), 'row').map(row => elements(row, 'c').map(cell => {
        const value = elements(cell, 'v')[0]?.textContent ?? '';
        const type = cell.getAttribute('t');
        const formula = elements(cell, 'f')[0]?.textContent;
        let text = type === 's' ? strings[Number(value)] ?? '' : type === 'inlineStr' ? elements(cell, 't').map(t => t.textContent).join('') : type === 'b' ? (value === '1' ? 'TRUE' : 'FALSE') : value;
        const formatId = Number(cellStyles?.[Number(cell.getAttribute('s') ?? 0)]?.getAttribute('numFmtId') ?? 0);
        const format = formats.get(formatId) ?? '';
        if ((!type || type === 'n') && value && Number.isFinite(Number(value))) {
          const unquotedFormat = format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
          if ((formatId >= 14 && formatId <= 22) || (formatId >= 45 && formatId <= 47) || /[ydhs]/i.test(unquotedFormat)) {
            const serial = Number(value);
            const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, serial < 60 ? 31 : 30);
            const date = new Date(epoch + Math.round(serial * 86_400_000));
            if (Number.isFinite(date.getTime())) text = `${date.toISOString().replace(/T00(?::00){2}\.000Z$/, '')} [Excel serial: ${value}]`;
          } else if ([9, 10].includes(formatId) || unquotedFormat.includes('%')) text = `${Number((Number(value) * 100).toPrecision(12))}%`;
        }
        return `${cell.getAttribute('r') ?? ''}: ${text}${formula ? ` [formula: =${formula}]` : ''}`;
      }).join('\t')).join('\n');
      return `[Sheet: ${sheet.getAttribute('name') ?? 'Untitled'}]\n${rows}`;
    }).join('\n\n');
  }
  if (extension === 'epub') {
    const path = elements(parse('META-INF/container.xml'), 'rootfile')[0]?.getAttribute('full-path');
    if (!path) throw new Error('The EPUB is missing its reading order.');
    const book = parse(path);
    const manifest = new Map(elements(book, 'item').map(item => [item.getAttribute('id'), item.getAttribute('href') ?? '']));
    return elements(book, 'itemref').map((item, index) => {
      const href = manifest.get(item.getAttribute('idref'));
      if (!href) throw new Error('The EPUB contains a missing chapter.');
      return `[Section ${index + 1}]\n${htmlText(read(resolvePath(path, decodeURIComponent(href))))}`;
    }).join('\n\n');
  }
  const doc = parse('content.xml');
  if (extension === 'ods') return elements(doc, 'table').map(table => {
    let rowNumber = 1;
    const rows = elements(table, 'table-row').map(row => {
      let column = 1;
      const cells = [...row.children].filter(cell => ['table-cell', 'covered-table-cell'].includes(cell.localName)).map(cell => {
        const repeat = Math.max(1, Number(attr(cell, 'number-columns-repeated')) || 1);
        const label = `column ${column}${repeat > 1 ? `–${column + repeat - 1}` : ''}`;
        column += repeat;
        const value = structuredText(cell).trim() || attr(cell, 'date-value') || attr(cell, 'time-value') || attr(cell, 'boolean-value') || attr(cell, 'value') || attr(cell, 'string-value');
        const formula = attr(cell, 'formula');
        return value || formula ? `${label}: ${value}${formula ? ` [formula: ${formula}]` : ''}` : '';
      }).filter(Boolean).join('\t');
      const repeat = Math.max(1, Number(attr(row, 'number-rows-repeated')) || 1);
      const label = `Row ${rowNumber}${repeat > 1 ? `–${rowNumber + repeat - 1}` : ''}`;
      rowNumber += repeat;
      return cells ? `${label}: ${cells}` : '';
    }).filter(Boolean).join('\n');
    return `[Sheet: ${attr(table, 'name') || 'Untitled'}]\n${rows}`;
  }).join('\n\n');
  if (extension === 'odp') return elements(doc, 'page').map((page, index) => `[Slide ${index + 1}]\n${structuredText(page)}`).join('\n\n');
  return structuredText(doc);
}

function resolvePath(base: string, target: string): string {
  const path = target.startsWith('/') ? target : `${base.slice(0, base.lastIndexOf('/') + 1)}${target}`;
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  try {
    const doc = await task.promise;
    if (doc.numPages > 500) throw new Error('Keep PDFs under 500 pages. Split this PDF into smaller documents.');
    const pages: string[] = [];
    let total = 0;
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const text = await page.getTextContent();
      let previousY: number | undefined;
      const content = text.items.map(item => {
        if (!('str' in item)) return '';
        const y = item.transform[5];
        const newline = previousY !== undefined && Math.abs(previousY - y) > 3;
        previousY = y;
        return `${newline ? '\n' : ''}${item.str}${item.hasEOL ? '\n' : ' '}`;
      }).join('').trim();
      pages.push(`[Page ${number}]\n${content || '[No extractable text on this page; images and scans require OCR.]'}`);
      total += new TextEncoder().encode(pages[pages.length - 1]).length;
      if (total > DOCUMENT_LIMITS.textBytes) throw new Error('The extracted PDF exceeds 2 MB of text. Split it into smaller documents.');
      page.cleanup();
    }
    if (pages.every(page => page.includes('\n[No extractable text on this page;')))
      throw new Error('This PDF contains scans or images without readable text. Run OCR on it, or attach the pages as images to a vision model.');
    return pages.join('\n\n');
  } catch (error) {
    if ((error as Error).name === 'PasswordException') throw new Error('This PDF is password protected. Upload an unlocked copy.');
    throw error;
  } finally { await task.destroy(); }
}

export async function readDocument(file: File): Promise<string> {
  const error = documentFileError(file);
  if (error) throw new Error(error);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = extensionOf(file);
  try {
    if (extension === 'pdf') return checkedText(await pdfText(bytes));
    if (PACKAGED.has(extension)) return checkedText(await packagedText(bytes, extension));
    if (extension === 'rtf') return checkedText(rtfText(bytes));
    // Unknown extensions are allowed when the bytes really are text (e.g. Dockerfile, .env).
    if (!TEXT.has(extension) && !file.type.startsWith('text/') && file.type && !['application/octet-stream', 'application/json', 'application/xml'].includes(file.type))
      throw new Error('This file type is not supported. Export it as PDF, DOCX, XLSX, PPTX, or text.');
    const text = decodeText(bytes);
    return checkedText(['html', 'htm'].includes(extension) ? htmlText(text) : text);
  } catch (error) {
    throw new Error(`${file.name}: ${(error as Error).message || 'Unable to read this document. It may be damaged or encrypted.'}`);
  }
}
