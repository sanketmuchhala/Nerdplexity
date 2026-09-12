import type { NextFunction, Request, Response } from 'express';

/**
 * Last-resort error handler. Never logs the error object: body-parser errors
 * carry the raw request body, which can contain API keys.
 */
export function errorHandler(error: any, req: Request, res: Response, _next: NextFunction) {
  const status = Number(error?.status ?? error?.statusCode);
  const clientError = Number.isInteger(status) && status >= 400 && status < 500;
  console.error(`[ERROR] ${req.method} ${req.path}: ${String(error?.type ?? error?.name ?? 'Error').slice(0, 60)} (${clientError ? status : 500})`);
  if (res.headersSent) return;
  if (clientError) {
    res.status(status).json({ error: error?.type === 'entity.parse.failed' ? 'The request body is not valid JSON.' : error?.type === 'entity.too.large' ? 'The request is too large.' : 'Invalid request.' });
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
}
