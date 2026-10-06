import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const POR_GLIFO = path.resolve(AQUI, '../../fixtures/generados/por-glifo.pdf');
const LINEA = 'uno dos tres cuatro cinco seis';

/**
 * N1 F4 (2): un resaltado sobre una palabra del SUFIJO de una línea compuesta viaja con ella cuando se edita el prefijo
 * (mismo Δ que el sufijo). Los marcados de otras líneas no se tocan. Chromium real, PDF guardado y releído.
 */
test('resaltar «seis», editar el prefijo y guardar: el resaltado sigue sobre «seis»', async ({ page }) => {
  // Posición relativa de «seis» dentro de la línea, medida con el motor (pt → fracción del ancho de la línea).
  const eng0 = await PdfiumEngine.create();
  const doc0 = await eng0.open(new Uint8Array(fs.readFileSync(POR_GLIFO)));
  const caja = eng0.findText(doc0, 0, 'seis')[0]!;
  const l0 = eng0.findText(doc0, 0, LINEA)[0]!;
  eng0.close(doc0);
  const fx0 = (caja.xPt - l0.xPt) / l0.wPt + 0.01;
  const fx1 = (caja.xPt + caja.wPt - l0.xPt) / l0.wPt - 0.005;

  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(POR_GLIFO);
  await expect(page.locator('.run').first()).toBeVisible();
  await abrirPestana(page, 'comentar');
  const run = page.locator('.run', { hasText: LINEA });
  const b = (await run.boundingBox())!;
  await page.mouse.move(b.x + b.width * fx0, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * fx0 + 6, b.y + b.height / 2 + 1, { steps: 3 });
  await page.mouse.move(b.x + b.width * fx1, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.locator('#btn-highlight').click();
  await expect(page.locator('#status')).toHaveText('Resaltado.');

  // Edita el PREFIJO de la línea (al principio).
  await abrirPestana(page, 'editar');
  await run.click();
  await expect(run).toHaveClass(/editing/);
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('NUEVO ');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Editado.');

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'marcado-sufijo.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const marcas = eng.getComments(doc, 0).filter((c) => c.kind === 'highlight');
  expect(marcas).toHaveLength(1);
  const quads = eng.getMarkupQuads(doc, 0, marcas[0]!.index);
  const xs = quads.flatMap((q) => [q[0], q[2], q[4], q[6]]);
  const seis = eng.findText(doc, 0, 'seis')[0]!;
  // El resaltado cubre la «seis» de AHORA (desplazada), no el hueco donde estaba.
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  expect(seis.xPt).toBeGreaterThan(caja.xPt + 5); // la palabra sí se movió
  expect(x0).toBeLessThan(seis.xPt + seis.wPt / 2);
  expect(x1).toBeGreaterThan(seis.xPt + seis.wPt / 2);
  expect(Math.abs((x0 + x1) / 2 - (seis.xPt + seis.wPt / 2))).toBeLessThan(seis.wPt * 0.6);
  eng.close(doc);
});
