import { describe, it, expect } from 'vitest';
import type { VercelRequest } from '@vercel/node';
import { clientIp } from '../../lib/rateLimit';

function reqWithForwardedFor(value?: string | string[]): VercelRequest {
  return { headers: { 'x-forwarded-for': value } } as unknown as VercelRequest;
}

describe('clientIp', () => {
  it('returns the first IP when x-forwarded-for has a single value', () => {
    expect(clientIp(reqWithForwardedFor('203.0.113.5'))).toBe('203.0.113.5');
  });

  it('returns only the first IP of a comma-separated chain (client, not proxies)', () => {
    expect(clientIp(reqWithForwardedFor('203.0.113.5, 10.0.0.1, 10.0.0.2'))).toBe('203.0.113.5');
  });

  it('trims whitespace around the IP', () => {
    expect(clientIp(reqWithForwardedFor('  203.0.113.5  , 10.0.0.1'))).toBe('203.0.113.5');
  });

  it('handles an array header value (first entry)', () => {
    expect(clientIp(reqWithForwardedFor(['203.0.113.9', '203.0.113.10']))).toBe('203.0.113.9');
  });

  it('falls back to "unknown" when the header is absent', () => {
    expect(clientIp(reqWithForwardedFor(undefined))).toBe('unknown');
  });
});
