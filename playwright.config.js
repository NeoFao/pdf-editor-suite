import { defineConfig, devices } from '@playwright/test';

/**
 * Chromium REAL, nunca jsdom.
 *
 * Casi todos los defectos que esta suite fija son de maquetación, geometría de
 * canvas o composición del PDF exportado: dependen de que el motor calcule
 * layout y pinte de verdad. Un DOM simulado los deja pasar todos. Ver
 * docs/TESTING.md § "Por qué E2E y no unit".
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Un fallo de estos es una regresión de producto: nunca se reintenta para
  // "ver si pasa". Se reintenta una vez en CI solo por flake de arranque.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [
    {
      name: 'escritorio',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      // responsive.spec.js es del proyecto `movil`; la app nueva, del proyecto `next`.
      testIgnore: [/responsive\.spec\.js/, /e2e[\\/]next[\\/]/]
    },
    { name: 'movil', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.js/ },
    // App nueva (cimientos): servida por `vite preview` en :4173.
    {
      name: 'next',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: 'http://127.0.0.1:4173' },
      testMatch: /e2e[\\/]next[\\/].*\.spec\.ts/
    }
  ],
  webServer: [
    {
      command: 'node server.js',
      port: 3100,
      env: { PORT: '3100' },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000
    },
    {
      // Construye la app nueva y la sirve estática para los tests del proyecto `next`.
      command: 'npm run build:next && npm run preview:next',
      port: 4173,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    }
  ]
});
