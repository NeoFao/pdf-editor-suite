import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

test('pluma: dibujar a mano alzada llega al PDF descargado', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await abrirPestana(page, 'comentar');
  await page.locator('#btn-pen').click(); // activa pluma
  const pagina = page.locator('.page').first();
  const b = (await pagina.boundingBox())!;
  await page.mouse.move(b.x + 60, b.y + 120);
  await page.mouse.down();
  await page.mouse.move(b.x + 180, b.y + 200, { steps: 12 });
  await page.mouse.move(b.x + 300, b.y + 130, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('#status')).toHaveText('Trazo dibujado.');

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'dibujo.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const { data } = eng.renderPage(doc, 0, 1);
  let rojo = false;
  for (let i = 0; i < data.length; i += 4) { if (data[i]! > 170 && data[i+1]! < 100 && data[i+2]! < 100) { rojo = true; break; } }
  expect(rojo).toBe(true);
  eng.close(doc);
});
