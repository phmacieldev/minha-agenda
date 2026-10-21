// Comprime respostas grandes (ex.: GET /auth/me?full=1, com todos os dados
// da usuária) antes de mandar — sem isso, o payload cresce direto proporcional
// ao volume de atendimentos/pacientes, e JSON comprime muito bem (texto
// repetitivo). Respostas pequenas continuam sem compressão (não compensa).
import { gzipSync } from 'zlib';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const MIN_SIZE_TO_COMPRESS = 2048;

export function sendJson(req: VercelRequest, res: VercelResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const acceptsGzip = String(req.headers['accept-encoding'] || '').includes('gzip');
  if (acceptsGzip && body.length > MIN_SIZE_TO_COMPRESS) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.end(gzipSync(body));
    return;
  }
  res.end(body);
}
