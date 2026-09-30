import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Smoke del cutover de despliegue (spec §4): corre contra `dist-deploy/`
 * servido estático por `vite preview` (proyecto `deploy`, :4174) — el MISMO
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
  const origenEsperado = new URL(baseURL ?? 'http://127.0.0.1:4174').origin;
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

// `/legacy` sin barra final (resolución de índice de directorio vía el
// `rewrite` de vercel.json) NO se prueba aquí: `vite preview` (sirv, modo
// SPA por defecto de Vite) resuelve cualquier ruta sin fichero exacto con
// SU PROPIO fallback a `dist-deploy/index.html` — la app NUEVA, no
// `legacy/index.html` — así que este entorno local no puede reproducir el
// enrutado real de Vercel para ese caso concreto. Se verifica con curl
// contra la URL de preview de Vercel antes de fusionar (ver la descripción
// del PR).
