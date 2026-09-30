import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instalarSondaCSP } from './_csp';

/**
 * OCR real (tesseract.js) bajo la CSP de producción. Reutiliza el mismo
 * fixture y flujo que `tests/e2e/next/ocr.spec.ts` (que ya depende de red
 * real hacia jsDelivr en CI — ver ese fichero), pero aquí corre contra
 * `dist-deploy/` con las cabeceras REALES de `vercel.json`: es la única
 * forma de comprobar que `new Worker(...)`/`importScripts(...)` desde el
 * origen de tesseract.js en jsDelivr no violan `worker-src`/`connect-src`
 * /`script-src` de la CSP real, algo que `vite preview` nunca pudo probar.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

test('/ : OCR reconoce texto bajo la CSP real, sin violaciones (tesseract.js vía jsDelivr)', async ({ page }) => {
  test.setTimeout(180_000);
  const sonda = await instalarSondaCSP(page);

  await page.goto('/');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await page.locator('#btn-ocr').click();
  const status = page.locator('#status');
  await expect(status).toContainText('línea(s) reconocida(s)', { timeout: 170_000 });

  const texto = (await status.textContent()) ?? '';
  expect(parseInt(texto, 10)).toBeGreaterThan(0);

  expect(sonda.mensajesConsola, 'no debe haber mensajes de consola de CSP durante el OCR').toEqual([]);
  expect(await sonda.violaciones(), 'new Worker()/importScripts() de tesseract.js no deben violar la CSP').toEqual([]);
});
