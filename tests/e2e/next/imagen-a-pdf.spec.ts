import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const IMG = path.resolve(AQUI, '../../fixtures/generados/rojo.png');

test('abrir imagen como PDF: muestra una página y se puede guardar', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#btn-open-image').setInputFiles(IMG);
  await expect(page.locator('#page-indicator')).toHaveText('1 / 1');
  await expect(page.locator('#thumbs canvas')).toHaveCount(1);

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'de-imagen.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  expect(eng.pageCount(doc)).toBe(1);
  const { data } = eng.renderPage(doc, 0, 1);
  let rojo = false;
  for (let i = 0; i < data.length; i += 4) if (data[i]! > 180 && data[i+1]! < 90 && data[i+2]! < 90) { rojo = true; break; }
  expect(rojo).toBe(true);
  eng.close(doc);
});
