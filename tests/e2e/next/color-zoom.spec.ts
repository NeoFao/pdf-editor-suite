import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

test('color: cambiar el color de una línea llega al PDF descargado', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await expect(run).toBeVisible();
  await run.click(); // selecciona (era rojo)
  await page.locator('#btn-color').evaluate((el, v) => {
    (el as HTMLInputElement).value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, '#1030c8'); // azul
  await expect(page.locator('#status')).toHaveText('Color aplicado.');

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'color.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const run2 = eng.getPageText(doc, 0).find((r) => r.text.includes('ORIGINAL-TIMES'))!;
  expect(run2.color[2]).toBeGreaterThan(150); // azul alto
  expect(run2.color[0]).toBeLessThan(80);      // rojo bajo
  eng.close(doc);
});

test('zoom: acercar agranda la página en pantalla', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const pagina = page.locator('.page').first();
  await expect(pagina).toBeVisible();
  const antes = (await pagina.boundingBox())!.width;
  await page.locator('#btn-zoom-in').click();
  await expect.poll(async () => (await pagina.boundingBox())!.width).toBeGreaterThan(antes + 10);
});
