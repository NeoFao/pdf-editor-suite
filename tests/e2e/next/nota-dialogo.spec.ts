import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { abrirPestana, escribirNota } from './_ayudas';

// B4: crear y editar una nota usaba window.prompt (una sola línea, bloquea la página, sin estilo). Ahora es un
// <dialog> propio con textarea multilínea. Los tests de teclado NO usan el ratón.
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

async function abrir(page: Page): Promise<string[]> {
  const nativos: string[] = [];
  page.on('dialog', (d) => { nativos.push(d.type()); void d.dismiss(); }); // un prompt/alert nativo es un fallo
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();
  return nativos;
}

const DIALOGO = (page: Page) => page.getByRole('dialog', { name: /nota/i });

test('crear una nota de 2 líneas solo con el teclado: foco en el textarea, Ctrl+Enter guarda, persiste al guardar y reabrir', async ({ page }) => {
  const nativos = await abrir(page);
  await page.keyboard.press('n');
  await page.keyboard.press('Enter');
  const area = DIALOGO(page).getByLabel('Texto de la nota');
  await expect(area).toBeFocused();
  await page.keyboard.type('Primera línea');
  await page.keyboard.press('Enter'); // Enter solo = salto de línea dentro del textarea
  await page.keyboard.type('Segunda línea');
  await page.keyboard.press('Control+Enter');
  await expect(DIALOGO(page)).toHaveCount(0);
  await expect(page.locator('#status')).toHaveText('Nota añadida.');
  const marcador = page.locator('.note-marker');
  await expect(marcador).toHaveCount(1);
  await expect(marcador).toHaveAttribute('title', 'Primera línea\nSegunda línea');

  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const destino = path.join(test.info().outputDir, 'nota-2-lineas.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const notas = eng.getNotes(doc, 0);
  expect(notas).toHaveLength(1);
  expect(notas[0]!.text).toBe('Primera línea\nSegunda línea');
  eng.close(doc);
  expect(nativos).toEqual([]);
});

test('Escape cancela al crear: no queda ninguna nota ni vacía, el foco vuelve al disparador y no hay prompt nativo', async ({ page }) => {
  const nativos = await abrir(page);
  await page.keyboard.press('n');
  await page.keyboard.press('Enter');
  await expect(DIALOGO(page).getByLabel('Texto de la nota')).toBeFocused();
  await page.keyboard.type('se descarta');
  await page.keyboard.press('Escape');
  await expect(DIALOGO(page)).toHaveCount(0);
  await expect(page.locator('.note-marker')).toHaveCount(0);
  await expect(page.locator('#status')).toHaveText('Modo nota desactivado.');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('TEXTAREA');
  expect(nativos).toEqual([]);
});

test('Guardar con el texto en blanco o el botón Cancelar tampoco crean nota', async ({ page }) => {
  await abrir(page);
  await page.keyboard.press('n');
  await page.keyboard.press('Enter');
  await DIALOGO(page).getByLabel('Texto de la nota').fill('  \n  ');
  await DIALOGO(page).getByRole('button', { name: 'Guardar' }).click();
  await expect(DIALOGO(page)).toHaveCount(0);
  await expect(page.locator('.note-marker')).toHaveCount(0);

  await page.keyboard.press('n');
  await page.keyboard.press('Enter');
  await DIALOGO(page).getByLabel('Texto de la nota').fill('no');
  await DIALOGO(page).getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.locator('.note-marker')).toHaveCount(0);
});

test('doble clic sobre el marcador edita la nota con el mismo diálogo (precargada, multilínea); deshacer la restaura', async ({ page }) => {
  const nativos = await abrir(page);
  await abrirPestana(page, 'comentar');
  await page.locator('#btn-note').click();
  await page.locator('.page').first().click({ position: { x: 160, y: 175 } });
  await escribirNota(page, 'Original');
  await expect(page.locator('.note-marker')).toHaveAttribute('title', 'Original');

  await page.locator('.note-marker').dblclick();
  const area = DIALOGO(page).getByLabel('Texto de la nota');
  await expect(area).toHaveValue('Original');
  await expect(area).toBeFocused();
  await area.fill('Cambiada\nen dos líneas');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.note-marker')).toHaveAttribute('title', 'Cambiada\nen dos líneas');

  await page.locator('#btn-undo').click();
  await expect(page.locator('.note-marker')).toHaveAttribute('title', 'Original');
  expect(nativos).toEqual([]);
});

test('Editar desde el panel Comentarios usa el diálogo; el panel conserva los saltos; Escape deja la nota y devuelve el foco al botón', async ({ page }) => {
  const nativos = await abrir(page);
  await abrirPestana(page, 'comentar');
  await page.locator('#btn-note').click();
  await page.locator('.page').first().click({ position: { x: 160, y: 175 } });
  await escribirNota(page, 'Una');
  await page.locator('#tab-comments').click();
  const editar = page.getByRole('button', { name: /Editar comentario de la página 1/ });
  await editar.focus();
  await page.keyboard.press('Enter');
  await expect(DIALOGO(page).getByLabel('Texto de la nota')).toHaveValue('Una');
  await page.keyboard.press('Escape');
  await expect(DIALOGO(page)).toHaveCount(0);
  await expect(editar).toBeFocused();
  await expect(page.locator('.comentario-item').first()).toContainText('Una');

  await page.keyboard.press('Enter');
  await DIALOGO(page).getByLabel('Texto de la nota').fill('Línea A\nLínea B');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.note-marker')).toHaveAttribute('title', 'Línea A\nLínea B');
  const texto = page.locator('.comentario-texto').first();
  await expect(texto).toHaveText('Línea A\nLínea B');
  expect(await texto.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-line');
  expect(nativos).toEqual([]);
});
