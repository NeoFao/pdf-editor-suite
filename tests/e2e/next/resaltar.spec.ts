import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

test('resaltar: el marcador amarillo llega al PDF descargado', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await expect(run).toBeVisible();
  // Resaltar usa el color de herramienta unificado (§2, #18 del lote D);
  // rojo por defecto (mismo que la pluma), así que para un marcador amarillo
  // hay que elegir esa muestra explícitamente — antes de este PR el amarillo
  // venía fijo dentro de HighlightRunCmd.
  await page.locator('.swatch[data-color="#facc15"]').click();
  await run.click(); // selecciona
  await page.locator('#btn-highlight').click();
  await expect(page.locator('#status')).toHaveText('Resaltado.');

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'resaltado.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const { data } = eng.renderPage(doc, 0, 1);
  let amarillo = false;
  for (let i = 0; i < data.length; i += 4) { if (data[i]! > 200 && data[i+1]! > 180 && data[i+2]! < 120) { amarillo = true; break; } }
  expect(amarillo).toBe(true);
  eng.close(doc);
});
