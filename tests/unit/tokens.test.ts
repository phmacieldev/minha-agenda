import { describe, it, expect } from 'vitest';
import { generateToken, hoursFromNow } from '../../lib/tokens';

describe('tokens', () => {
  it('generateToken returns a 64-char hex string (32 random bytes)', () => {
    const t = generateToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generateToken never repeats across calls', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken()));
    expect(tokens.size).toBe(50);
  });

  it('hoursFromNow returns a Date N hours in the future', () => {
    const before = Date.now();
    const d = hoursFromNow(2);
    const after = Date.now();
    const diffMs = d.getTime() - before;
    expect(diffMs).toBeGreaterThanOrEqual(2 * 3600 * 1000 - 50);
    expect(d.getTime()).toBeLessThanOrEqual(after + 2 * 3600 * 1000 + 50);
  });
});
