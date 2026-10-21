// Carrega todos os recursos de uma usuária numa leva só — usado tanto por
// GET /api/auth/me?full=1 quanto por POST /api/auth/login?full=1, pra evitar
// que o front precise de várias chamadas separadas (places, patients...)
// logo depois de entrar.
import { getPool } from './db';
import { placeToJson, patientToJson, insurerToJson, apptToJson, exceptionToJson, recordToJson } from './mappers';

export async function loadResources(userId: string) {
  const pool = getPool();
  const [places, patients, insurers, appts, exceptions, records] = await Promise.all([
    pool.query('select * from places where user_id = $1 order by created_at asc', [userId]),
    pool.query('select * from patients where user_id = $1 order by name asc', [userId]),
    pool.query('select * from insurers where user_id = $1 order by name asc', [userId]),
    pool.query('select * from appts where user_id = $1 order by date asc, time asc', [userId]),
    pool.query('select * from exceptions where user_id = $1 order by date asc', [userId]),
    pool.query('select * from records where user_id = $1 order by date desc', [userId]),
  ]);
  return {
    places: places.rows.map(placeToJson),
    patients: patients.rows.map(patientToJson),
    insurers: insurers.rows.map(insurerToJson),
    appts: appts.rows.map(apptToJson),
    exceptions: exceptions.rows.map(exceptionToJson),
    records: records.rows.map(recordToJson),
  };
}
