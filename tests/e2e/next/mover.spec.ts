import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

test('mover: arrastrar una línea cambia su posición en el PDF descargado', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await expect(run).toBeVisible();

  // Arrastrar por el tirador +40px a la derecha (escala 1 → +40pt en X).
  const handle = run.locator('.run-drag');
  const b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'movido.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const run2 = eng.getPageText(doc, 0).find((r) => r.text.includes('ORIGINAL-TIMES'))!;
  // Original x=40 → tras +40 debe rondar 80; la Y (≈150) apenas cambia.
  expect(run2.boxPt.xPt).toBeGreaterThan(70);
  expect(Math.abs(run2.boxPt.yPt - 150)).toBeLessThan(12);
  eng.close(doc);
});
