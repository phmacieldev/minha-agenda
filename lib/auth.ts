import jwt from 'jsonwebtoken';
import type { VercelRequest } from '@vercel/node';

export interface AuthPayload {
  userId: string;
  email: string;
}

// Senha inicial de toda conta criada pela admin (ver api/auth/signup.ts) —
// compartilhada aqui pra api/auth/me.ts (admin-reset-password) usar o mesmo
// valor sem duplicar a string.
export const DEFAULT_PASSWORD = 'mudar@123';

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET não configurada');
  return s;
}

// 30 dias: equilíbrio entre não pedir login toda hora e limitar a janela de
// uso de um token vazado (não existe revogação — trocar a senha não invalida
// tokens já emitidos, só impede logar de novo com a senha antiga).
export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: '30d' });
}

export class UnauthorizedError extends Error {}

export function getAuth(req: VercelRequest): AuthPayload {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Token ausente');
  try {
    return jwt.verify(header.slice(7), secret()) as AuthPayload;
  } catch {
    throw new UnauthorizedError('Token inválido');
  }
}
