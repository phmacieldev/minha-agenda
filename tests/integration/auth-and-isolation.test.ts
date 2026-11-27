import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, login, uniqueEmail } from './helpers';
import { clearLoginRateLimit } from './setup';

// Conta admin de teste já criada manualmente no banco local (ver sessão de
// setup). Se não existir, os testes abaixo falham na raiz (beforeAll) com
// uma mensagem clara em vez de 50 falhas confusas.
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'phmaciel@dev.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || '123456';
const DEFAULT_CLIENT_PASSWORD = 'mudar@123';

describe('auth e isolamento entre contas (API real)', () => {
  let adminToken: string;
  let userAId: string, userBId: string;
  let tokenA: string, tokenB: string;
  const emailA = uniqueEmail('vitest-a');
  const emailB = uniqueEmail('vitest-b');

  beforeAll(async () => {
    await clearLoginRateLimit();
    adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

    const createA = await api('/auth/signup', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ email: emailA, name: 'Vitest A', accessType: 'unlimited' }),
    });
    expect(createA.status).toBe(201);
    userAId = createA.body.id;

    const createB = await api('/auth/signup', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ email: emailB, name: 'Vitest B', accessType: 'unlimited' }),
    });
    expect(createB.status).toBe(201);
    userBId = createB.body.id;

    tokenA = await login(emailA, DEFAULT_CLIENT_PASSWORD);
    tokenB = await login(emailB, DEFAULT_CLIENT_PASSWORD);
  });

  afterAll(async () => {
    if (userAId) await api(`/auth/me?action=admin-delete&userId=${userAId}`, { method: 'DELETE', token: adminToken });
    if (userBId) await api(`/auth/me?action=admin-delete&userId=${userBId}`, { method: 'DELETE', token: adminToken });
  });

  it('login recusa senha errada com mensagem genérica', async () => {
    const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: emailA, password: 'senha-errada' }) });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('invalid_credentials');
  });

  it('login recusa e-mail inexistente com a mesma mensagem genérica (não revela quem tem conta)', async () => {
    const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: uniqueEmail('nao-existe'), password: 'qualquer' }) });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('invalid_credentials');
  });

  it('conta nova criada pela admin força troca de senha no primeiro acesso', async () => {
    const me = await api('/auth/me', { token: tokenA });
    expect(me.status).toBe(200);
    expect(me.body.mustChangePassword).toBe(true);
  });

  it('signup direto (sem token de admin) é recusado', async () => {
    const r = await api('/auth/signup', { method: 'POST', body: JSON.stringify({ email: uniqueEmail('sem-admin'), name: 'X', accessType: 'unlimited' }) });
    expect(r.status).toBe(401);
  });

  it('cliente comum não consegue acessar ações de admin', async () => {
    const r = await api('/auth/me?action=admin-list', { token: tokenA });
    expect(r.status).toBe(401);
  });

  describe('isolamento de dados entre contas (places/patients/appts)', () => {
    let placeA: string, patientA: string, apptA: string;

    it('usuária A cria um local, paciente e atendimento', async () => {
      const place = await api('/places', { method: 'POST', token: tokenA, body: JSON.stringify({ name: 'Consultório A', color: 'rosa', kind: 'particular', price: 100, duration: 50, hours: {} }) });
      expect(place.status).toBe(201);
      placeA = place.body.id;

      const patient = await api('/patients', { method: 'POST', token: tokenA, body: JSON.stringify({ name: 'Paciente da A', phone: '', pay: 'particular' }) });
      expect(patient.status).toBe(201);
      patientA = patient.body.id;

      const appt = await api('/appts', { method: 'POST', token: tokenA, body: JSON.stringify({ patientId: patientA, placeId: placeA, date: '2026-01-15', time: '09:00', price: 100 }) });
      expect(appt.status).toBe(201);
      apptA = appt.body.id;
    });

    it('usuária B não enxerga os dados da A nas listagens', async () => {
      const places = await api('/places', { token: tokenB });
      expect(places.body.find((p: any) => p.id === placeA)).toBeUndefined();
      const patients = await api('/patients', { token: tokenB });
      expect(patients.body.find((p: any) => p.id === patientA)).toBeUndefined();
      const appts = await api('/appts', { token: tokenB });
      expect(appts.body.find((a: any) => a.id === apptA)).toBeUndefined();
    });

    it('usuária B recebe 404 ao tentar GET direto num recurso da A pelo id', async () => {
      expect((await api(`/places?id=${placeA}`, { token: tokenB })).status).toBe(404);
      expect((await api(`/patients?id=${patientA}`, { token: tokenB })).status).toBe(404);
      expect((await api(`/appts?id=${apptA}`, { token: tokenB })).status).toBe(404);
    });

    it('usuária B não consegue editar nem apagar um recurso da A (404, não 200)', async () => {
      const edit = await api(`/places?id=${placeA}`, { method: 'PUT', token: tokenB, body: JSON.stringify({ name: 'Sequestrado' }) });
      expect(edit.status).toBe(404);
      const del = await api(`/places?id=${placeA}`, { method: 'DELETE', token: tokenB });
      expect(del.status).toBe(404);
    });

    it('usuária B tentando criar um atendimento com o MESMO id de um da A não sobrescreve (upsert cross-tenant bloqueado)', async () => {
      // places/patients da B, já que o appt exige placeId/patientId pertencentes a quem está criando
      const placeB = await api('/places', { method: 'POST', token: tokenB, body: JSON.stringify({ name: 'Consultório B', color: 'azul', kind: 'particular', price: 90, duration: 50, hours: {} }) });
      const patientB = await api('/patients', { method: 'POST', token: tokenB, body: JSON.stringify({ name: 'Paciente da B', phone: '', pay: 'particular' }) });
      const clash = await api('/appts', {
        method: 'POST',
        token: tokenB,
        body: JSON.stringify({ id: apptA, patientId: patientB.body.id, placeId: placeB.body.id, date: '2026-02-01', time: '10:00', price: 50 }),
      });
      // Bloqueado pelo "where appts.user_id = excluded.user_id" do upsert — não é 201 com os dados da B
      expect(clash.status).toBe(400);
      expect(clash.body.error).toBe('bad_request');

      // o atendimento original da A continua intacto
      const stillA = await api(`/appts?id=${apptA}`, { token: tokenA });
      expect(stillA.status).toBe(200);
      expect(stillA.body.price).toBe(100);
    });

    it('usuária A consegue editar e apagar o próprio atendimento normalmente', async () => {
      const edit = await api(`/appts?id=${apptA}`, { method: 'PUT', token: tokenA, body: JSON.stringify({ price: 150 }) });
      expect(edit.status).toBe(200);
      expect(edit.body.price).toBe(150);
      const del = await api(`/appts?id=${apptA}`, { method: 'DELETE', token: tokenA });
      expect(del.status).toBe(204);
    });
  });

  describe('feedback vira notificação pra admin', () => {
    it('POST de feedback autenticado é aceito e aparece nos logs do admin', async () => {
      const marker = `teste-vitest-${Date.now()}`;
      const sent = await api('/auth/me?action=feedback', { method: 'PUT', token: tokenA, body: JSON.stringify({ message: marker }) });
      expect(sent.status).toBe(200);

      const logs = await api('/auth/me?action=admin-logs', { token: adminToken });
      expect(logs.status).toBe(200);
      expect(logs.body.feedbacks.some((f: any) => f.message === marker)).toBe(true);
    });

    it('feedback exige autenticação', async () => {
      const r = await api('/auth/me?action=feedback', { method: 'PUT', body: JSON.stringify({ message: 'anônimo' }) });
      expect(r.status).toBe(401);
    });
  });

  describe('admin-reset-password', () => {
    it('admin reseta a senha da cliente de volta pro padrão', async () => {
      // primeiro a cliente troca a senha, saindo do "mudar@123"
      const changed = await api('/auth/me?action=password', { method: 'PUT', token: tokenA, body: JSON.stringify({ currentPassword: DEFAULT_CLIENT_PASSWORD, newPassword: 'senha-nova-123' }) });
      expect(changed.status).toBe(200);

      // login com a senha antiga agora falha
      const oldLogin = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: emailA, password: DEFAULT_CLIENT_PASSWORD }) });
      expect(oldLogin.status).toBe(401);

      // admin reseta
      const reset = await api('/auth/me?action=admin-reset-password', { method: 'PUT', token: adminToken, body: JSON.stringify({ userId: userAId }) });
      expect(reset.status).toBe(200);
      expect(reset.body.mustChangePassword).toBe(true);

      // login com a senha padrão volta a funcionar
      tokenA = await login(emailA, DEFAULT_CLIENT_PASSWORD);
      expect(tokenA).toBeTruthy();
    });

    it('cliente comum não consegue resetar a senha de ninguém', async () => {
      const r = await api('/auth/me?action=admin-reset-password', { method: 'PUT', token: tokenB, body: JSON.stringify({ userId: userAId }) });
      expect(r.status).toBe(401);
    });
  });

  describe('admin-update edita nome/e-mail da cliente', () => {
    it('admin atualiza nome e e-mail da conta', async () => {
      const newEmail = uniqueEmail('vitest-a-renamed');
      const r = await api('/auth/me?action=admin-update', {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ userId: userAId, name: 'Vitest A Renomeada', email: newEmail, accessType: 'unlimited' }),
      });
      expect(r.status).toBe(200);
      expect(r.body.name).toBe('Vitest A Renomeada');
      expect(r.body.email).toBe(newEmail);
    });
  });
});
