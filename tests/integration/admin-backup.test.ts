import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, login, uniqueEmail } from './helpers';
import { clearLoginRateLimit } from './setup';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'phmaciel@dev.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || '123456';

describe('backup manual e downloads (admin)', () => {
  let adminToken: string;
  let clientToken: string;
  let clientId: string;
  const clientEmail = uniqueEmail('vitest-backup');

  beforeAll(async () => {
    await clearLoginRateLimit();
    adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await api('/auth/signup', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ email: clientEmail, name: 'Vitest Backup', accessType: 'unlimited' }),
    });
    clientId = created.body.id;
    clientToken = await login(clientEmail, 'mudar@123');
  });

  afterAll(async () => {
    if (clientId) await api(`/auth/me?action=admin-delete&userId=${clientId}`, { method: 'DELETE', token: adminToken });
  });

  it('cliente comum não consegue disparar o backup', async () => {
    const r = await api('/cron/backup', { method: 'POST', token: clientToken });
    expect(r.status).toBe(401);
  });

  it('chamada sem nenhuma autenticação é recusada', async () => {
    const r = await api('/cron/backup', { method: 'POST' });
    expect(r.status).toBe(401);
  });

  it('admin dispara um backup manual com sucesso', async () => {
    const r = await api<{ ok: boolean; counts: Record<string, number> }>('/cron/backup', { method: 'POST', token: adminToken });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.counts.users).toBe('number');
  });

  it('admin lista os backups guardados, mais recente primeiro', async () => {
    const r = await api<Array<{ id: string; createdAt: string; sizeBytes: number }>>('/cron/backup?action=list', { token: adminToken });
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body[0].sizeBytes).toBeGreaterThan(0);
    const dates = r.body.map((b) => new Date(b.createdAt).getTime());
    expect([...dates]).toEqual([...dates].sort((a, b) => b - a));
  });

  it('cliente comum não consegue listar nem baixar backups', async () => {
    expect((await api('/cron/backup?action=list', { token: clientToken })).status).toBe(401);
  });

  it('admin baixa o conteúdo de um backup e os dados batem com o backup mais recente', async () => {
    const list = await api<Array<{ id: string }>>('/cron/backup?action=list', { token: adminToken });
    const latestId = list.body[0].id;
    const download = await api('/cron/backup?action=download&id=' + latestId, { token: adminToken });
    expect(download.status).toBe(200);
    expect(Array.isArray(download.body.users)).toBe(true);
    // a cliente recém-criada neste teste deve aparecer no dump de `users`
    expect(download.body.users.some((u: any) => u.id === clientId)).toBe(true);
  });

  it('baixar um id de backup inexistente dá 404', async () => {
    const r = await api('/cron/backup?action=download&id=00000000-0000-0000-0000-000000000000', { token: adminToken });
    expect(r.status).toBe(404);
  });

  it('admin-logs pagina o log de eventos e exclui feedback da contagem geral', async () => {
    const page0 = await api('/auth/me?action=admin-logs&logsLimit=1&logsOffset=0', { token: adminToken });
    expect(page0.status).toBe(200);
    expect(page0.body.logs.length).toBe(1);
    expect(page0.body.logsTotal).toBeGreaterThan(0);
    expect(page0.body.logs.every((l: any) => l.event !== 'feedback')).toBe(true);
  });
});
