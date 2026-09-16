import { createRequire } from 'node:module';
import { test, expect, type Page } from './fixtures';

// Full Chromium includes the native PDF viewer; the default headless shell does not.
test.use({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium' });

const { zipSync, strToU8 } = createRequire(new URL('../../frontend/package.json', import.meta.url))('fflate');
const fake = `http://127.0.0.1:${Number(process.env.FAKE_PROVIDER_PORT) || 5299}`;
const zip = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)]))));
const word = zip({ 'word/document.xml': '<w:document xmlns:w="word"><w:body><w:p><w:r><w:t>Project Kestrel launches October 19.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Amira</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>' });
const spreadsheet = zip({
  'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" r:id="sheet1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="sheet1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Kestrel budget</t></si></sst>',
  'xl/styles.xml': '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="10"/></cellXfs></styleSheet>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>42000</v></c></row><row r="2"><c r="C2"><f>C1*2</f><v>84000</v></c></row><row r="3"><c r="C3" s="1"><v>1</v></c><c r="D3" s="2"><v>0.42</v></c></row></sheetData></worksheet>',
});
const presentation = zip({
  'ppt/presentation.xml': '<p:presentation xmlns:p="presentation" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="first"/><p:sldId r:id="second"/></p:sldIdLst></p:presentation>',
  'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="first" Target="slides/slide2.xml"/><Relationship Id="second" Target="slides/slide1.xml"/></Relationships>',
  'ppt/slides/slide2.xml': '<p:sld xmlns:p="presentation" xmlns:a="drawing"><a:p><a:r><a:t>Kestrel milestone: prototype approved.</a:t></a:r></a:p></p:sld>',
  'ppt/slides/slide1.xml': '<p:sld xmlns:p="presentation" xmlns:a="drawing"><a:p><a:r><a:t>Next milestone: customer pilot.</a:t></a:r></a:p></p:sld>',
});
const openDocument = zip({ 'content.xml': '<office:document-content xmlns:office="office" xmlns:text="text"><office:body><text:p>Kestrel risk: supplier delay.</text:p></office:body></office:document-content>' });
const epub = zip({
  'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>',
  'OEBPS/book.opf': '<package><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
  'OEBPS/chapter.xhtml': '<html><body><h1>Kestrel handbook</h1><p>Escalate issues to Amira.</p><script>bad script</script></body></html>',
});

function pdf(text: string | string[], nullGlyph = false) {
  const pages = Array.isArray(text) ? text : [text];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica ${nullGlyph ? `/ToUnicode ${4 + pages.length * 2} 0 R` : ''} >>`];
  pages.forEach((text, i) => {
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  if (nullGlyph) {
    const cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /NullGlyph def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n1 beginbfchar\n<23> <0000>\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
    objects.push(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);
  }
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(output)); output += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(output);
}

async function setup(page: Page) {
  await page.goto('/app/models');
  await page.getByRole('button', { name: 'Add Provider' }).click();
  const form = page.getByRole('form', { name: 'Add connection' });
  await form.getByLabel('Connection type').selectOption('custom');
  await form.getByLabel('Connection name').fill('Document test');
  await form.getByLabel('Server address').fill(`${fake}/v1`);
  await form.getByRole('button', { name: 'Save Connection' }).click();
  await page.getByRole('article').filter({ hasText: 'fast-model' }).getByRole('button', { name: 'Select Model' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test('PDF font mappings with null characters still upload, persist, preview, and reach the model', async ({ page }) => {
  await setup(page);
  const original = pdf('Basis # reference number: 729.', true);
  await page.getByLabel('Attach files').setInputFiles({ name: 'basis.pdf', mimeType: 'application/pdf', buffer: original });
  await expect(page.locator('.np-attachment')).toHaveCount(1);
  await page.reload();
  await page.getByRole('complementary').getByRole('button', { name: 'New chat', exact: true }).click();
  await page.locator('.np-attachment summary').click();
  const viewer = page.getByRole('dialog', { name: 'basis.pdf', exact: true });
  await expect(viewer.getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
  await viewer.getByText('Extracted text used in chat', { exact: true }).click();
  await expect(viewer.locator('pre')).toContainText('reference number: 729');
  expect(await viewer.locator('pre').textContent()).not.toContain('\0');
  await page.keyboard.press('Escape');
  const prompt = `What is the basis reference number? ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.np-provenance')).toHaveCount(1);
  const requests = await (await page.request.get(`${fake}/_log?prompt=${encodeURIComponent(prompt)}`)).json();
  expect(JSON.stringify(requests[0].messages)).toContain('reference number: 729');
  expect(JSON.stringify(requests[0].messages)).not.toContain('\\u0000');
});

test('PDF and Office uploads persist as readable text and reach the model', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Attach files').setInputFiles([
    { name: 'brief.pdf', mimeType: 'application/pdf', buffer: pdf('Kestrel reference number: 729.') },
    { name: 'plan.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: word },
    { name: 'budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: spreadsheet },
    { name: 'slides.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: presentation },
    { name: 'risks.odt', mimeType: 'application/vnd.oasis.opendocument.text', buffer: openDocument },
    { name: 'handbook.epub', mimeType: 'application/epub+zip', buffer: epub },
  ]);
  await expect(page.locator('.np-attachment')).toHaveCount(6, { timeout: 30_000 });
  await page.reload();
  await page.getByRole('complementary').getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.locator('.np-attachment')).toHaveCount(6);
  const doc = page.locator('.np-attachment').filter({ hasText: 'plan.docx' });
  await doc.locator('summary').click();
  await expect(doc).toContainText('Project Kestrel launches October 19.');
  const prompt = `Summarize the Kestrel documents ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.np-provenance')).toHaveCount(1);
  const requests = await (await page.request.get(`${fake}/_log?prompt=${encodeURIComponent(prompt)}`)).json();
  const text = requests[0].messages.map((message: { content: string }) => message.content).join('\n');
  for (const fact of ['[Page 1]', 'reference number: 729', 'Owner\tAmira', '[Sheet: Budget]', 'C1: 42000', 'C2: 84000 [formula: =C1*2]', 'C3: 1900-01-01 [Excel serial: 1]', 'D3: 42%', '[Slide 1]\nKestrel milestone', '[Slide 2]\nNext milestone', 'supplier delay', 'Escalate issues to Amira']) expect(text).toContain(fact);
  expect(text).not.toContain('bad script');
  expect(text).not.toContain('<w:document');
  expect(JSON.stringify(requests)).not.toContain('pdfBase64');
  expect(JSON.stringify(requests)).not.toContain(pdf('Kestrel reference number: 729.').toString('base64'));
});

test('Workspace imports documents through the same reader and saves larger text', async ({ page }) => {
  await page.goto('/app/workspace');
  await page.getByLabel('Import document').setInputFiles({ name: 'plan.docx', mimeType: 'application/octet-stream', buffer: word });
  await expect(page.getByRole('textbox', { name: 'Content', exact: true })).toHaveValue(/Project Kestrel/);
  await page.getByRole('button', { name: 'Save document' }).click();
  await expect(page.locator('.np-document')).toContainText('plan.docx');
  await page.getByLabel('Import document').setInputFiles({ name: 'long.txt', mimeType: 'text/plain', buffer: Buffer.from('Long document paragraph.\n'.repeat(10_000)) });
  await expect(page.getByRole('textbox', { name: 'Content', exact: true })).toHaveValue(/Long document paragraph/);
  await page.getByRole('button', { name: 'Save document' }).click();
  await expect(page.locator('.np-document')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.np-document')).toHaveCount(2);
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`PDF files stay visible and openable during and after a run at ${viewport.width}px`, async ({ page }, testInfo) => {
    await setup(page);
    await page.setViewportSize(viewport);
    await page.getByLabel('Attach files').setInputFiles({ name: 'basis.pdf', mimeType: 'application/pdf', buffer: pdf('Basis reference number: 729.') });
    const card = page.locator('.np-attachments summary').filter({ hasText: 'basis.pdf' });
    await expect(card).toBeInViewport({ ratio: 1 });
    // Hold delivery of the run ID so the running state lasts until the preview is checked.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/v1/runs', async route => {
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    });
    const prompt = 'Review the attached basis PDF.\n' + 'Explain the reference number and summarize the document.\n'.repeat(30);
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(prompt);
    await page.getByRole('button', { name: 'Send message' }).click();
    const viewer = page.getByRole('dialog', { name: 'basis.pdf', exact: true });
    try {
      await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible();
      await expect(card).toBeInViewport({ ratio: 1 });
      await card.click();
      await expect(viewer.getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
      await expect(viewer.getByRole('button', { name: 'Remove from context' })).toBeDisabled();
      await expect(viewer.getByRole('link', { name: 'Download PDF' })).toBeVisible();
      await page.keyboard.press('Escape');
    } finally { release(); }
    await expect(page.locator('.np-provenance')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Stop generation' })).toHaveCount(0);
    await expect(card).toBeInViewport({ ratio: 1 });
    await page.locator('.np-chat-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(card).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('pdf-after-response.png') });
    await card.click();
    await expect(viewer.getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Remove from context' })).toBeEnabled();
    await page.keyboard.press('Escape');
    await page.reload();
    if (viewport.width < 760) await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name: /^Review the attached basis PDF/ }).click();
    await expect(card).toBeInViewport({ ratio: 1 });
    await card.click();
    await expect(viewer.getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
  });
}

test('uploaded PDFs open as rendered pages after reload, with navigation, zoom, and download', async ({ page }, testInfo) => {
  await setup(page);
  const original = pdf(['Kestrel page one.', 'Kestrel page two.']);
  await page.getByLabel('Attach files').setInputFiles({ name: 'preview.pdf', mimeType: 'application/pdf', buffer: original });
  await expect(page.locator('.np-attachment')).toContainText('Open PDF');
  await page.reload();
  await page.getByRole('complementary').getByRole('button', { name: 'New chat', exact: true }).click();
  await page.locator('.np-attachment summary').click();
  const viewer = page.getByRole('dialog', { name: 'preview.pdf', exact: true });
  await expect(viewer.getByRole('img', { name: 'Page 1 of 2' })).toBeVisible();
  await expect(viewer.getByRole('status')).toHaveCount(0);
  // Text glyphs make the rendered page visibly different from an empty white canvas.
  expect(await viewer.locator('canvas').evaluate(canvas => {
    const data = (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 100 && data[i + 3] > 0) ink++;
    return ink;
  })).toBeGreaterThan(20);
  await page.screenshot({ path: testInfo.outputPath('pdf-preview-desktop.png') });
  await viewer.getByRole('button', { name: 'Next page' }).click();
  await expect(viewer.getByRole('img', { name: 'Page 2 of 2' })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await viewer.getByRole('button', { name: 'Zoom in' }).click();
  await expect(viewer).toContainText('125%');
  const nativeViewer = page.waitForEvent('popup');
  await viewer.getByRole('link', { name: 'Open in browser', exact: true }).click();
  const nativePage = await nativeViewer;
  await expect(nativePage).toHaveURL(/^blob:/);
  await nativePage.close();
  const downloading = page.waitForEvent('download');
  await viewer.getByRole('link', { name: 'Download PDF' }).click();
  const download = await downloading;
  const { readFile } = await import('node:fs/promises');
  expect(await readFile((await download.path())!)).toEqual(original);
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(page.locator('.np-attachment summary')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.np-attachment summary').click();
  await expect(viewer.getByRole('img', { name: 'Page 1 of 2' })).toBeVisible();
  const bounds = await viewer.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('pdf-preview-mobile.png') });
  await viewer.getByRole('button', { name: 'Remove from context' }).click();
  await expect(viewer).toHaveCount(0);
  await expect(page.locator('.np-attachment')).toHaveCount(0);
});

test('older PDF attachments can recover the original preview without duplicating their context', async ({ page }) => {
  await setup(page);
  const original = pdf('Original Kestrel report.');
  await page.route('**/v1/conversations/*/attachments', async route => {
    const { pdfBase64: _original, ...body } = route.request().postDataJSON();
    await route.continue({ postData: JSON.stringify(body) });
  });
  await page.getByLabel('Attach files').setInputFiles({ name: 'older.pdf', mimeType: 'application/pdf', buffer: original });
  await expect(page.locator('.np-attachment')).toHaveCount(1);
  await page.reload();
  await page.getByRole('complementary').getByRole('button', { name: 'New chat', exact: true }).click();
  await page.locator('.np-attachment summary').click();
  const viewer = page.getByRole('dialog', { name: 'older.pdf', exact: true });
  await expect(viewer).toContainText('saved only extracted text');
  await viewer.getByLabel('Choose original PDF', { exact: true }).setInputFiles({ name: 'other.pdf', mimeType: 'application/pdf', buffer: pdf('Wrong file') });
  await expect(viewer.getByRole('alert')).toContainText('does not match');
  await viewer.getByLabel('Choose original PDF', { exact: true }).setInputFiles({ name: 'older.pdf', mimeType: 'application/pdf', buffer: original });
  await expect(viewer.getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
  await page.reload();
  await page.getByRole('complementary').getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.locator('.np-attachment')).toHaveCount(1);
  await page.locator('.np-attachment summary').click();
  await expect(viewer.getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
});

test('OpenDocument spreadsheets and slides, HTML, RTF, and code reach the model as text', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Attach files').setInputFiles([
    { name: 'budget.ods', mimeType: 'application/vnd.oasis.opendocument.spreadsheet', buffer: zip({ 'content.xml': '<office:document-content xmlns:office="office" xmlns:table="table" xmlns:text="text"><office:body><table:table table:name="Budget"><table:table-row><table:table-cell table:number-columns-repeated="2"/><table:table-cell office:value="42000"/><table:table-cell office:date-value="2026-10-19"/></table:table-row></table:table></office:body></office:document-content>' }) },
    { name: 'slides.odp', mimeType: 'application/vnd.oasis.opendocument.presentation', buffer: zip({ 'content.xml': '<office:document-content xmlns:office="office" xmlns:draw="draw" xmlns:text="text"><office:body><draw:page><text:p>Kestrel pilot approved.</text:p></draw:page><draw:page><text:p>Release in October.</text:p></draw:page></office:body></office:document-content>' }) },
    { name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<html><body><h1>Kestrel handbook</h1><p>Owner: Amira &amp; team</p><script>hidden script</script><style>hidden style</style></body></html>') },
    { name: 'notes.rtf', mimeType: 'application/rtf', buffer: Buffer.from(String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}Kestrel cost: \'a342\par Ready for review.}`) },
    { name: 'Dockerfile', mimeType: 'application/octet-stream', buffer: Buffer.from('FROM node:22\nRUN npm ci') },
  ]);
  await expect(page.locator('.np-attachment')).toHaveCount(5);
  const prompt = `Summarize all formats ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.np-provenance')).toHaveCount(1);
  const requests = await (await page.request.get(`${fake}/_log?prompt=${encodeURIComponent(prompt)}`)).json();
  const text = requests[0].messages.map((message: { content: string }) => message.content).join('\n');
  for (const fact of ['[Sheet: Budget]', 'column 3: 42000', 'column 4: 2026-10-19', '[Slide 1]\nKestrel pilot approved.', '[Slide 2]\nRelease in October.', 'Owner: Amira & team', 'Kestrel cost: £42\nReady for review.', 'FROM node:22\nRUN npm ci']) expect(text).toContain(fact);
  for (const hidden of ['hidden script', 'hidden style', 'fonttbl', '<office:']) expect(text).not.toContain(hidden);
});

test('unreadable uploads explain the failure and do not block other files', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Attach files').setInputFiles([
    { name: 'scan.pdf', mimeType: 'application/pdf', buffer: pdf('') },
    { name: 'damaged.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('not a zip file') },
    { name: 'valid.txt', mimeType: 'text/plain', buffer: Buffer.from('Still attaches successfully.') },
  ]);
  await expect(page.locator('.np-attachment')).toHaveCount(1);
  await expect(page.getByRole('alert')).toContainText('OCR');
  await expect(page.getByRole('alert')).toContainText('damaged.docx');
  await expect(page.locator('.np-attachment')).toContainText('valid.txt');
});

test('a fact near the end of a large document reaches the model within budget', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Attach files').setInputFiles({ name: 'large.txt', mimeType: 'text/plain', buffer: Buffer.from(`${'Background notes.\n'.repeat(20_000)}\nCobalt launch code: ZEBRA-729.`) });
  await expect(page.locator('.np-attachment')).toHaveCount(1);
  const prompt = `What is the cobalt launch code? ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(prompt);
  await expect(page.getByRole('status').filter({ hasText: 'selected excerpts' })).toBeVisible();
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.np-provenance')).toHaveCount(1);
  const requests = await (await page.request.get(`${fake}/_log?prompt=${encodeURIComponent(prompt)}`)).json();
  expect(JSON.stringify(requests[0].messages)).toContain('ZEBRA-729');
  expect(JSON.stringify(requests[0].messages).length).toBeLessThan(30_000);
  const followup = `Repeat its code and explain what it refers to. ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(followup);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.np-provenance')).toHaveCount(2);
  const followupRequests = await (await page.request.get(`${fake}/_log?prompt=${encodeURIComponent(followup)}`)).json();
  expect(followupRequests[0].messages).toContainEqual({ role: 'user', content: prompt });
  expect(followupRequests[0].messages.some((message: { role: string }) => message.role === 'assistant')).toBe(true);
  expect(JSON.stringify(followupRequests[0].messages)).toContain('ZEBRA-729');
});
