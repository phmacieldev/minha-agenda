// Converte linhas do Postgres (snake_case) para o formato que a API expõe (camelCase).

export function placeToJson(row: any) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    kind: row.kind,
    address: row.address,
    price: Number(row.price),
    duration: row.duration,
    hours: row.hours,
    info: row.info,
    msg: row.msg,
  };
}

export function patientToJson(row: any) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    notes: row.notes,
    pay: row.pay,
    insurerId: row.insurer_id,
    birth: row.birth,
    sex: row.sex,
    mother: row.mother,
    father: row.father,
    card: row.card,
    diag: row.diag,
  };
}

export function insurerToJson(row: any) {
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    prices: row.prices,
  };
}

export function exceptionToJson(row: any) {
  return {
    id: row.id,
    date: row.date,
    placeId: row.place_id,
    type: row.type,
    allDay: row.all_day,
    s: row.s,
    e: row.e,
    note: row.note,
  };
}

export function apptToJson(row: any) {
  return {
    id: row.id,
    patientId: row.patient_id,
    placeId: row.place_id,
    date: row.date,
    time: row.time,
    dur: row.dur,
    price: Number(row.price),
    pay: row.pay,
    insurerId: row.insurer_id,
    insName: row.ins_name,
    status: row.status,
    paid: row.paid,
    notes: row.notes,
  };
}
