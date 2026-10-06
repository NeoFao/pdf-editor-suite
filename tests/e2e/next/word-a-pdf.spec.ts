import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

/**
 * §9 fila #4: abrir un `.docx` desde `#file-input` lo convierte a un PDF con
 * texto REAL y vectorial (nunca rasteriza), usando el motor PDFium — a
 * diferencia de la app vieja (`docx-preview` + `html2pdf`, que rasteriza).
 * Fase 2a añade tablas reales, imágenes inline y enlaces clicables (ver
 * `word-completo.docx`, más abajo). `word-basico.docx`/`word-tabla-imagen.docx`/
 * `word-completo.docx` (tests/fixtures) se generan con `npm run test:fixtures`
 * (ver `generar-fixtures.mjs`).
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WORD_BASICO = path.resolve(AQUI, '../../fixtures/generados/word-basico.docx');
const WORD_TABLA_IMAGEN = path.resolve(AQUI, '../../fixtures/generados/word-tabla-imagen.docx');
const WORD_JPEG = path.resolve(AQUI, '../../fixtures/generados/word-jpeg.docx');
const WORD_COMBINADA = path.resolve(AQUI, '../../fixtures/generados/word-combinada.docx');
const WORD_COMPLETO = path.resolve(AQUI, '../../fixtures/generados/word-completo.docx');
const WORD_ENCABEZADOS = path.resolve(AQUI, '../../fixtures/generados/word-encabezados.docx');
const WORD_FLOTANTE = path.resolve(AQUI, '../../fixtures/generados/word-flotante.docx');

async function dataTransferConFichero(page: Page, bytes: number[], fileName: string, mime: string) {
  return page.evaluateHandle(({ bytes, fileName, mime }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], fileName, { type: mime }));
    return dt;
  }, { bytes, fileName, mime });
}

test('abrir word-basico.docx lo convierte a un PDF de 2 páginas con el texto en la capa de texto', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_BASICO);
  await expect(page.locator('.run').first()).toBeVisible();

  await expect(page.locator('#status')).toContainText('Convertido desde Word');

  const indicador = await page.locator('#page-indicator').textContent();
  const total = Number((indicador ?? '').split('/')[1]?.trim());
  expect(total).toBe(2);

  const textos = await page.locator('.run').allTextContents();
  const todo = textos.join(' ');
  expect(todo).toContain('Título');
  expect(todo).toMatch(/ñ/);
  expect(todo).toContain('negrita');

  // Sin advertencias (word-basico.docx no tiene contenido no soportado): el aviso no se muestra.
  await expect(page.locator('#conversion-warnings')).toBeHidden();
});

test('abrir word-tabla-imagen.docx: la tabla sale como texto real (rejilla) y la imagen aparece en la capa de imágenes, sin aviso (fase 2a)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_TABLA_IMAGEN);
  await expect(page.locator('.run').first()).toBeVisible();

  // Ya no se aplana ni se omite: sin advertencias, el aviso no se muestra.
  await expect(page.locator('#conversion-warnings')).toBeHidden();

  const textos = await page.locator('.run').allTextContents();
  expect(textos.join(' ')).toContain('Producto');
  expect(textos.join(' ')).toContain('Manzanas');

  // La imagen inline es un objeto imagen real, visible en la capa de imágenes.
  await expect(page.locator('.image-box')).toHaveCount(1);
});

test('abrir word-completo.docx: tabla con celda combinada, imagen y aviso visible del enlace javascript: descartado (fase 2a)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_COMPLETO);
  await expect(page.locator('.run').first()).toBeVisible();

  const textos = await page.locator('.run').allTextContents();
  const todo = textos.join(' ');
  expect(todo).toContain('Encabezado combinado');
  expect(todo).toContain('A1');
  expect(todo).toContain('Ir a example.com');
  expect(todo).toContain('enlace peligroso');

  await expect(page.locator('.image-box')).toHaveCount(1);

  // El enlace javascript: se descarta y se avisa visiblemente; ni tabla ni imagen generan aviso.
  await expect(page.locator('#conversion-warnings')).toBeVisible();
  const avisoTexto = (await page.locator('#conversion-warnings').textContent()) ?? '';
  expect(avisoTexto).toMatch(/enlace/i);
  expect(avisoTexto).not.toMatch(/tabla/i);
});

test('soltar un .doc (Word 97 binario) muestra el mensaje de formato antiguo, sin intentar convertirlo', async ({ page }) => {
  await page.goto('/index.next.html');
  const dt = await dataTransferConFichero(page, [1, 2, 3, 4], 'viejo.doc', 'application/msword');

  await page.dispatchEvent('#app', 'drop', { dataTransfer: dt });

  await expect(page.locator('#status')).toContainText('.doc antiguo no soportado');
  await expect(page.locator('.page')).toHaveCount(0);
});

test('abrir word-jpeg.docx: la imagen JPEG (createImageBitmap) llega al PDF con el tamaño declarado, 72x36 pt ±1, y sin aviso', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_JPEG);
  await expect(page.locator('.run').first()).toBeVisible();
  await expect(page.locator('.image-box')).toHaveCount(1);
  await expect(page.locator('#conversion-warnings')).toBeHidden();

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'word-jpeg.pdf');
  await download.saveAs(destino);

  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const imagenes = eng.listImageObjects(doc, 0);
  expect(imagenes).toHaveLength(1);
  expect(Math.abs(imagenes[0]!.rectPt.wPt - 72)).toBeLessThanOrEqual(1);
  expect(Math.abs(imagenes[0]!.rectPt.hPt - 36)).toBeLessThanOrEqual(1);
  eng.close(doc);
});

test('abrir word-combinada.docx: la celda combinada verticalmente muestra su texto UNA vez y sin aviso', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_COMBINADA);
  await expect(page.locator('.run').first()).toBeVisible();
  const textos = await page.locator('.run').allTextContents();
  expect(textos.filter((t) => t.includes('Fusionada'))).toHaveLength(1);
  expect(textos.join(' ')).toContain('fila cuatro');
  await expect(page.locator('#conversion-warnings')).toBeHidden();
});

test('abrir word-encabezados.docx: 3 páginas, pie "Página N de 3" en cada una, encabezado de portada solo en la 1 y sin aviso (fase 2b)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_ENCABEZADOS);
  await expect(page.locator('.run').first()).toBeVisible();
  await expect(page.locator('#conversion-warnings')).toBeHidden();

  const indicador = await page.locator('#page-indicator').textContent();
  expect(Number((indicador ?? '').split('/')[1]?.trim())).toBe(3);

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'word-encabezados.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const texto = (p: number): string => eng.getPageText(doc, p).map((r) => r.text).join(' ');
  expect(eng.pageCount(doc)).toBe(3);
  expect(texto(0)).toContain('Encabezado de portada');
  expect(texto(1)).toContain('Encabezado general');
  expect(texto(0)).toContain('Página 1 de 3');
  expect(texto(1)).toContain('Página 2 de 3');
  expect(texto(2)).toContain('Página 3 de 3');
  // El título no queda huérfano al pie de la página 1.
  expect(texto(0)).not.toContain('Resultados del informe');
  expect(texto(1)).toContain('Resultados del informe');
  eng.close(doc);
});

test('abrir word-flotante.docx: la imagen flotante se coloca (una imagen en la capa) y el aviso visible dice que va sin ajuste de texto', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_FLOTANTE);
  await expect(page.locator('.run').first()).toBeVisible();
  await expect(page.locator('.image-box')).toHaveCount(1);

  await expect(page.locator('#conversion-warnings')).toBeVisible();
  const aviso = (await page.locator('#conversion-warnings').textContent()) ?? '';
  expect(aviso).toMatch(/imagen flotante colocada sin ajuste de texto/i);
});
