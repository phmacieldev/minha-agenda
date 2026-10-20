// @ts-check
const { test, expect } = require('@playwright/test');

test('fluxo básico: exemplos, agendar com convênio novo, editar horário, relatório semanal', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto('/');

  // Onboarding: usar dados de exemplo
  await page.getByRole('button', { name: 'Ver com exemplos primeiro' }).click();
  await expect(page.getByText('Você está vendo exemplos')).toBeVisible();

  // Agendar atendimento novo, local Particular, convênio novo
  await page.locator('#fab').click();
  await page.locator('#fName').fill('Paciente Teste QA');
  await page.locator('#fPhone').fill('22999990000');
  await page.locator('#fPlace button').nth(2).click(); // Particular

  // Data: próxima segunda-feira, 2 semanas à frente (evita conflito com os dados de exemplo)
  const d = new Date();
  const diasAteSegunda = ((1 + 7 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + diasAteSegunda + 14);
  const pad = (n) => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  await page.locator('#fDate').fill(iso);

  await page.locator('#fPay button', { hasText: 'Convênio' }).click();
  await page.locator('#fIns').selectOption('__new');
  await page.locator('#niName').fill('Convênio Teste QA');
  await page.locator('#niPrice').fill('80');

  const slot = page.locator('#fSlots .slot').first();
  await expect(slot).toBeVisible({ timeout: 5000 });
  await slot.click();

  await page.locator('#fSave').click();
  await expect(page.getByText('Atendimento agendado')).toBeVisible();

  // Editar um horário na aba Horários
  await page.getByRole('button', { name: 'Horários', exact: true }).click();
  await page.locator('.drow').first().click();
  await page.locator('#dSave').click();

  // Relatório semanal
  await page.getByRole('button', { name: 'Relatórios' }).click();
  await page.locator('#rMode button', { hasText: 'Semanal' }).click();
  await expect(page.locator('.stat .v').first()).toBeVisible();

  expect(consoleErrors, `Erros no console:\n${consoleErrors.join('\n')}`).toEqual([]);
});
