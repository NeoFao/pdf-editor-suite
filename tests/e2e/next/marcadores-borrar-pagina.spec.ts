import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import type { OutlineItem } from '../../../src/engine/PdfEngine';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MARCADORES = path.resolve(AQUI, '../../fixtures/generados/marcadores.pdf');
const URI = path.resolve(AQUI, '../../fixtures/generados/marcadores-uri.pdf');
const JS = path.resolve(AQUI, '../../fixtures/generados/marcadores-js.pdf');

/**
 * Borrar una página con marcadores apuntando a ella (E-071). marcadores.pdf: 3 páginas;
 * «Capítulo 1» (p.1) con el hijo «Sección 1.1» (p.2) y «Capítulo 2 — Ñandú» (p.3).
 * Los marcadores de la página borrada se quitan, sus hijos suben un nivel, el resto apunta
 * a su página (índice nuevo) y deshacer devuelve el árbol exacto. Se lee el outline del PDF
 * guardado con el motor (no solo lo que pinta el panel).
 */
async function abrir(page: Page, fichero = MARCADORES): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(fichero);
  await expect(page.locator('.run').first()).toBeVisible();
}

async function borrarPagina(page: Page, n: number): Promise<void> {
  await page.locator('#thumbs canvas').nth(n - 1).click();
  await expect(page.locator('#page-indicator')).toHaveText(new RegExp(`^${n} /`));
  await abrirPestana(page, 'organizar');
  await page.locator('#btn-delete-page').click();
  await expect(page.locator('#status')).toHaveText('Página eliminada.');
}

/** Guarda y relee el outline del PDF resultante con el motor. */
async function outlineGuardado(page: Page, nombre: string): Promise<OutlineItem[]> {
  const [d] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, nombre);
  await d.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const arbol = eng.getOutline(doc);
  eng.close(doc);
  return arbol;
}

async function outlineOriginal(fichero = MARCADORES): Promise<OutlineItem[]> {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(fichero)));
  const arbol = eng.getOutline(doc);
  eng.close(doc);
  return arbol;
}

test('borrar la página 2: el marcador de esa página desaparece, el resto apunta bien y la edición sigue; deshacer lo devuelve exacto', async ({ page }) => {
  const original = await outlineOriginal();
  await abrir(page);
  await borrarPagina(page, 2);

  await page.locator('#tab-outline').click();
  await expect(page.locator('#outline-aviso-bloqueo')).toHaveCount(0);
  await expect(page.locator('#btn-outline-nuevo')).toBeEnabled();
  await expect(page.locator('#outline-panel .outline-item', { hasText: 'Sección 1.1' })).toHaveCount(0);

  const tras = await outlineGuardado(page, 'sin-p2.pdf');
  expect(tras).toEqual([
    { title: 'Capítulo 1', pageIndex: 0, children: [] },
    { title: 'Capítulo 2 — Ñandú', pageIndex: 1, children: [] }
  ]);

  // El marcador que queda navega a su página (3 -> 2 tras borrar).
  await page.locator('#outline-panel .outline-item', { hasText: 'Capítulo 2' }).click();
  await expect(page.locator('#page-indicator')).toHaveText('2 / 2');

  // Deshacer: el árbol original exacto.
  await page.locator('#btn-undo').click();
  await expect(page.locator('#page-indicator')).toHaveText(/\/ 3$/);
  expect(await outlineGuardado(page, 'deshecho.pdf')).toEqual(original);
});

test('borrar la página 1: «Capítulo 1» se quita y su hijo «Sección 1.1» sube a la raíz', async ({ page }) => {
  await abrir(page);
  await borrarPagina(page, 1);
  expect(await outlineGuardado(page, 'sin-p1.pdf')).toEqual([
    { title: 'Sección 1.1', pageIndex: 0, children: [] },
    { title: 'Capítulo 2 — Ñandú', pageIndex: 1, children: [] }
  ]);
});

test('con acciones no soportadas (JavaScript) el outline no se toca: el marcador «Web» sigue ahí', async ({ page }) => {
  await abrir(page, JS);
  await borrarPagina(page, 1);
  const tras = await outlineGuardado(page, 'js.pdf');
  const web = tras.find((i) => i.title === 'Web');
  expect(web?.accion?.tipo).toBe('no-soportada');
});

test('con un marcador URI: se quita el de la página borrada y el URI se conserva', async ({ page }) => {
  await abrir(page, URI);
  await borrarPagina(page, 1);
  expect(await outlineGuardado(page, 'uri.pdf')).toEqual([
    { title: 'Web', pageIndex: null, children: [], accion: { tipo: 'uri', uri: 'https://example.com/' } }
  ]);
});
