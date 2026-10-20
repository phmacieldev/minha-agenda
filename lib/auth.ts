import jwt from 'jsonwebtoken';
import type { VercelRequest } from '@vercel/node';

export interface AuthPayload {
  userId: string;
  email: string;
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET não configurada');
  return s;
}

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
