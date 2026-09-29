import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.resolve(AQUI, '../../fixtures/generados/escaneado.pdf');
// Debe coincidir con LINEA_ESCANEADO en tests/fixtures/generar-fixtures.mjs.
const LINEA_ESCANEADO = 'Linea vectorial de referencia';

/** Descarga el PDF actual (#btn-save) y devuelve sus bytes. */
async function descargar(page: import('@playwright/test').Page, nombre: string): Promise<Uint8Array> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, nombre);
  await download.saveAs(destino);
  return new Uint8Array(fs.readFileSync(destino));
}

// #25 de la tabla de paridad (§9): filtros de imagen, actuando SOLO sobre el
// objeto imagen — a diferencia de la app vieja, que rasteriza la página
// entera, aquí el texto vectorial de la página nunca se toca.
test('escala de grises: la imagen sale R≈G≈B y el texto vectorial sigue intacto', async ({ page }) => {
  test.setTimeout(120_000);
  const eng = await PdfiumEngine.create();

  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(PDF);
  await expect(page.locator('.run').first()).toBeVisible();
  // La imagen del fixture es grande: espera a que openBytes() termine de
  // verdad (mensaje final de "N página(s)") antes de interactuar, para no
  // competir con su propio setStatus final.
  await expect(page.locator('#status')).toHaveText('1 página(s)', { timeout: 60_000 });

  await page.locator('#filter-select').selectOption('grises');
  await page.locator('#btn-filter').click();
  await expect(page.locator('#status')).toContainText('Filtro aplicado a 1 imagen');

  const bytes = await descargar(page, 'escaneado-grises.pdf');
  const doc = await eng.open(bytes);

  expect(eng.pageCount(doc)).toBe(1);
  const textos = eng.getPageText(doc, 0).map((r) => r.text);
  expect(textos.some((t) => t.includes(LINEA_ESCANEADO))).toBe(true);

  // Renderiza a una escala baja (la imagen es grande) y comprueba R≈G≈B en
  // una franja dentro de la zona de la imagen (evitando el texto, que va en
  // la esquina superior).
  const scale = 0.15;
  const { width, height, data } = eng.renderPage(doc, 0, scale);
  let muestras = 0;
  for (let y = Math.floor(height * 0.3); y < Math.floor(height * 0.8); y += 4) {
    for (let x = Math.floor(width * 0.2); x < Math.floor(width * 0.8); x += 4) {
      const i = (y * width + x) * 4;
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
      expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
      muestras++;
    }
  }
  expect(muestras).toBeGreaterThan(100); // se comprobaron de verdad muestras, no un bucle vacío
  eng.close(doc);
});

test('una página sin imágenes avisa en el estado y no aplica nada', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#btn-new').click();
  await expect(page.locator('#status')).toHaveText('Documento en blanco creado.');

  await page.locator('#filter-select').selectOption('bn');
  await page.locator('#btn-filter').click();
  await expect(page.locator('#status')).toHaveText(
    'Esta página no tiene imágenes; los filtros solo afectan a imágenes (el texto queda intacto).'
  );
});

// #29 de la tabla de paridad (§9): comprimir, actuando solo sobre imágenes.
test('comprimir con calidad 50 y 150 dpi reduce el peso al menos un 40%, conserva página/texto/rect, y Deshacer restaura el tamaño', async ({ page }) => {
  test.setTimeout(120_000);
  const eng = await PdfiumEngine.create();
  const bytesOriginales = fs.readFileSync(PDF);

  const docOriginal = await eng.open(new Uint8Array(bytesOriginales));
  const rectOriginal = eng.listImageObjects(docOriginal, 0)[0]!.rectPt;
  eng.close(docOriginal);

  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(PDF);
  await expect(page.locator('.run').first()).toBeVisible();
  await expect(page.locator('#status')).toHaveText('1 página(s)', { timeout: 60_000 });

  await page.locator('#btn-compress').click();
  await page.locator('#compress-quality').evaluate((el: HTMLInputElement) => {
    el.value = '50';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#compress-dpi').selectOption('150');
  await page.locator('#btn-compress-run').click();

  await expect(page.locator('#status')).toContainText('Comprimido:', { timeout: 60_000 });
  await expect(page.locator('#status')).toContainText('%)');

  const bytesComprimidos = await descargar(page, 'escaneado-comprimido.pdf');
  expect(bytesComprimidos.length).toBeLessThanOrEqual(bytesOriginales.length * 0.6); // al menos 40% menos

  const docComprimido = await eng.open(bytesComprimidos);
  expect(eng.pageCount(docComprimido)).toBe(1);
  const textos = eng.getPageText(docComprimido, 0).map((r) => r.text);
  expect(textos.some((t) => t.includes(LINEA_ESCANEADO))).toBe(true);

  const rectComprimido = eng.listImageObjects(docComprimido, 0)[0]!.rectPt;
  expect(rectComprimido.xPt).toBeCloseTo(rectOriginal.xPt, 0);
  expect(rectComprimido.yPt).toBeCloseTo(rectOriginal.yPt, 0);
  expect(rectComprimido.wPt).toBeCloseTo(rectOriginal.wPt, 0);
  expect(rectComprimido.hPt).toBeCloseTo(rectOriginal.hPt, 0);
  eng.close(docComprimido);

  // Deshacer restaura la imagen a su resolución original.
  await page.locator('#btn-undo').click();
  const bytesTrasDeshacer = await descargar(page, 'escaneado-deshecho.pdf');
  const docDeshecho = await eng.open(bytesTrasDeshacer);
  const pixTrasDeshacer = eng.getImagePixels(docDeshecho, 0, eng.listImageObjects(docDeshecho, 0)[0]!.objIndex)!;
  expect(pixTrasDeshacer.width).toBe(2000);
  expect(pixTrasDeshacer.height).toBe(2800);
  eng.close(docDeshecho);
});
