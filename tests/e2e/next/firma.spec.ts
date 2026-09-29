import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

test('firmar: dibujar en el pad e insertar lleva la firma al PDF descargado', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await abrirPestana(page, 'firmar');
  await page.locator('#btn-sign').click();
  const canvas = page.locator('#sig-canvas');
  await expect(canvas).toBeVisible();
  // Dibuja un trazo diagonal en el pad.
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + 40);
  await page.mouse.down();
  await page.mouse.move(b.x + 200, b.y + 110, { steps: 12 });
  await page.mouse.move(b.x + 320, b.y + 60, { steps: 12 });
  await page.mouse.up();
  await page.locator('#sig-confirm').click();
  await expect(page.locator('#status')).toHaveText('Firma insertada.');

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'firmado.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  // En la mitad inferior (donde se coloca la firma) debe haber trazo oscuro.
  const { width, height, data } = eng.renderPage(doc, 0, 1);
  let trazo = false;
  for (let y = Math.floor(height * 0.55); y < height && !trazo; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i]! < 100 && data[i+1]! < 100 && data[i+2]! < 100) { trazo = true; break; }
    }
  }
  expect(trazo).toBe(true);
  eng.close(doc);
});
