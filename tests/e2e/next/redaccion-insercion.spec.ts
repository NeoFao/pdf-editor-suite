import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

async function textosDelDescargado(page: import('@playwright/test').Page, click: () => Promise<void>): Promise<string[]> {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  const destino = path.join(test.info().outputDir, 'salida.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const textos = eng.getPageText(doc, 0).map((r) => r.text);
  eng.close(doc);
  return textos;
}

test('redactar: borrar una línea la elimina del PDF descargado (no es una máscara)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await expect(run).toBeVisible();
  await run.click();                 // selecciona
  await page.locator('#btn-delete').click();
  await expect(page.locator('#status')).toHaveText('Línea borrada del documento.');

  const textos = await textosDelDescargado(page, () => page.locator('#btn-save').click());
  expect(textos.some((t) => t.includes('ORIGINAL-TIMES'))).toBe(false);
  expect(textos.some((t) => t.includes('helvetica'))).toBe(true);
});

test('insertar: añadir texto nuevo llega al PDF descargado y es extraíble', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();
  await page.locator('#btn-insert').click();                 // activa modo insertar
  // Punto del fondo SIN texto encima: ambas líneas de `fuentes.pdf` quedan en
  // la mitad superior de la página (ver generar-fixtures.mjs), así que la
  // zona inferior está libre a cualquier escala — a diferencia de un píxel
  // fijo (p. ej. 160,175), que con el ajuste al ancho al abrir (#8) puede caer
  // sobre una línea según el tamaño real del visor.
  const pagina = page.locator('.page').first();
  const cajaPagina = (await pagina.boundingBox())!;
  await pagina.click({ position: { x: cajaPagina.width * 0.5, y: cajaPagina.height * 0.92 } });
  await expect(page.locator('#status')).toContainText('insertado');

  const textos = await textosDelDescargado(page, () => page.locator('#btn-save').click());
  expect(textos.some((t) => t.includes('Texto nuevo'))).toBe(true);
  expect(textos.some((t) => t.includes('ORIGINAL-TIMES'))).toBe(true); // lo demás intacto
});
