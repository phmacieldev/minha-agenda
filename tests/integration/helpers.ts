// Helpers pros testes de integração: batem na API real (scripts/local-server.ts
// + Postgres do Docker) em vez de mockar camadas — o objetivo aqui é testar o
// comportamento de ponta a ponta de cada endpoint, isolamento entre contas
// incluído.
const BASE = process.env.API_BASE_URL || 'http://localhost:3000/api';

export interface ApiResult<T = any> {
  status: number;
  body: T;
}

export async function api<T = any>(path: string, opts: RequestInit & { token?: string } = {}): Promise<ApiResult<T>> {
  const { token, headers, ...rest } = opts;
  const res = await fetch(BASE + path, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers as Record<string, string> | undefined),
    },
  });
  let body: any = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

export async function login(email: string, password: string): Promise<string> {
  const r = await api<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (r.status !== 200) throw new Error(`login falhou para ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@vitest.local`;
}
