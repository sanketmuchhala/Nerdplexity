import express, { Router, type Request, type RequestHandler, type Response } from 'express';
import type { z } from 'zod';
import type { AccountInfo, FinishResult } from '@app/types';
import type { Database } from '../db/client.js';
import { LOCAL_USER_ID } from '../db/client.js';
import * as threads from '../store/conversations.js';
import * as store from '../store/records.js';
import { exportData, importData, storeStatus } from '../store/transfer.js';
import * as validate from '../store/validate.js';

// The user's saved data. Every route runs after requireUser, and every store call is given
// req.userId, so one user can never read or change another's records.

type Handler = (req: Request, res: Response) => Promise<void>;
const handle = (fn: Handler): RequestHandler => (req, res, next) => { fn(req, res).catch(next); };

/** The validated body, or undefined after answering 400. */
function body<S extends z.ZodType>(schema: S, req: Request, res: Response): z.infer<S> | undefined {
  const parsed = schema.safeParse(req.body);
  if (parsed.success) return parsed.data;
  res.status(400).json({ error: validate.describe(parsed.error) });
  return undefined;
}

/** The record ID in the path must match the body's, so a record cannot be saved under another ID. */
function sameId(req: Request, res: Response, id: string) {
  if (req.params.id === id) return true;
  res.status(400).json({ error: 'The record ID does not match the address.' });
  return false;
}

const notFound = (res: Response, what: string) => { res.status(404).json({ error: `${what} was not found.` }); };
const uid = (req: Request) => req.userId!;

/** Paths this router answers. Other /v1 paths pass through untouched, to the API's 404. */
const DATA_PATHS = ['/account', '/store', '/conversations', '/documents', '/run-records', '/connections', '/presets', '/comparisons', '/settings'];

export function dataRouter(db: Database, user: RequestHandler): Router {
  const router = Router();
  // A 20 MB PDF uses about 27 MB as base64, alongside extracted text.
  router.use(DATA_PATHS, user, express.json({ limit: '50mb' }));

  router.get('/account', (req, res) => {
    const account: AccountInfo = { id: uid(req), email: req.userEmail ?? '', name: req.userName ?? '', local: uid(req) === LOCAL_USER_ID || uid(req).startsWith('test-') };
    res.json(account);
  });

  router.get('/store/status', handle(async (req, res) => { res.json(await storeStatus(db, uid(req))); }));
  router.get('/store/export', handle(async (req, res) => { res.json(await exportData(db, uid(req))); }));

  // Conversations

  router.get('/conversations', handle(async (req, res) => { res.json(await threads.listConversations(db, uid(req))); }));

  router.post('/conversations', handle(async (req, res) => {
    const input = body(validate.conversation, req, res);
    if (!input) return;
    if (!await threads.createConversation(db, uid(req), input)) { res.status(409).json({ error: 'A thread with this ID already exists.' }); return; }
    res.status(201).json(await threads.getConversation(db, uid(req), input.id));
  }));

  router.get('/conversations/:id', handle(async (req, res) => {
    const found = await threads.getConversation(db, uid(req), req.params.id);
    if (found) res.json(found); else notFound(res, 'This thread');
  }));

  router.get('/conversations/:id/export', handle(async (req, res) => {
    const found = await threads.getConversation(db, uid(req), req.params.id, true);
    if (found) res.json(found); else notFound(res, 'This thread');
  }));

  router.get('/conversations/:id/attachments/:attachmentId/pdf', handle(async (req, res) => {
    const pdfBase64 = await threads.getPdfSource(db, uid(req), req.params.id, req.params.attachmentId);
    res.set('Cache-Control', 'private, no-store');
    if (pdfBase64) res.json({ pdfBase64 }); else notFound(res, 'The original PDF');
  }));

  router.put('/conversations/:id/attachments/:attachmentId/pdf', handle(async (req, res) => {
    const source = body(validate.pdfSource, req, res);
    if (!source) return;
    if (await threads.restorePdfSource(db, uid(req), req.params.id, req.params.attachmentId, source.pdfBase64)) res.status(204).end();
    else notFound(res, 'This attachment');
  }));

  router.patch('/conversations/:id', handle(async (req, res) => {
    const patch = body(validate.conversationPatch, req, res);
    if (!patch) return;
    if (await threads.updateConversation(db, uid(req), req.params.id, patch)) res.status(204).end(); else notFound(res, 'This thread');
  }));

  router.delete('/conversations/:id', handle(async (req, res) => {
    if (await threads.deleteConversation(db, uid(req), req.params.id)) res.status(204).end(); else notFound(res, 'This thread');
  }));

  router.post('/conversations/:id/messages', handle(async (req, res) => {
    const input = body(validate.appendMessage, req, res);
    if (!input) return;
    if (await threads.appendMessage(db, uid(req), req.params.id, input.message, { title: input.title, updatedAt: input.updatedAt })) res.status(204).end();
    else notFound(res, 'This thread');
  }));

  router.patch('/conversations/:id/messages/:messageId', handle(async (req, res) => {
    const input = body(validate.messagePatch, req, res);
    if (!input) return;
    if (await threads.setMessageFeedback(db, uid(req), req.params.id, req.params.messageId, input.feedback)) res.status(204).end();
    else notFound(res, 'This message');
  }));

  router.post('/conversations/:id/fork', handle(async (req, res) => {
    const input = body(validate.fork, req, res);
    if (!input) return;
    const result = await threads.forkConversation(db, uid(req), req.params.id, input);
    if (result === 'missing-source') notFound(res, 'This thread');
    else if (result === 'missing-message') notFound(res, 'The source message');
    else if (result === 'exists') res.status(409).json({ error: 'A thread with this ID already exists.' });
    else res.status(201).json(result);
  }));

  router.post('/conversations/:id/attachments', handle(async (req, res) => {
    const file = body(validate.attachment, req, res);
    if (!file) return;
    if (await threads.addAttachment(db, uid(req), req.params.id, file)) res.status(204).end(); else notFound(res, 'This thread');
  }));

  router.delete('/conversations/:id/attachments/:attachmentId', handle(async (req, res) => {
    if (await threads.removeAttachment(db, uid(req), req.params.id, req.params.attachmentId)) res.status(204).end(); else notFound(res, 'This attachment');
  }));

  // Documents

  router.get('/documents', handle(async (req, res) => { res.json(await store.listDocuments(db, uid(req))); }));
  router.put('/documents/:id', handle(async (req, res) => {
    const doc = body(validate.document, req, res);
    if (!doc || !sameId(req, res, doc.id)) return;
    await store.putDocument(db, uid(req), doc);
    res.status(204).end();
  }));
  router.delete('/documents/:id', handle(async (req, res) => {
    if (await store.deleteDocument(db, uid(req), req.params.id)) res.status(204).end(); else notFound(res, 'This document');
  }));

  // Run history (the run engine itself is /v1/runs)

  router.get('/run-records', handle(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status.slice(0, 40) : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    res.json(await store.listRuns(db, uid(req), { status, limit }));
  }));
  router.put('/run-records/:id', handle(async (req, res) => {
    const record = body(validate.runRecord, req, res);
    if (!record || !sameId(req, res, record.id)) return;
    await store.putRun(db, uid(req), record);
    res.status(204).end();
  }));
  router.patch('/run-records/:id', handle(async (req, res) => {
    const patch = body(validate.runPatch, req, res);
    if (!patch) return;
    if (await store.patchRun(db, uid(req), req.params.id, patch)) res.status(204).end(); else notFound(res, 'This run');
  }));
  router.post('/run-records/:id/finish', handle(async (req, res) => {
    const record = body(validate.runRecord, req, res);
    if (!record || !sameId(req, res, record.id)) return;
    const result: FinishResult = { claimed: await store.finishRun(db, uid(req), record) };
    res.json(result);
  }));

  // Connections (never with keys), presets, comparisons

  router.get('/connections', handle(async (req, res) => { res.json(await store.listConnections(db, uid(req))); }));
  router.put('/connections/:id', handle(async (req, res) => {
    const record = body(validate.connection, req, res);
    if (!record || !sameId(req, res, record.id)) return;
    await store.putConnection(db, uid(req), record);
    res.status(204).end();
  }));
  router.patch('/connections/:id', handle(async (req, res) => {
    const patch = body(validate.settingsValue, req, res);
    if (!patch) return;
    if (await store.patchConnection(db, uid(req), req.params.id, patch)) res.status(204).end(); else notFound(res, 'This connection');
  }));
  router.delete('/connections/:id', handle(async (req, res) => {
    if (await store.deleteConnection(db, uid(req), req.params.id)) res.status(204).end(); else notFound(res, 'This connection');
  }));

  router.get('/presets', handle(async (req, res) => { res.json(await store.listPresets(db, uid(req))); }));
  router.put('/presets/:id', handle(async (req, res) => {
    const record = body(validate.preset, req, res);
    if (!record || !sameId(req, res, record.id)) return;
    await store.putPreset(db, uid(req), record);
    res.status(204).end();
  }));
  router.delete('/presets/:id', handle(async (req, res) => {
    if (await store.deletePreset(db, uid(req), req.params.id)) res.status(204).end(); else notFound(res, 'This preset');
  }));

  router.get('/comparisons', handle(async (req, res) => { res.json(await store.listComparisons(db, uid(req))); }));
  router.put('/comparisons/:id', handle(async (req, res) => {
    const record = body(validate.comparison, req, res);
    if (!record || !sameId(req, res, record.id)) return;
    await store.putComparison(db, uid(req), record);
    res.status(204).end();
  }));
  router.delete('/comparisons/:id', handle(async (req, res) => {
    if (await store.deleteComparison(db, uid(req), req.params.id)) res.status(204).end(); else notFound(res, 'This comparison');
  }));

  // Settings (API keys are removed before saving)

  router.get('/settings', handle(async (req, res) => { res.json(await store.getSettings(db, uid(req))); }));
  router.patch('/settings', handle(async (req, res) => {
    const patch = body(validate.settingsValue, req, res);
    if (!patch) return;
    const saved = await store.patchSettings(db, uid(req), patch);
    if (patch.costPolicy === 'free-only') await threads.clearChargePermissions(db, uid(req));
    res.json(saved);
  }));

  return router;
}

/** Bulk import of a browser's saved data. Mounted with its own, larger body limit. */
export function importHandler(db: Database): RequestHandler {
  return handle(async (req, res) => {
    const data = req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) { res.status(400).json({ error: 'The import must be a JSON object.' }); return; }
    for (const kind of ['conversations', 'documents', 'runs', 'connections', 'presets', 'comparisons'] as const) {
      if (data[kind] !== undefined && !Array.isArray(data[kind])) { res.status(400).json({ error: `${kind} must be a list.` }); return; }
    }
    res.json(await importData(db, uid(req), data));
  });
}
