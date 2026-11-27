import { describe, it, expect, beforeAll } from 'vitest';
import type { VercelRequest } from '@vercel/node';
import { signToken, getAuth, UnauthorizedError, DEFAULT_PASSWORD } from '../../lib/auth';

function reqWith(authHeader?: string): VercelRequest {
  return { headers: { authorization: authHeader } } as unknown as VercelRequest;
}

describe('auth', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
  });

  it('signToken + getAuth round-trips the payload', () => {
    const token = signToken({ userId: 'u1', email: 'a@b.com' });
    const req = reqWith(`Bearer ${token}`);
    const auth = getAuth(req);
    expect(auth.userId).toBe('u1');
    expect(auth.email).toBe('a@b.com');
  });

  it('getAuth throws UnauthorizedError when the header is missing', () => {
    expect(() => getAuth(reqWith(undefined))).toThrow(UnauthorizedError);
  });

  it('getAuth throws UnauthorizedError when the scheme is not Bearer', () => {
    expect(() => getAuth(reqWith('Basic abc'))).toThrow(UnauthorizedError);
  });

  it('getAuth throws UnauthorizedError for a garbage token', () => {
    expect(() => getAuth(reqWith('Bearer not-a-real-jwt'))).toThrow(UnauthorizedError);
  });

  it('getAuth throws UnauthorizedError when the secret rotates', () => {
    const token = signToken({ userId: 'u1', email: 'a@b.com' });
    const savedSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'a-different-secret';
    try {
      expect(() => getAuth(reqWith(`Bearer ${token}`))).toThrow(UnauthorizedError);
    } finally {
      process.env.JWT_SECRET = savedSecret;
    }
  });

  it('DEFAULT_PASSWORD is a non-empty shared constant', () => {
    expect(typeof DEFAULT_PASSWORD).toBe('string');
    expect(DEFAULT_PASSWORD.length).toBeGreaterThan(0);
  });
});
