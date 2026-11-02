import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instalarSondaCSP } from './_csp';

/**
 * Smoke del cutover de despliegue (spec §4): corre contra `dist-deploy/`
 * servido estático por `vite preview` (proyecto `deploy`, PUERTOS_E2E.despliegue) — el MISMO
 * árbol que `scripts/construir-despliegue.mjs` produce y que Vercel publica
 * (`vercel.json`: buildCommand `npm run build:deploy`, outputDirectory
 * `dist-deploy`). No es un test de comportamiento de ninguna de las dos
 * apps (eso ya lo cubren tests/e2e/*.spec.js y tests/e2e/next/*.spec.ts) —
 * es la comprobación de que EL EMPAQUETADO no rompió nada.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

test('/ sirve la app nueva y abre un PDF', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).toBeAttached();

  await page.locator('#file-input').setInputFiles(FIXTURE_NATIVO);
  await expect(page.locator('.page').first()).toBeVisible();
  await expect(page.locator('#page-indicator')).toHaveText(/1 \/ \d+/);
});

test('/ enlaza a la versión anterior en /legacy/', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-shortcuts').click();

  const enlace = page.locator('#link-legacy');
  await expect(enlace).toHaveAttribute('href', '/legacy/');

  await enlace.click();
  await page.waitForURL(/\/legacy\/?$/);
  await expect(page.locator('#welcome-dropzone')).toBeVisible();
});

test('/legacy/ sirve la app vieja completa, sin 404 de recursos locales', async ({ page, baseURL }) => {
  const origenEsperado = new URL(baseURL!).origin;
  const recursosRotos: string[] = [];
  page.on('response', (respuesta) => {
    if (new URL(respuesta.url()).origin !== origenEsperado) return; // ignora CDN externo
    if (respuesta.status() === 404) recursosRotos.push(respuesta.url());
  });

  await page.goto('/legacy/');
  await expect(page.locator('#welcome-dropzone')).toBeVisible();
  // La app vieja carga js/state.js y js/app.js de forma síncrona antes de
  // </body>; para cuando el dropzone es visible ya se resolvieron todas sus
  // peticiones locales.
  expect(recursosRotos).toEqual([]);

  await expect(page.locator('#aviso-version-anterior')).toBeVisible();
  await expect(page.locator('#aviso-version-anterior')).toContainText('versión anterior');
});

// E-128: `/legacy` sin barra final servía el HTML de la app vieja pero sus
// rutas relativas (css/, js/) se resolvían contra `/` -> 404 y app sin CSS/JS.
// Ahora vercel.json redirige (308) `/legacy` -> `/legacy/`.
test('/legacy sin barra acaba en /legacy/, sin 404, sin violaciones de CSP y con la app viva', async ({ page, baseURL }) => {
  const sonda = await instalarSondaCSP(page);
  const origenEsperado = new URL(baseURL!).origin;
  const recursosRotos: string[] = [];
  page.on('response', (respuesta) => {
    if (new URL(respuesta.url()).origin !== origenEsperado) return;
    if (respuesta.status() === 404) recursosRotos.push(respuesta.url());
  });

  await page.goto('/legacy');
  await expect(page).toHaveURL(/\/legacy\/$/);
  await expect(page.locator('#welcome-dropzone')).toBeVisible();
  await expect(page.locator('#aviso-version-anterior')).toBeVisible();

  // CSS aplicado de verdad (con 404 el dropzone salía sin estilos).
  expect(await page.evaluate(() => document.styleSheets.length)).toBeGreaterThan(0);

  // Un control de la app vieja responde: abrir un PDF crea bloques de texto.
  await page.locator('#main-file-input').setInputFiles(FIXTURE_NATIVO);
  await expect(page.locator('.acrobat-text-block').first()).toBeAttached();

  expect(recursosRotos).toEqual([]);
  expect(sonda.mensajesConsola).toEqual([]);
  expect(await sonda.violaciones()).toEqual([]);
});
