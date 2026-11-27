// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // Sem isso, o glob padrão do Playwright também pega os *.test.ts do vitest
  // (tests/unit, tests/integration) e tenta rodá-los como se fossem specs
  // dele — dá erro de ESM/CJS porque não é o runtime certo pra esses arquivos.
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx serve . -l 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  projects: [
    {
      name: 'iphone',
      use: { ...devices['iPhone 13'] },
    },
  ],
});
