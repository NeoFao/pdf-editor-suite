import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.resolve(AQUI, '../../fixtures/generados/paginas-pequenas.pdf'); // 4 páginas de 200x120 pt, PAGINA-1..4

/** Descarga el PDF actual (#btn-save) y devuelve sus bytes. */
async function descargar(page: Page, nombre: string): Promise<Uint8Array> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, nombre);
  await download.saveAs(destino);
  return new Uint8Array(fs.readFileSync(destino));
}

async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(PDF);
  await expect(page.locator('#thumbs canvas')).toHaveCount(4);
  await expect(page.locator('.run').first()).toBeVisible();
  await abrirPestana(page, 'organizar');
  await page.locator('#btn-encabezado').click();
  await expect(page.locator('#encabezado-panel')).toBeVisible();
}

async function textos(bytes: Uint8Array, i: number): Promise<string[]> {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(bytes);
  const t = eng.getPageText(doc, i).map((r) => r.text.trim());
  eng.close(doc);
  return t;
}

test('numeración: "Página <<n>> de <<total>>" en el pie de las 4 páginas, como texto real', async ({ page }) => {
  await abrir(page);
  await page.locator('#eh-abajo-centro').fill('Página <<n>> de <<total>>');
  await page.locator('#eh-aplicar').click();
  await expect(page.locator('#encabezado-panel')).toHaveCount(0);
  await expect(page.locator('#status')).toContainText('Encabezado y pie añadidos');

  const bytes = await descargar(page, 'numerado.pdf');
  for (let i = 0; i < 4; i++) {
    const t = await textos(bytes, i);
    expect(t).toContain(`PAGINA-${i + 1}`);
    expect(t).toContain(`Página ${i + 1} de 4`);
  }
});

test('vista previa en vivo: aparece sobre la página, no toca el documento y se retira al cancelar', async ({ page }) => {
  await abrir(page);
  await page.locator('#eh-abajo-centro').fill('Vista <<n>>/<<total>>');
  const vista = page.locator('.eh-vista-texto');
  await expect(vista).toHaveText('Vista 1/4');
  // Está dentro de la página 1 y centrada en horizontal (tolerancia por el redondeo tipográfico).
  const caja = (await vista.boundingBox())!;
  const pag = (await page.locator('.page').first().boundingBox())!;
  expect(caja.y).toBeGreaterThan(pag.y + pag.height * 0.6);
  expect(Math.abs(caja.x + caja.width / 2 - (pag.x + pag.width / 2))).toBeLessThan(3);
  // Cambiar el texto actualiza la vista en vivo.
  await page.locator('#eh-abajo-centro').fill('Otro');
  await expect(vista).toHaveText('Otro');

  await page.locator('#eh-cancelar').click();
  await expect(page.locator('.eh-vista')).toHaveCount(0);
  const bytes = await descargar(page, 'sin-cambios.pdf');
  expect(await textos(bytes, 0)).toEqual(['PAGINA-1']);
});

test('marca de agua: texto, opacidad y rotación se aplican; se ve en pantalla y el texto es vectorial', async ({ page }) => {
  await abrir(page);
  await page.locator('#eh-tab-marca').click();
  await expect(page.locator('#ma-texto')).toHaveValue('CONFIDENCIAL');
  await expect(page.locator('#ma-rotacion')).toHaveValue('45');
  await page.locator('#ma-opacidad').fill('50');
  await page.locator('#ma-size').fill('30');
  await expect(page.locator('.eh-vista-marca')).toHaveText('CONFIDENCIAL');
  await expect(page.locator('.eh-vista-marca')).toHaveCSS('opacity', '0.5');
  await page.locator('#eh-aplicar').click();
  await expect(page.locator('#status')).toContainText('Marca de agua añadida');

  const bytes = await descargar(page, 'marca.pdf');
  for (let i = 0; i < 4; i++) expect(await textos(bytes, i)).toContain('CONFIDENCIAL');
  // Opacidad real en el PDF: color #cc0000 al 50 % sobre blanco -> canal G ≈ 255*(1-.5) = 127, nunca 0.
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(bytes);
  const r = eng.renderPage(doc, 0, 2);
  let minG = 255;
  for (let k = 0; k < r.data.length; k += 4) if (r.data[k]! > 150 && r.data[k + 1]! < 250) minG = Math.min(minG, r.data[k + 1]!);
  expect(minG).toBeGreaterThan(100);
  expect(minG).toBeLessThan(160);
  eng.close(doc);
});

test('un rango de páginas restringe dónde se aplica; rango fuera del documento avisa y no aplica', async ({ page }) => {
  await abrir(page);
  await page.locator('#eh-abajo-der').fill('P<<n>>');
  await page.locator('#eh-rango').fill('9');
  await page.locator('#eh-aplicar').click();
  await expect(page.locator('#eh-mensaje')).toContainText('no contiene ninguna página');
  await page.locator('#eh-rango').fill('2-3');
  await page.locator('#eh-inicio').fill('5');
  await page.locator('#eh-aplicar').click();
  await expect(page.locator('#encabezado-panel')).toHaveCount(0);
  const bytes = await descargar(page, 'rango.pdf');
  expect(await textos(bytes, 0)).toEqual(['PAGINA-1']);
  expect(await textos(bytes, 1)).toContain('P5');
  expect(await textos(bytes, 2)).toContain('P6');
  expect(await textos(bytes, 3)).toEqual(['PAGINA-4']);
});

test('deshacer revierte las 4 páginas de un solo paso; quitar elimina solo lo añadido', async ({ page }) => {
  await abrir(page);
  await page.locator('#eh-abajo-centro').fill('Pie <<n>>');
  await page.locator('#eh-aplicar').click();
  await expect(page.locator('#status')).toContainText('Encabezado y pie añadidos');

  await page.locator('#btn-undo').click();
  let bytes = await descargar(page, 'deshecho.pdf');
  for (let i = 0; i < 4; i++) expect(await textos(bytes, i)).toEqual([`PAGINA-${i + 1}`]);

  await page.locator('#btn-redo').click();
  await abrirPestana(page, 'organizar');
  await page.locator('#btn-encabezado').click();
  await page.locator('#eh-tab-marca').click();
  await page.locator('#eh-aplicar').click();
  await expect(page.locator('#encabezado-panel')).toHaveCount(0);
  bytes = await descargar(page, 'ambos.pdf');
  expect((await textos(bytes, 0)).sort()).toEqual(['CONFIDENCIAL', 'PAGINA-1', 'Pie 1'].sort());

  await page.locator('#btn-encabezado').click();
  await page.locator('#eh-quitar').click();
  await expect(page.locator('#status')).toContainText('Quitados 8 objeto(s)');
  bytes = await descargar(page, 'quitado.pdf');
  for (let i = 0; i < 4; i++) expect(await textos(bytes, i)).toEqual([`PAGINA-${i + 1}`]);

  await page.locator('#btn-undo').click(); // quitar es un solo paso reversible
  bytes = await descargar(page, 'quitado-deshecho.pdf');
  expect((await textos(bytes, 3)).sort()).toEqual(['CONFIDENCIAL', 'PAGINA-4', 'Pie 4'].sort());
});
