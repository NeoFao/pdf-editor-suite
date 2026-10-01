import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

/**
 * Buscar y reemplazar (Ctrl/Cmd+H). `nativo.pdf` tiene "linea" en 4 líneas de
 * la página 1 (minúscula) y "Linea" en la página 2 (mayúscula inicial):
 * 5 coincidencias sin distinguir mayúsculas, 4 distinguiéndolas.
 */
async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(NATIVO);
  await expect(page.locator('.run').first()).toBeVisible();
  await page.keyboard.press('Control+H');
  await expect(page.locator('#replace-bar')).toBeVisible();
}

async function runsConTexto(page: Page, texto: string): Promise<number> {
  return page.locator('.run', { hasText: texto }).count();
}

test('Ctrl+H abre la barra: foco en Buscar si está vacío, en Reemplazar si ya hay consulta; Escape la cierra', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(NATIVO);
  await expect(page.locator('.run').first()).toBeVisible();
  await expect(page.locator('#replace-bar')).toBeHidden();

  await page.keyboard.press('Control+H');
  await expect(page.locator('#replace-bar')).toBeVisible();
  await expect(page.locator('#btn-search')).toBeFocused();

  await page.locator('#btn-search').fill('linea');
  await page.keyboard.press('Control+H'); // con el foco en un campo editable SIGUE funcionando
  await expect(page.locator('#replace-input')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.locator('#replace-bar')).toBeHidden();
});

test('accesibilidad: campos etiquetados y resultado en una región aria-live', async ({ page }) => {
  await abrir(page);
  await expect(page.locator('#replace-input')).toHaveAttribute('aria-label', 'Reemplazar con');
  await expect(page.getByLabel('Distinguir mayúsculas')).toBeVisible();
  await expect(page.getByLabel('Palabra completa')).toBeVisible();
  const vivo = page.locator('#replace-result');
  await expect(vivo).toHaveAttribute('aria-live', 'polite');
  await expect(vivo).toHaveAttribute('role', 'status');

  await page.locator('#btn-search').fill('linea');
  await page.locator('#replace-input').fill('fila');
  await page.locator('#btn-replace-all').click();
  await expect(vivo).toContainText('5 reemplazos');
});

test('Reemplazar cambia UNA coincidencia cada vez (la siguiente desde la anterior)', async ({ page }) => {
  await abrir(page);
  await page.locator('#btn-search').fill('linea');
  await page.locator('#replace-input').fill('fila');

  await page.locator('#btn-replace').click();
  await expect(page.locator('#replace-result')).toContainText('1 reemplazo');
  await expect(page.locator('#replace-result')).toContainText('quedan 4');
  expect(await runsConTexto(page, 'fila')).toBe(1);

  await page.locator('#btn-replace').click();
  await expect(page.locator('#replace-result')).toContainText('quedan 3');
  expect(await runsConTexto(page, 'fila')).toBe(2);
});

test('Reemplazar con un texto que contiene la consulta no se repite sobre sí mismo', async ({ page }) => {
  await abrir(page);
  await page.locator('#btn-search').fill('linea');
  await page.locator('#replace-input').fill('linea nueva');
  await page.locator('#btn-replace').click();
  await expect(page.locator('#replace-result')).toContainText('1 reemplazo');
  await page.locator('#btn-replace').click();
  await expect(page.locator('#replace-result')).toContainText('quedan 4');
  // Dos líneas distintas cambiadas, ninguna con "linea nueva nueva".
  expect(await runsConTexto(page, 'linea nueva')).toBe(2);
  expect(await runsConTexto(page, 'nueva nueva')).toBe(0);
});

test('Reemplazar todo cambia todo el documento y UN Deshacer lo restaura todo', async ({ page }) => {
  await abrir(page);
  await page.locator('#btn-search').fill('linea');
  await page.locator('#replace-input').fill('fila');
  await page.locator('#btn-replace-all').click();
  await expect(page.locator('#replace-result')).toHaveText('5 reemplazos.');

  expect(await runsConTexto(page, 'linea')).toBe(0);
  await expect(page.locator('.run', { hasText: 'La segunda fila sirve' })).toBeVisible();
  expect(await runsConTexto(page, 'fila')).toBe(5); // 4 de la página 1 + la de la página 2

  await page.locator('#btn-undo').click();
  await expect(page.locator('.run', { hasText: 'La segunda linea sirve' })).toBeVisible();
  expect(await runsConTexto(page, 'fila')).toBe(0);

  // Era un solo paso: Rehacer vuelve a aplicarlo todo.
  await page.locator('#btn-redo').click();
  await expect(page.locator('.run', { hasText: 'La segunda fila sirve' })).toBeVisible();
});

test('"Distinguir mayúsculas" deja fuera la "Linea" de la página 2', async ({ page }) => {
  await abrir(page);
  await page.locator('#btn-search').fill('linea');
  await page.locator('#replace-input').fill('fila');
  await page.getByLabel('Distinguir mayúsculas').check();
  await page.locator('#btn-replace-all').click();
  await expect(page.locator('#replace-result')).toHaveText('4 reemplazos.');
});

test('"Palabra completa" no toca "linea" dentro de otra palabra', async ({ page }) => {
  await abrir(page);
  await page.locator('#btn-search').fill('on');
  await page.locator('#replace-input').fill('XX');
  await page.getByLabel('Palabra completa').check();
  await page.locator('#btn-replace-all').click();
  await expect(page.locator('#replace-result')).toContainText('No hay coincidencias');
  expect(await runsConTexto(page, 'XX')).toBe(0);
});

test('una coincidencia que cruza dos líneas NO se reemplaza y se avisa', async ({ page }) => {
  await abrir(page);
  // "...por renglones." (línea 4) + "Quinta linea..." (línea 5): son dos runs.
  await page.locator('#btn-search').fill('renglones. Quinta');
  await page.locator('#replace-input').fill('XX');
  await page.locator('#btn-replace-all').click();
  await expect(page.locator('#replace-result')).toHaveText(
    '0 reemplazos; 1 coincidencia no reemplazada porque abarca varias líneas o tramos.'
  );
  await expect(page.locator('.run', { hasText: 'Cuarta linea para verificar el agrupamiento por renglones.' })).toBeVisible();
  expect(await runsConTexto(page, 'XX')).toBe(0);
});

test('Reemplazar todo con una sola coincidencia dice "1 reemplazo" (singular) y conserva el resto de la línea', async ({ page }) => {
  await abrir(page);
  await page.locator('#btn-search').fill('Quinta');
  await page.locator('#replace-input').fill('Sexta');
  await page.locator('#btn-replace-all').click();
  await expect(page.locator('#replace-result')).toHaveText('1 reemplazo.');
  await expect(page.locator('.run', { hasText: 'Sexta linea final' })).toBeVisible();
});
