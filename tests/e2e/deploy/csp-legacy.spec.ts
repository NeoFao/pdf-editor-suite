import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instalarSondaCSP } from './_csp';

/**
 * `/legacy/` (app vieja, pdf.js) bajo la CSP real de `vercel.json`.
 *
 * E-027 (docs/ERRORES-CONOCIDOS.md): pdf.js ya carga con
 * `isEvalSupported: false` desde ese arreglo, así que abrir un PDF aquí no
 * debería necesitar 'unsafe-eval' en absoluto — lo que este test confirma
 * bajo la CSP servida de verdad (nunca antes probado: `humo.spec.ts` solo
 * comprueba que /legacy/ no tenga recursos locales rotos, no su
 * comportamiento en tiempo de ejecución bajo CSP).
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

test('/legacy/ : abrir un PDF con pdf.js no produce ninguna violación de CSP', async ({ page }) => {
  const sonda = await instalarSondaCSP(page);

  await page.goto('/legacy/');
  await page.locator('#main-file-input').setInputFiles(FIXTURE_NATIVO);

  // El bloque de texto vivo de la app vieja (ver tests/e2e/helpers.js).
  await expect(page.locator('.acrobat-text-block').first()).toBeAttached();

  expect(sonda.mensajesConsola, 'no debe haber mensajes de consola de CSP').toEqual([]);
  expect(await sonda.violaciones(), 'pdf.js (E-027, isEvalSupported: false) no debe violar la CSP').toEqual([]);
});
