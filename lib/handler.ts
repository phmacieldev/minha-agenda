import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth, UnauthorizedError, type AuthPayload } from './auth';
import { getPool } from './db';
import { logEvent } from './adminLog';

export class NotFoundError extends Error {}
export class BadRequestError extends Error {}

type AuthedHandler = (
  req: VercelRequest,
  res: VercelResponse,
  auth: AuthPayload
) => Promise<unknown> | unknown;

/** Envolve um handler exigindo um token válido e traduzindo erros conhecidos em status HTTP. */
export function withAuth(handler: AuthedHandler) {
  return async (req: VercelRequest, res: VercelResponse) => {
    let auth: AuthPayload | undefined;
    try {
      auth = getAuth(req);
      await handler(req, res, auth);
    } catch (err) {
      if (err instanceof UnauthorizedError) return res.status(401).json({ error: 'unauthorized' });
      if (err instanceof NotFoundError) return res.status(404).json({ error: 'not_found' });
      if (err instanceof BadRequestError) return res.status(400).json({ error: 'bad_request', message: err.message });
      console.error(err);
      logEvent(getPool(), {
        level: 'error',
        event: 'unhandled_error',
        userId: auth?.userId,
        email: auth?.email,
        message: `${req.method} ${req.url}: ${err instanceof Error ? err.message : String(err)}`,
      });
      res.status(500).json({ error: 'internal_error' });
    }
  };
}
