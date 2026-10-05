import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

/**
 * §9 fila #32: abrir un `.md` desde `#file-input` lo convierte a un PDF con
 * texto REAL y vectorial (nunca rasteriza), usando el motor PDFium — a
 * diferencia de la app vieja (`marked` + `html2pdf`, que produce una
 * imagen). `ejemplo.md` (tests/fixtures) tiene título con tildes/ñ, un
 * párrafo largo (fuerza 2+ páginas), lista y código.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const EJEMPLO_MD = path.resolve(AQUI, '../../fixtures/ejemplo.md');

test('abrir un .md lo convierte a PDF vectorial con varias páginas y la capa de texto trae el título con ñ', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(EJEMPLO_MD);
  await expect(page.locator('.run').first()).toBeVisible();

  // Estado: aviso explícito de que se convirtió, con el número de páginas.
  await expect(page.locator('#status')).toContainText('Convertido desde Markdown');

  // Más de una página (el párrafo largo del fixture fuerza el salto).
  const indicador = await page.locator('#page-indicator').textContent();
  const total = Number((indicador ?? '').split('/')[1]?.trim());
  expect(total).toBeGreaterThanOrEqual(2);

  // El título (con eñe) está en la capa de texto, no solo pintado en el canvas.
  const textos = await page.locator('.run').allTextContents();
  expect(textos.some((t) => t.includes('Título'))).toBe(true);
  expect(textos.some((t) => t.includes('ñ') || t === 'año' || t === 'señor')).toBe(true);
});

test('Markdown -> PDF -> Exportar Markdown: el .md de vuelta trae "# " y el título (ida y vuelta razonable)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(EJEMPLO_MD);
  await expect(page.locator('.run').first()).toBeVisible();

  await abrirPestana(page, 'convertir');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-export-md').click()
  ]);
  const destino = path.join(test.info().outputDir, 'ejemplo-vuelta.md');
  await download.saveAs(destino);
  const md = fs.readFileSync(destino, 'utf-8');

  expect(md).toMatch(/^#\s/m);
  expect(md).toContain('Título');
});

test('el enlace de ejemplo.md genera una anotación /Link real en el PDF guardado (fase 2a)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(EJEMPLO_MD);
  await expect(page.locator('.run').first()).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-save').click()
  ]);
  const destino = path.join(test.info().outputDir, 'ejemplo-con-enlace.pdf');
  await download.saveAs(destino);

  // Se comprueba con el motor en Node sobre el PDF ya guardado (no en el
  // navegador): PdfEngine no expone (todavía) un getter de enlaces, así que
  // se inspeccionan los bytes crudos, igual que PdfiumEngine.addlink.test.ts.
  const crudo = fs.readFileSync(destino).toString('latin1');
  expect(crudo).toContain('/Link');
  expect(crudo).toContain('https://ejemplo.com/pagina');
});

test('guardar el PDF convertido produce un archivo con texto extraíble en el motor', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(EJEMPLO_MD);
  await expect(page.locator('.run').first()).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-save').click()
  ]);
  const destino = path.join(test.info().outputDir, 'ejemplo-guardado.pdf');
  await download.saveAs(destino);

  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  expect(eng.pageCount(doc)).toBeGreaterThanOrEqual(2);
  const textoPagina1 = eng.getPageText(doc, 0).map((r) => r.text).join(' ');
  expect(textoPagina1).toContain('Título');
  for (let p = 0; p < eng.pageCount(doc); p++) expect(eng.listImageObjects(doc, p)).toEqual([]);
  eng.close(doc);
});
