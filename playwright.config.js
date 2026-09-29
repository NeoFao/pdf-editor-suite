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
      // `node server.js` sirve los ficheros del disco en vivo (sin build, sin
      // caché en memoria de una versión anterior): reutilizar un proceso ya
      // arrancado nunca sirve código viejo, así que reusar aquí es seguro.
      command: 'node server.js',
      port: 3100,
      env: { PORT: '3100' },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000
    },
    {
      // Construye la app nueva y la sirve estática (dist/) para los tests del
      // proyecto `next`. reuseExistingServer es SIEMPRE false aquí, incluso en
      // local: a diferencia de server.js, este comando sirve un `dist/`
      // congelado en el momento del build. Si queda vivo un `vite preview`
      // de una sesión anterior en :4173, reutilizarlo se saltaría por
      // completo el `npm run build:next` y los tests de tests/e2e/next/
      // correrían contra código que ya no existe — E-033, npm run verify
      // dando un resultado falso sobre `dist` rancio (visto en el PR #52).
      // Fallar alto con "puerto ya en uso" es preferible: ver
      // scripts/liberar-puertos.mjs (`npm run e2e:liberar`) y docs/TESTING.md.
      command: 'npm run build:next && npm run preview:next',
      port: 4173,
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
