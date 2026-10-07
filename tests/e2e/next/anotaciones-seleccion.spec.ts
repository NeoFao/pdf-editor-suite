import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana, escribirNota } from './_ayudas';

// T14: quitar anotaciones con el ratón y el teclado. Con la herramienta "ninguna", un clic sobre un
// resaltado/subrayado/tachado/nota lo selecciona (contorno + aria-selected); Supr/Retroceso lo borra
// (con deshacer); Escape lo suelta; el borrador también lo borra. La detección usa los QuadPoints.
// Precedencia: arrastrar sobre texto selecciona TEXTO (T12); un clic corto sobre la anotación la selecciona;
// un segundo clic sobre la ya seleccionada la suelta y deja editar la línea.
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');
const ROTADA = path.resolve(AQUI, '../../fixtures/generados/rotada.pdf');

const L2 = 'La segunda linea sirve para probar la edicion in-place.';
const L4 = 'Cuarta linea para verificar el agrupamiento por renglones.';

async function abrir(page: Page, fichero = NATIVO): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(fichero);
  await expect(page.locator('.run').first()).toBeVisible();
  await abrirPestana(page, 'comentar'); // ahí viven Resaltar/Subrayar/Tachar/Nota
}

/** Marca la línea con el botón (la selecciona con un clic, aplica y sale de la edición). */
async function marcarLinea(page: Page, texto: string, boton: string): Promise<void> {
  await page.locator('.run', { hasText: texto }).click();
  await page.locator(boton).click();
  await expect(page.locator('.run.editing')).toHaveCount(0);
}

/** Clic con el ratón real en una fracción (0..1) del run. */
async function clicEn(page: Page, texto: string, fx = 0.5): Promise<void> {
  const b = (await page.locator('.run', { hasText: texto }).boundingBox())!;
  await page.mouse.click(b.x + b.width * fx, b.y + b.height / 2);
}

async function arrastrar(page: Page, desde: { texto: string; fx: number }, hasta: { texto: string; fx: number }): Promise<void> {
  const a = (await page.locator('.run', { hasText: desde.texto }).boundingBox())!;
  const b = (await page.locator('.run', { hasText: hasta.texto }).boundingBox())!;
  await page.mouse.move(a.x + a.width * desde.fx, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width * desde.fx + 12, a.y + a.height / 2 + 4, { steps: 3 });
  await page.mouse.move(b.x + b.width * hasta.fx, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

async function guardado(page: Page, nombre: string) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, nombre);
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  return { eng, doc };
}

test('clic sobre un resaltado lo selecciona (contorno, aria-selected); Supr lo borra del panel y del PDF; deshacer lo devuelve', async ({ page }) => {
  await abrir(page);
  await marcarLinea(page, L2, '#btn-highlight');
  await page.locator('#tab-comments').click();
  const items = page.locator('.comentario-item');
  await expect(items).toHaveCount(1);

  await clicEn(page, L2, 0.5);
  const sel = page.locator('.marcado-sel');
  await expect(sel).toHaveCount(1);
  await expect(sel).toHaveAttribute('role', 'option');
  await expect(sel).toHaveAttribute('aria-selected', 'true');
  await expect(sel).toHaveAttribute('data-tipo', 'highlight');
  await expect(page.locator('.marcado-sel-quad').first()).toBeVisible();
  await expect(page.locator('#status')).toContainText('Resaltado seleccionado');
  await expect(page.locator('.run.editing')).toHaveCount(0); // el clic no abrió la edición de la línea

  await page.keyboard.press('Delete');
  await expect(page.locator('.marcado-sel')).toHaveCount(0);
  await expect(items).toHaveCount(0);
  await expect(page.locator('#status')).toContainText('Resaltado borrado');
  const g = await guardado(page, 'sin-resaltado.pdf');
  expect(g.eng.getComments(g.doc, 0)).toHaveLength(0);
  expect(g.eng.getPageText(g.doc, 0).map((r) => r.text).join(' ')).toContain(L2); // el texto sigue ahí
  g.eng.close(g.doc);

  await page.locator('#btn-undo').click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Resaltado');
});

test('Retroceso borra un subrayado seleccionado y Escape suelta la selección sin borrar', async ({ page }) => {
  await abrir(page);
  await marcarLinea(page, L2, '#btn-underline');
  await page.locator('#tab-comments').click();
  const items = page.locator('.comentario-item');

  await clicEn(page, L2);
  await expect(page.locator('.marcado-sel')).toHaveAttribute('data-tipo', 'underline');
  await page.keyboard.press('Escape');
  await expect(page.locator('.marcado-sel')).toHaveCount(0);
  await expect(items).toHaveCount(1); // Escape no borra

  await clicEn(page, L2);
  await expect(page.locator('.marcado-sel')).toHaveCount(1);
  await page.keyboard.press('Backspace');
  await expect(items).toHaveCount(0);
});

test('un tachado también se selecciona y se borra con Supr', async ({ page }) => {
  await abrir(page);
  await marcarLinea(page, L2, '#btn-strike');
  await clicEn(page, L2);
  await expect(page.locator('.marcado-sel')).toHaveAttribute('data-tipo', 'strikeout');
  await page.keyboard.press('Delete');
  const g = await guardado(page, 'sin-tachado.pdf');
  expect(g.eng.getComments(g.doc, 0)).toHaveLength(0);
  g.eng.close(g.doc);
});

test('una nota se selecciona con un clic en su icono y Supr la borra', async ({ page }) => {
  await abrir(page);
  await page.locator('#btn-note').click(); // activa el modo nota
  await page.locator('.page').first().click({ position: { x: 160, y: 175 } });
  await escribirNota(page, 'Una nota');
  await expect(page.locator('#status')).toHaveText('Nota añadida.');
  await expect(page.locator('.note-marker')).toHaveCount(1);
  await page.keyboard.press('Escape'); // sale del modo nota
  await page.locator('.note-marker').click();
  await expect(page.locator('.marcado-sel')).toHaveAttribute('data-tipo', 'note');
  await page.keyboard.press('Delete');
  await expect(page.locator('.note-marker')).toHaveCount(0);
  await expect(page.locator('#status')).toContainText('Nota borrada');
});

test('el borrador borra un subrayado con un clic (coherente con los trazos) y se puede deshacer', async ({ page }) => {
  await abrir(page);
  await marcarLinea(page, L2, '#btn-underline');
  await page.locator('#tab-comments').click();
  const items = page.locator('.comentario-item');
  await expect(items).toHaveCount(1);

  await page.locator('#btn-eraser').click();
  await clicEn(page, L2);
  await expect(items).toHaveCount(0);
  await expect(page.locator('#status')).toContainText('Subrayado borrado');

  await page.locator('#btn-undo').click();
  await expect(items).toHaveCount(1);
});

test('arrastrar sobre texto resaltado sigue seleccionando TEXTO (no la anotación)', async ({ page }) => {
  await abrir(page);
  await marcarLinea(page, L2, '#btn-highlight');
  await arrastrar(page, { texto: L2, fx: 0.2 }, { texto: L4, fx: 0.5 });
  await expect(page.locator('.sel-rect').first()).toBeVisible();
  await expect(page.locator('.marcado-sel')).toHaveCount(0);
});

test('precedencia: el primer clic sobre una línea resaltada selecciona la anotación; el segundo la suelta y edita la línea', async ({ page }) => {
  await abrir(page);
  await marcarLinea(page, L2, '#btn-highlight');
  await clicEn(page, L2);
  await expect(page.locator('.marcado-sel')).toHaveCount(1);
  await expect(page.locator('.run.editing')).toHaveCount(0);
  await clicEn(page, L2);
  await expect(page.locator('.marcado-sel')).toHaveCount(0);
  await expect(page.locator('.run.editing')).toHaveCount(1);
});

test('una línea sin anotación sigue entrando a editar con un clic (no se rompe la edición)', async ({ page }) => {
  await abrir(page);
  await clicEn(page, L4);
  await expect(page.locator('.run.editing')).toHaveCount(1);
  await expect(page.locator('.marcado-sel')).toHaveCount(0);
});

test('la detección usa los QuadPoints: la mitad de la línea que el recorte NO cubre no selecciona la anotación', async ({ page }) => {
  await abrir(page);
  // Marcado de la mitad derecha de L2 a la mitad izquierda de L4 (3 quads): su /Rect envolvente cubre toda la anchura.
  await arrastrar(page, { texto: L2, fx: 0.5 }, { texto: L4, fx: 0.5 });
  await page.locator('#btn-highlight').click();
  await expect(page.locator('.sel-rect')).toHaveCount(0);

  // Mitad izquierda de L2: dentro del /Rect, fuera de los quads -> no es la anotación (edita la línea).
  await clicEn(page, L2, 0.15);
  await expect(page.locator('.marcado-sel')).toHaveCount(0);
  await expect(page.locator('.run.editing')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.run.editing')).toHaveCount(0);

  // Mitad derecha de L2: dentro de un quad -> anotación.
  await clicEn(page, L2, 0.8);
  await expect(page.locator('.marcado-sel')).toHaveCount(1);
  await expect(page.locator('.marcado-sel-quad')).toHaveCount(3);
});

test('en una página con /Rotate el clic también acierta el quad del resaltado (geometría común, E-053)', async ({ page }) => {
  await abrir(page, ROTADA);
  const run = page.locator('.run').first();
  const texto = ((await run.textContent()) ?? '').trim();
  await run.click();
  await page.locator('#btn-highlight').click();
  await expect(page.locator('.run.editing')).toHaveCount(0);
  const b = (await page.locator('.run', { hasText: texto }).first().boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator('.marcado-sel')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await expect(page.locator('.marcado-sel')).toHaveCount(0);
  const g = await guardado(page, 'rotada-sin-resaltado.pdf');
  expect(g.eng.getComments(g.doc, 0)).toHaveLength(0);
  g.eng.close(g.doc);
});
