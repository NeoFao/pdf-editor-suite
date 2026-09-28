import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

test('nuevo: #btn-new abre un PDF en blanco de una página A4', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#btn-new').click();

  const pagina = page.locator('.page');
  await expect(pagina).toHaveCount(1);
  await expect(page.locator('#page-indicator')).toHaveText('1 / 1');

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'nuevo.pdf');
  await download.saveAs(destino);

  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  expect(eng.pageCount(doc)).toBe(1);
  const s = eng.pageSize(doc, 0);
  // A4 en puntos PDF: 595 x 842.
  expect(Math.round(s.widthPt)).toBe(595);
  expect(Math.round(s.heightPt)).toBe(842);
  expect(eng.getPageText(doc, 0)).toHaveLength(0);
  eng.close(doc);
});
