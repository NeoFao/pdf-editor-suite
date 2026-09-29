import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FUENTES = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');
const PAGINAS_PEQUENAS = path.resolve(AQUI, '../../fixtures/generados/paginas-pequenas.pdf');

/**
 * Atajos de teclado (#34 de la tabla de paridad, §9). La tabla declarativa y
 * la regla de oro del foco editable ya están cubiertas en Node por
 * `tests/unit/atajos.test.ts` (sin DOM); estos tests comprueban la
 * INTEGRACIÓN real: que `App.ejecutarAtajo` de verdad deshace/rehace sobre el
 * motor, que Ctrl+S descarga en vez de dejar actuar al navegador, que AvPág
 * mueve la página actual y que escribir en un campo no dispara nada de eso.
 */

test('atajos: Ctrl+Z deshace una edición real y Ctrl+Y la rehace', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FUENTES);

  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await expect(run).toBeVisible();
  await run.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('TEXTO NUEVO');
  await page.keyboard.press('Enter');
  await expect(page.locator('.run', { hasText: 'TEXTO NUEVO' })).toBeVisible();

  await page.keyboard.press('Control+Z');
  await expect(page.locator('.run', { hasText: 'ORIGINAL-TIMES' })).toBeVisible();
  await expect(page.locator('.run', { hasText: 'TEXTO NUEVO' })).toHaveCount(0);

  await page.keyboard.press('Control+Y');
  await expect(page.locator('.run', { hasText: 'TEXTO NUEVO' })).toBeVisible();
  await expect(page.locator('.run', { hasText: 'ORIGINAL-TIMES' })).toHaveCount(0);
});

test('atajos: Ctrl+Shift+Z también rehace (alternativa a Ctrl+Y)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FUENTES);

  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await run.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('OTRA COSA');
  await page.keyboard.press('Enter');
  await expect(page.locator('.run', { hasText: 'OTRA COSA' })).toBeVisible();

  await page.keyboard.press('Control+Z');
  await expect(page.locator('.run', { hasText: 'ORIGINAL-TIMES' })).toBeVisible();

  await page.keyboard.press('Control+Shift+Z');
  await expect(page.locator('.run', { hasText: 'OTRA COSA' })).toBeVisible();
});

test('atajos: Ctrl+S dispara la descarga (y no un diálogo del navegador que bloquee la prueba)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FUENTES);
  await expect(page.locator('.run').first()).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Control+s')
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
});

test('atajos: Ctrl+F enfoca el buscador (#btn-search)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FUENTES);
  await expect(page.locator('.run').first()).toBeVisible();

  // Foco en cualquier otro sitio primero, para comprobar que el atajo de
  // verdad MUEVE el foco (no que ya estaba ahí de casualidad).
  await page.locator('#btn-new').focus();
  await page.keyboard.press('Control+f');
  await expect(page.locator('#btn-search')).toBeFocused();
});

test('atajos: AvPág/RePág cambian el indicador de página; Inicio/Fin van a la primera/última', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(PAGINAS_PEQUENAS);
  await expect(page.locator('.run').first()).toBeVisible();
  await expect(page.locator('#page-indicator')).toHaveText('1 / 4');

  await page.keyboard.press('PageDown');
  await expect(page.locator('#page-indicator')).toHaveText('2 / 4');
  await page.keyboard.press('PageDown');
  await expect(page.locator('#page-indicator')).toHaveText('3 / 4');
  await page.keyboard.press('PageUp');
  await expect(page.locator('#page-indicator')).toHaveText('2 / 4');

  await page.keyboard.press('End');
  await expect(page.locator('#page-indicator')).toHaveText('4 / 4');
  await page.keyboard.press('Home');
  await expect(page.locator('#page-indicator')).toHaveText('1 / 4');
});

test('atajos: Ctrl+0 ajusta al ancho (mismo efecto que #btn-fit-width)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FUENTES);
  await expect(page.locator('.run').first()).toBeVisible();

  await page.locator('#btn-zoom-in').click();
  await page.locator('#btn-zoom-in').click();
  const estadoTrasZoom = await page.locator('#status').textContent();
  expect(estadoTrasZoom).toContain('Zoom');

  await page.keyboard.press('Control+0');
  await expect(page.locator('#status')).toContainText('Ajustado al ancho');
});

test('atajos: "?" abre el panel de ayuda con la tabla de atajos', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FUENTES);
  await expect(page.locator('.run').first()).toBeVisible();

  await expect(page.locator('#shortcuts-dialog')).toHaveCount(0);
  await page.keyboard.press('?');
  await expect(page.locator('#shortcuts-dialog')).toBeVisible();
  await expect(page.locator('#shortcuts-table')).toContainText('Deshacer');
});

test('atajos: #btn-shortcuts también abre la ayuda (con un clic, sin teclado)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FUENTES);
  await expect(page.locator('.run').first()).toBeVisible();

  await page.locator('#btn-shortcuts').click();
  await expect(page.locator('#shortcuts-dialog')).toBeVisible();
});

test('regla de oro: escribir en un campo de formulario no dispara AvPág, Inicio ni "?"', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(PAGINAS_PEQUENAS);
  await expect(page.locator('.run').first()).toBeVisible();
  await expect(page.locator('#page-indicator')).toHaveText('1 / 4');

  // Avanza de verdad una página primero, para poder distinguir "no hizo
  // nada" de "ya estaba en la página 1 por casualidad".
  await page.keyboard.press('PageDown');
  await expect(page.locator('#page-indicator')).toHaveText('2 / 4');

  await abrirPestana(page, 'organizar');
  const campo = page.locator('#btn-range'); // <input type="text">, siempre presente
  await campo.focus();
  await page.keyboard.press('PageDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('?');

  await expect(page.locator('#page-indicator')).toHaveText('2 / 4'); // sin cambios
  await expect(page.locator('#shortcuts-dialog')).toHaveCount(0);
});

test('regla de oro: escribir en una .run en edición no dispara AvPág ni "?" (el carácter se escribe en la línea)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(PAGINAS_PEQUENAS);
  const run = page.locator('.run').first();
  await expect(run).toBeVisible();
  await expect(page.locator('#page-indicator')).toHaveText('1 / 4');

  await run.click(); // entra en edición (contentEditable)
  await page.keyboard.press('End'); // cursor al final del texto de la línea, no "última página"
  await page.keyboard.type('?');

  await expect(page.locator('#page-indicator')).toHaveText('1 / 4');
  await expect(page.locator('#shortcuts-dialog')).toHaveCount(0);
  await expect(run).toContainText('?');
});

test('regla de oro: Ctrl+Z con el foco en un campo de formulario deja actuar al navegador (no deshace el documento)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FUENTES);

  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await run.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('CAMBIADO');
  await page.keyboard.press('Enter');
  await expect(page.locator('.run', { hasText: 'CAMBIADO' })).toBeVisible();

  // #btn-range es un <input type="text">: Ctrl+Z ahí es "deshacer texto
  // escrito en el input" (comportamiento nativo del navegador), nunca debe
  // deshacer la edición del documento.
  await abrirPestana(page, 'organizar');
  await page.locator('#btn-range').fill('1-2');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.run', { hasText: 'CAMBIADO' })).toBeVisible();
});
