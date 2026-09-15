import { createRequire } from 'node:module';
import { test, expect, type Page } from './fixtures';

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

function pdf(text: string) {
  const stream = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : '';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(output)); output += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
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
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
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
});
