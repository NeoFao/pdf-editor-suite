import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instalarSondaCSP } from './_csp';

/**
 * T15 (E-055): el worker de compresión (módulo empaquetado por Vite, mismo origen) bajo la CSP REAL de
 * `vercel.json` (`worker-src 'self' blob:`, `script-src 'self' ...`): crearlo no debe violar nada, y la
 * compresión debe resolverse EN el worker (no por el fallback silencioso al hilo principal).
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ESCANEADO = path.resolve(AQUI, '../../fixtures/generados/escaneado.pdf');

test('/ : comprimir con el worker empaquetado no produce violaciones de CSP y se resuelve en el worker', async ({ page }) => {
  test.setTimeout(180_000);
  const sonda = await instalarSondaCSP(page);

  await page.goto('/?diagnostico=1');
  await page.locator('#file-input').setInputFiles(ESCANEADO);
  await expect(page.locator('#status')).toHaveText('1 página(s)', { timeout: 60_000 });
  await page.locator('#tab-convertir').click();
  await page.locator('#btn-compress').click();
  await page.locator('#compress-dpi').selectOption('150');
  await page.locator('#btn-compress-run').click();
  await expect(page.locator('#status')).toContainText('Comprimido:', { timeout: 120_000 });

  const diag = await page.evaluate(() => (window as unknown as { __diagnostico: { compresionWorker: number; compresionHiloPrincipal: number } }).__diagnostico);
  expect(diag.compresionWorker, 'las dos operaciones pesadas deben haber ido al worker').toBe(2);
  expect(diag.compresionHiloPrincipal).toBe(0);
  expect(sonda.mensajesConsola, 'no debe haber mensajes de consola de CSP').toEqual([]);
  expect(await sonda.violaciones(), 'crear el worker no debe violar la CSP').toEqual([]);
});
