// Servidor local que roda a API sem depender da CLI/login da Vercel.
// Reaproveita os mesmos handlers de api/**/*.ts (cada um exporta um default
// `handler(req, res)` no formato @vercel/node) e serve o index.html estático
// por cima — mesma coisa que o `vercel dev` faz, só sem precisar de conta.
// Em produção continua tudo via Vercel normalmente (deploy pelo GitHub).
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { existsSync, readFileSync, statSync } from 'fs';
import { extname, join, resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const API_DIR = join(ROOT, 'api');
const PORT = Number(process.env.PORT) || 3000;

loadEnvFile('.env');
loadEnvFile('.env.local');

function loadEnvFile(name: string): void {
  const path = join(ROOT, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Arquivos estáticos servidos na raiz — lista fechada (não serve o projeto
// inteiro, só o que o app de fato expõe ao navegador).
const STATIC_FILES = new Set(['index.html', 'sw.js', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png']);
const STATIC_DIR_PREFIXES = ['icons/'];

function findHandlerFile(apiPath: string): string | null {
  const direct = join(API_DIR, `${apiPath}.ts`);
  if (existsSync(direct)) return direct;
  const indexed = join(API_DIR, apiPath, 'index.ts');
  if (existsSync(indexed)) return indexed;
  return null;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function augmentResponse(res: ServerResponse): ServerResponse & { status: (code: number) => any; json: (data: unknown) => void; send: (data: unknown) => void } {
  const r = res as any;
  r.status = (code: number) => {
    res.statusCode = code;
    return r;
  };
  r.json = (data: unknown) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
  };
  r.send = (data: unknown) => {
    if (typeof data === 'string' && !res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(data as any);
  };
  return r;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string, query: Record<string, string>): Promise<void> {
  const apiPath = pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  const handlerFile = findHandlerFile(apiPath);
  if (!handlerFile) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const rawBody = await readBody(req);
  const contentType = req.headers['content-type'] || '';
  let body: unknown = undefined;
  if (rawBody.length && contentType.includes('json')) {
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      body = undefined;
    }
  }

  (req as any).query = query;
  (req as any).body = body;
  const vercelRes = augmentResponse(res);

  // Recarrega o módulo a cada chamada: edita o arquivo e já reflete sem
  // precisar reiniciar o servidor (nada de cache do `require`).
  delete require.cache[handlerFile];
  const mod = require(handlerFile);
  const handler = mod.default || mod;
  await handler(req as any, vercelRes as any);
}

function serveStatic(res: ServerResponse, pathname: string): void {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const allowed = STATIC_FILES.has(file) || STATIC_DIR_PREFIXES.some((p) => file.startsWith(p));
  if (!allowed || file.includes('..')) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  const fullPath = join(ROOT, file);
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.setHeader('Content-Type', MIME[extname(fullPath)] || 'application/octet-stream');
  res.end(readFileSync(fullPath));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url.pathname, query);
      return;
    }
    serveStatic(res, url.pathname);
  } catch (err) {
    console.error('[local-server] erro não tratado', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'internal_error' }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`API local em http://localhost:${PORT}`);
});
