import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { logEvent } from '../../lib/adminLog';

function fakePool(query: ReturnType<typeof vi.fn>): Pool {
  return { query } as unknown as Pool;
}

describe('logEvent', () => {
  it('inserts the event with the given fields, defaulting level to info', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await logEvent(fakePool(query), { event: 'login_success', userId: 'u1', email: 'a@b.com', message: 'ok' });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('insert into admin_logs');
    expect(params).toEqual(['info', 'login_success', 'u1', 'a@b.com', 'ok']);
  });

  it('defaults optional fields to null instead of undefined', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await logEvent(fakePool(query), { event: 'cron_backup_ok' });
    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['info', 'cron_backup_ok', null, null, null]);
  });

  it('never throws even if the insert fails — logging must not break the caller', async () => {
    const query = vi.fn().mockRejectedValue(new Error('db down'));
    await expect(logEvent(fakePool(query), { event: 'unhandled_error', message: 'boom' })).resolves.toBeUndefined();
  });

  it('respects an explicit level', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await logEvent(fakePool(query), { level: 'error', event: 'cron_backup_failed', message: 'x' });
    const [, params] = query.mock.calls[0];
    expect(params[0]).toBe('error');
  });
});
