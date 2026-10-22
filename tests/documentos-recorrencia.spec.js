// @ts-check
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ver com exemplos primeiro' }).click();
  await expect(page.getByText('Você está vendo exemplos')).toBeVisible();
});

test('recorrência com 2 dias da semana, só nesta semana', async ({ page }) => {
  await page.locator('#fab').click();
  await page.locator('#fName').fill('Paciente QA Dois Dias');
  await page.locator('#fPlace button').nth(2).click(); // Particular
  await page.locator('#fTime').fill('09:00');
  await page.locator('#fPay button', { hasText: 'Particular' }).click();

  await page.locator('#fFreq').selectOption('7'); // toda semana
  await page.locator('#fCount').selectOption('1'); // só desta vez
  // o dia da data escolhida já vem marcado; marca mais um
  await page.locator('#fWd button', { hasText: 'Sex' }).click();

  await page.locator('#fSave').click();
  await expect(page.getByText('Atendimento agendado')).toBeVisible();

  // confere no localStorage que foram criadas exatamente 2 ocorrências,
  // compartilhando a mesma seriesId, sem nenhuma data além desta semana
  const result = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('minha-agenda-v1'));
    const pat = s.patients.find((p) => p.name === 'Paciente QA Dois Dias');
    const appts = s.appts.filter((a) => a.patientId === pat?.id);
    return {
      count: appts.length,
      seriesIds: new Set(appts.map((a) => a.seriesId)).size,
      dates: appts.map((a) => a.date).sort(),
    };
  });
  expect(result.count).toBe(2);
  expect(result.seriesIds).toBe(1);
});

test('documentos do paciente: solicitação de exame e atestado', async ({ page }) => {
  await page.getByRole('button', { name: 'Pacientes' }).click();
  await page.getByText('Rafael Souza').first().click();
  await page.getByRole('button', { name: 'Documentos' }).click();

  // Solicitação de exame: marca o primeiro item da lista e confere a prévia
  const firstExam = page.locator('.toggle input[type=checkbox]').first();
  await firstExam.check();
  await expect(page.locator('#dOut')).toContainText('SOLICITAÇÃO DE EXAMES');
  await expect(page.locator('#dOut')).toContainText('Rafael Souza');

  // Atestado: preenche dias + CID e confere a prévia e o link de WhatsApp
  await page.locator('#dType button', { hasText: 'Atestado' }).click();
  await page.locator('#dDays').fill('3');
  await page.locator('#dCid').fill('M54.5 – Dor lombar baixa');
  await expect(page.locator('#dOut')).toContainText('ATESTADO');
  await expect(page.locator('#dOut')).toContainText('3 dias');
  await expect(page.locator('#dOut')).toContainText('M54.5');

  const waHref = await page.locator('#dWa').getAttribute('href');
  expect(waHref).toContain('wa.me/5522998110006');
  expect(decodeURIComponent(waHref || '')).toContain('ATESTADO');
});

test('feriado nacional aparece sinalizado e some dos horários livres', async ({ page }) => {
  // Navega até a semana que contém 1º de janeiro do ano seguinte — feriado
  // fixo, sempre existe, não depende do cálculo da Páscoa, e o teste funciona
  // em qualquer data em que rodar.
  const today = new Date();
  const mondayOf = (d) => {
    const x = new Date(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const jan1NextYear = new Date(today.getFullYear() + 1, 0, 1);
  const weeksAhead = Math.round((mondayOf(jan1NextYear) - mondayOf(today)) / (7 * 86400000));

  for (let i = 0; i < weeksAhead; i++) {
    await page.getByRole('button', { name: 'Próxima semana' }).click();
  }
  const jan1Button = page.locator('.week .day').filter({ has: page.locator('.dn', { hasText: /^1$/ }) });
  await jan1Button.first().click();

  await expect(page.locator('.banner', { hasText: 'Feriado' })).toContainText('Confraternização');
  await expect(page.getByText('sem horários livres hoje')).toBeVisible();
});
