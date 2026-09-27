import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');
const IMG = path.resolve(AQUI, '../../fixtures/generados/rojo.png');

test('insertar imagen: la imagen aparece en el PDF descargado', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(PDF);
  await expect(page.locator('.run').first()).toBeVisible();

  await page.locator('#btn-insert-image').setInputFiles(IMG);
  await expect(page.locator('#status')).toHaveText('Imagen insertada.');

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'con-imagen.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const { data } = eng.renderPage(doc, 0, 1);
  let rojo = false;
  for (let i = 0; i < data.length; i += 4) { if (data[i]! > 180 && data[i+1]! < 90 && data[i+2]! < 90) { rojo = true; break; } }
  expect(rojo).toBe(true);
  eng.close(doc);
});
