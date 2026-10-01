import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MARCADORES = path.resolve(AQUI, '../../fixtures/generados/marcadores.pdf');
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

// Edición de marcadores (T4). marcadores.pdf: 3 páginas; "Capítulo 1" (p.1) con
// el hijo "Sección 1.1" (p.2) y "Capítulo 2 — Ñandú" (p.3).

async function abrirPanel(page: Page, fichero = MARCADORES): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(fichero);
  await expect(page.locator('.run').first()).toBeVisible();
  await page.locator('#tab-outline').click();
  await expect(page.locator('#outline-toolbar')).toBeVisible();
}

const item = (page: Page, texto: string) => page.locator('[role="treeitem"]', { has: page.locator(':scope > div > .outline-item', { hasText: texto }) }).first();
/** Títulos de los marcadores VISIBLES (las ramas plegadas no cuentan). */
const titulos = (page: Page) => page.locator('#outline-panel .outline-item').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.textContent));

async function desplegarCap1(page: Page): Promise<void> {
  await item(page, 'Capítulo 1').locator(':scope > div > .outline-toggle').click();
  await expect(page.locator('.outline-item', { hasText: 'Sección 1.1' })).toBeVisible();
}

test('marcadores: el árbol expone role=tree/treeitem y aria-expanded, y se maneja con flechas', async ({ page }) => {
  await abrirPanel(page);
  await expect(page.locator('#outline-panel [role="tree"]')).toHaveCount(1);
  const cap1 = item(page, 'Capítulo 1');
  await expect(cap1).toHaveAttribute('aria-expanded', 'false');
  await cap1.focus();
  await page.keyboard.press('ArrowRight');
  await expect(item(page, 'Capítulo 1')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Sección 1.1')).toBeFocused();
  await page.keyboard.press('ArrowLeft'); // hijo sin hijos -> foco al padre
  await expect(item(page, 'Capítulo 1')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(item(page, 'Capítulo 1')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Capítulo 2')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#page-indicator')).toHaveText('3 / 3');
});

test('marcadores: nuevo marcador apunta a la página actual, se relee tras guardar y reabrir, y deshacer/rehacer lo quitan y lo devuelven', async ({ page }) => {
  await abrirPanel(page);
  await item(page, 'Capítulo 2').locator(':scope > div > .outline-item').click(); // selecciona y va a la página 3
  await expect(page.locator('#page-indicator')).toHaveText('3 / 3');

  await page.locator('#btn-outline-nuevo').click();
  const campo = page.locator('input.outline-edit');
  await expect(campo).toBeFocused();
  await campo.fill('Apéndice ñandú 😀');
  await campo.press('Enter');
  expect(await titulos(page)).toEqual(['Capítulo 1', 'Capítulo 2 — Ñandú', 'Apéndice ñandú 😀']);

  // Deshacer (Ctrl+Z con el foco en el árbol).
  await item(page, 'Apéndice').focus();
  await page.keyboard.press('Control+z');
  expect(await titulos(page)).toEqual(['Capítulo 1', 'Capítulo 2 — Ñandú']);
  await page.keyboard.press('Control+y');
  expect(await titulos(page)).toEqual(['Capítulo 1', 'Capítulo 2 — Ñandú', 'Apéndice ñandú 😀']);

  // Navegar a otra página y volver con el marcador nuevo.
  await item(page, 'Capítulo 1').locator(':scope > div > .outline-item').click();
  await expect(page.locator('#page-indicator')).toHaveText('1 / 3');
  await item(page, 'Apéndice').locator(':scope > div > .outline-item').click();
  await expect(page.locator('#page-indicator')).toHaveText('3 / 3');

  // Guardar, reabrir ese fichero y comprobar que el marcador sigue ahí.
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'con-marcador.pdf');
  await descarga.saveAs(destino);
  await abrirPanel(page, destino);
  expect(await titulos(page)).toEqual(['Capítulo 1', 'Capítulo 2 — Ñandú', 'Apéndice ñandú 😀']);
});

test('marcadores: nuevo hijo del seleccionado y primer marcador en un documento sin outline', async ({ page }) => {
  await abrirPanel(page);
  await item(page, 'Capítulo 2').locator(':scope > div > .outline-item').click();
  await page.locator('#btn-outline-hijo').click();
  await page.locator('input.outline-edit').fill('Sub 2.1');
  await page.locator('input.outline-edit').press('Enter');
  const cap2 = item(page, 'Capítulo 2');
  await expect(cap2).toHaveAttribute('aria-expanded', 'true');
  await expect(item(page, 'Sub 2.1')).toHaveAttribute('aria-level', '2');

  await abrirPanel(page, NATIVO);
  await expect(page.locator('#outline-panel')).toHaveText('Este documento no tiene marcadores.');
  await page.locator('#btn-outline-nuevo').click();
  await page.locator('input.outline-edit').fill('Primero');
  await page.locator('input.outline-edit').press('Enter');
  expect(await titulos(page)).toEqual(['Primero']);
});

test('marcadores: Escape o título vacío cancelan la creación sin tocar el documento', async ({ page }) => {
  await abrirPanel(page);
  await page.locator('#btn-outline-nuevo').click();
  await page.locator('input.outline-edit').fill('No debe existir');
  await page.locator('input.outline-edit').press('Escape');
  expect(await titulos(page)).toEqual(['Capítulo 1', 'Capítulo 2 — Ñandú']);
  await page.locator('#btn-outline-nuevo').click();
  await page.locator('input.outline-edit').fill('   ');
  await page.locator('input.outline-edit').press('Enter');
  expect(await titulos(page)).toEqual(['Capítulo 1', 'Capítulo 2 — Ñandú']);
});

test('marcadores: renombrar con F2 y con doble clic', async ({ page }) => {
  await abrirPanel(page);
  await item(page, 'Capítulo 2').focus();
  await page.keyboard.press('F2');
  const campo = page.locator('input.outline-edit');
  await expect(campo).toHaveValue('Capítulo 2 — Ñandú');
  await campo.fill('Dos');
  await campo.press('Enter');
  expect(await titulos(page)).toEqual(['Capítulo 1', 'Dos']);

  await item(page, 'Capítulo 1').locator(':scope > div > .outline-item').dblclick();
  await page.locator('input.outline-edit').fill('Uno');
  await page.locator('input.outline-edit').press('Enter');
  expect(await titulos(page)).toEqual(['Uno', 'Dos']);
  await page.keyboard.press('Control+z');
  expect(await titulos(page)).toEqual(['Capítulo 1', 'Dos']);
});

test('marcadores: borrar pide confirmación si tiene hijos; cancelar no borra, aceptar borra con sus hijos y se puede deshacer', async ({ page }) => {
  await abrirPanel(page);
  const mensajes: string[] = [];
  let aceptar = false;
  page.on('dialog', (d) => { mensajes.push(d.message()); void (aceptar ? d.accept() : d.dismiss()); });

  await item(page, 'Capítulo 1').locator(':scope > div > .outline-item').click();
  await page.locator('#btn-outline-borrar').click();
  expect(mensajes).toHaveLength(1);
  expect(mensajes[0]).toContain('Capítulo 1');
  expect(await titulos(page)).toEqual(['Capítulo 1', 'Capítulo 2 — Ñandú']);

  aceptar = true;
  await page.locator('#btn-outline-borrar').click();
  expect(await titulos(page)).toEqual(['Capítulo 2 — Ñandú']);
  await page.locator('#btn-undo').click();
  await expect(item(page, 'Capítulo 1')).toBeVisible();
  await desplegarCap1(page);

  // Un marcador sin hijos se borra sin preguntar.
  mensajes.length = 0;
  await item(page, 'Capítulo 2').locator(':scope > div > .outline-item').click();
  await page.keyboard.press('Delete');
  expect(mensajes).toHaveLength(0);
  expect(await titulos(page)).toEqual(['Capítulo 1', 'Sección 1.1']);
});

test('marcadores: mover, sangrar (Tab) y desangrar (Mayús+Tab) con teclado y con botones', async ({ page }) => {
  await abrirPanel(page);
  await item(page, 'Capítulo 2').focus();
  await page.keyboard.press('Alt+ArrowUp');
  expect(await titulos(page)).toEqual(['Capítulo 2 — Ñandú', 'Capítulo 1']);
  await page.locator('#btn-outline-bajar').click();
  expect(await titulos(page)).toEqual(['Capítulo 1', 'Capítulo 2 — Ñandú']);

  // Tab: Capítulo 2 pasa a ser hijo de Capítulo 1 (queda tras "Sección 1.1").
  await item(page, 'Capítulo 2').focus();
  await page.keyboard.press('Tab');
  await expect(item(page, 'Capítulo 2')).toHaveAttribute('aria-level', '2');
  await page.keyboard.press('Shift+Tab');
  await expect(item(page, 'Capítulo 2')).toHaveAttribute('aria-level', '1');

  // Los botones no ofrecen lo imposible: el primero no puede subir ni desangrar.
  await item(page, 'Capítulo 1').focus();
  await expect(page.locator('#btn-outline-subir')).toBeDisabled();
  await expect(page.locator('#btn-outline-desangrar')).toBeDisabled();
  await expect(page.locator('#btn-outline-sangrar')).toBeDisabled();
});

test('marcadores: "Destino" reapunta el marcador a la página actual', async ({ page }) => {
  await abrirPanel(page);
  await desplegarCap1(page);
  await page.locator('.outline-item', { hasText: 'Sección 1.1' }).click(); // p.2
  await expect(page.locator('#page-indicator')).toHaveText('2 / 3');
  await item(page, 'Capítulo 2').focus(); // selecciona sin navegar
  await page.locator('#btn-outline-destino').click();
  await item(page, 'Capítulo 1').locator(':scope > div > .outline-item').click();
  await expect(page.locator('#page-indicator')).toHaveText('1 / 3');
  await item(page, 'Capítulo 2').locator(':scope > div > .outline-item').click();
  await expect(page.locator('#page-indicator')).toHaveText('2 / 3'); // antes era 3 / 3
});
