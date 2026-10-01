import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MARCADORES = path.resolve(AQUI, '../../fixtures/generados/marcadores.pdf'); // 3 páginas A4

async function anadirNota(page: Page, pagina: number, texto: string): Promise<void> {
  await page.locator('#tab-pages').click();
  await page.locator('#thumbs canvas').nth(pagina).click(); // navega y deja la página pintada
  await expect(page.locator('#page-indicator')).toHaveText(`${pagina + 1} / 3`);
  await abrirPestana(page, 'comentar');
  page.once('dialog', (d) => d.accept(texto));
  await page.locator('#btn-note').click();
  await page.locator('.page').nth(pagina).click({ position: { x: 400, y: 600 } });
  await expect(page.locator('#status')).toHaveText('Nota añadida.');
}

async function abrirConDosNotas(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(MARCADORES);
  await expect(page.locator('.run').first()).toBeVisible();
  await anadirNota(page, 0, 'Primera nota ñandú');
  await anadirNota(page, 2, 'Tercera 🎉 nota');
  await page.locator('#tab-comments').click();
}

test('comentarios: la pestaña lista las notas por página con tipo y extracto', async ({ page }) => {
  await abrirConDosNotas(page);
  await expect(page.locator('#thumbs')).toBeHidden();
  const items = page.locator('.comentario-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Primera nota ñandú');
  await expect(items.nth(0)).toContainText('Nota');
  await expect(items.nth(0)).toContainText('Página 1');
  await expect(items.nth(1)).toContainText('Tercera 🎉 nota');
  await expect(items.nth(1)).toContainText('Página 3');
});

test('comentarios: un clic navega a la página y resalta la nota en el visor', async ({ page }) => {
  await abrirConDosNotas(page);
  await page.locator('.comentario-item').nth(1).click();
  await expect(page.locator('#page-indicator')).toHaveText('3 / 3');
  await expect(page.locator('.note-marker.activa')).toHaveCount(1);
  await expect(page.locator('.page').nth(2).locator('.note-marker.activa')).toHaveAttribute('aria-label', 'Tercera 🎉 nota');
});

test('comentarios: editar el texto, deshacer y rehacer; el visor lo refleja', async ({ page }) => {
  await abrirConDosNotas(page);
  await page.locator('.comentario-item').nth(0).click(); // deja la página 1 a la vista: el visor repinta solo lo visible
  await page.getByRole('button', { name: /Editar comentario de la página 1/ }).click();
  const editor = page.locator('.comentario-editor');
  await editor.fill('Texto corregido');
  await page.getByRole('button', { name: 'Guardar comentario' }).click();
  await expect(page.locator('.comentario-item').nth(0)).toContainText('Texto corregido');
  await expect(page.locator('.page').nth(0).locator('.note-marker')).toHaveAttribute('aria-label', 'Texto corregido');

  await page.locator('#btn-undo').click();
  await expect(page.locator('.comentario-item').nth(0)).toContainText('Primera nota ñandú');
  await page.locator('#btn-redo').click();
  await expect(page.locator('.comentario-item').nth(0)).toContainText('Texto corregido');
});

test('comentarios: borrar una nota la quita del panel y del visor; deshacer la repone', async ({ page }) => {
  await abrirConDosNotas(page);
  await page.locator('.comentario-item').nth(0).click();
  await page.getByRole('button', { name: /Borrar comentario de la página 1/ }).click();
  await expect(page.locator('.comentario-item')).toHaveCount(1);
  await expect(page.locator('.comentario-item').first()).toContainText('Tercera');
  await expect(page.locator('.page').nth(0).locator('.note-marker')).toHaveCount(0);

  await page.locator('#btn-undo').click();
  await expect(page.locator('.comentario-item')).toHaveCount(2);
  await expect(page.locator('.comentario-item').first()).toContainText('Primera nota ñandú');
});

test('comentarios: el filtro por texto oculta lo que no coincide; navegación por teclado entre elementos', async ({ page }) => {
  await abrirConDosNotas(page);
  await page.getByLabel('Filtrar comentarios').fill('tercera');
  await expect(page.locator('.comentario-item')).toHaveCount(1);
  await expect(page.locator('.comentario-item').first()).toContainText('Tercera');
  await page.getByLabel('Filtrar comentarios').fill('zzz');
  await expect(page.locator('.comentario-item')).toHaveCount(0);
  await expect(page.locator('#comments-panel')).toContainText('Sin resultados');
  await page.getByLabel('Filtrar comentarios').fill('');

  await page.locator('.comentario-item').nth(0).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.comentario-item').nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.comentario-item').nth(0)).toBeFocused();
});

test('comentarios: un documento sin notas muestra el aviso', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(MARCADORES);
  await expect(page.locator('.run').first()).toBeVisible();
  await page.locator('#tab-comments').click();
  await expect(page.locator('#comments-panel')).toContainText('no tiene comentarios');
});

test('comentarios: en un documento de 500 páginas la lectura cede el hilo y termina', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(path.resolve(AQUI, '../../fixtures/generados/grande.pdf'));
  await expect(page.locator('.run').first()).toBeVisible();
  await page.locator('#tab-comments').click();
  await expect(page.locator('#comments-panel')).toContainText('no tiene comentarios', { timeout: 30_000 });
  // La interfaz sigue viva: se puede volver a las miniaturas.
  await page.locator('#tab-pages').click();
  await expect(page.locator('#thumbs')).toBeVisible();
});
