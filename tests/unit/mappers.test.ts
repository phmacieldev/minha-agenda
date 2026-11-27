import { describe, it, expect } from 'vitest';
import {
  placeToJson,
  patientToJson,
  insurerToJson,
  exceptionToJson,
  recordToJson,
  apptToJson,
  userToMe,
  adminUserToJson,
} from '../../lib/mappers';

describe('mappers', () => {
  it('placeToJson converts snake_case row to camelCase and numeric price', () => {
    const row = { id: '1', name: 'Clínica X', color: 'rosa', kind: 'clinica', address: 'Rua A', price: '120.50', duration: 50, hours: {}, info: 'info', msg: null, letterhead: null };
    expect(placeToJson(row)).toEqual({
      id: '1', name: 'Clínica X', color: 'rosa', kind: 'clinica', address: 'Rua A',
      price: 120.5, duration: 50, hours: {}, info: 'info', msg: null, letterhead: null,
    });
  });

  it('patientToJson maps insurer_id to insurerId', () => {
    const row = { id: '1', name: 'Ana', phone: '', notes: '', pay: 'particular', insurer_id: 'ins-1', birth: null, sex: null, mother: null, father: null, card: null, diag: null };
    expect(patientToJson(row).insurerId).toBe('ins-1');
  });

  it('insurerToJson coerces price to number', () => {
    const row = { id: '1', name: 'Unimed', price: '75.00', prices: {} };
    expect(insurerToJson(row).price).toBe(75);
  });

  it('exceptionToJson maps place_id and all_day', () => {
    const row = { id: '1', date: '2026-01-01', place_id: 'p1', type: 'block', all_day: true, s: null, e: null, note: 'Feriado' };
    expect(exceptionToJson(row)).toMatchObject({ placeId: 'p1', allDay: true });
  });

  it('recordToJson maps patient_id/appt_id', () => {
    const row = { id: '1', patient_id: 'p1', date: '2026-01-01', place_id: null, appt_id: 'a1', text: 'evolução' };
    expect(recordToJson(row)).toMatchObject({ patientId: 'p1', apptId: 'a1' });
  });

  it('apptToJson maps all fields and keeps price numeric', () => {
    const row = { id: '1', patient_id: 'p1', place_id: 'pl1', date: '2026-01-01', time: '09:00', dur: 50, price: '100.00', pay: 'particular', insurer_id: null, ins_name: null, status: 'agendado', paid: false, notes: '', series_id: null };
    const json = apptToJson(row);
    expect(json.price).toBe(100);
    expect(json.patientId).toBe('p1');
    expect(json.placeId).toBe('pl1');
  });

  it('userToMe never leaks password_hash and coerces booleans', () => {
    const row = { id: '1', email: 'a@b.com', name: 'Ana', title: null, reg_number: null, signature: null, email_verified_at: null, role: 'client', access_type: 'monthly', access_until: null, must_change_password: true, password_hash: 'secret-hash' };
    const me = userToMe(row);
    expect(me.emailVerified).toBe(false);
    expect(me.mustChangePassword).toBe(true);
    expect((me as any).password_hash).toBeUndefined();
    expect((me as any).passwordHash).toBeUndefined();
  });

  it('adminUserToJson never leaks password_hash and includes lastSeenAt', () => {
    const row = { id: '1', email: 'a@b.com', name: 'Ana', title: null, role: 'client', access_type: 'monthly', access_until: null, must_change_password: false, created_at: '2026-01-01', last_seen_at: '2026-01-02', password_hash: 'secret-hash' };
    const json = adminUserToJson(row);
    expect(json.lastSeenAt).toBe('2026-01-02');
    expect((json as any).password_hash).toBeUndefined();
  });
});
