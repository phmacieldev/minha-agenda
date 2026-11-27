import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool } from './db';
import { logEvent } from './adminLog';

type Handler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>;

// Envolve um handler só pra registrar erros não tratados no log do painel
// admin — a resposta de erro em si continua igual (relança o erro depois de
// logar), então isso não muda nenhum comportamento existente.
export function withErrorLog(handler: Handler): Handler {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logEvent(getPool(), { level: 'error', event: 'unhandled_error', message: `${req.method} ${req.url}: ${message}` });
      throw err;
    }
  };
}
