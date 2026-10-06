import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const POR_GLIFO = path.resolve(AQUI, '../../fixtures/generados/por-glifo.pdf');

/**
 * N1 F4 (1): «Buscar y reemplazar» trabaja por LÍNEA editable. `por-glifo.pdf` escribe un objeto por carácter:
 * por objeto no coincidiría casi nada; por línea sí. Una coincidencia que cruza dos líneas se sigue avisando.
 */
async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(POR_GLIFO);
  await expect(page.locator('.run').first()).toBeVisible();
  await page.keyboard.press('Control+H');
  await expect(page.locator('#replace-bar')).toBeVisible();
}

test('reemplaza una palabra que cruza objetos de la misma línea y respeta el resto', async ({ page }) => {
  await abrir(page);
  await page.locator('#btn-search').fill('tres cuatro');
  await page.locator('#replace-input').fill('TRES-4');
  await page.locator('#btn-replace-all').click();
  await expect(page.locator('#replace-result')).toHaveText('1 reemplazo.');
  await expect(page.locator('.run', { hasText: 'uno dos TRES-4 cinco seis' })).toBeVisible();
  await expect(page.locator('.run', { hasText: 'Celda A1' })).toBeVisible();
});

test('Reemplazar todo cambia varias líneas por glifo y UN Deshacer las restaura', async ({ page }) => {
  await abrir(page);
  await page.locator('#btn-search').fill('Columna');
  await page.locator('#replace-input').fill('Col');
  await page.locator('#btn-replace-all').click();
  await expect(page.locator('#replace-result')).toHaveText('4 reemplazos.');
  await expect(page.locator('.run', { hasText: 'Col izquierda uno' })).toBeVisible();
  await expect(page.locator('.run', { hasText: 'Columna' })).toHaveCount(0);

  await page.locator('#btn-undo').click();
  await expect(page.locator('.run', { hasText: 'Columna izquierda uno' })).toBeVisible();
  await expect(page.locator('.run', { hasText: 'Col izquierda' })).toHaveCount(0);
});

test('Reemplazar cambia UNA coincidencia cada vez, sobre líneas compuestas', async ({ page }) => {
  await abrir(page);
  await page.locator('#btn-search').fill('Celda');
  await page.locator('#replace-input').fill('Cel');
  await page.locator('#btn-replace').click();
  await expect(page.locator('#replace-result')).toContainText('quedan 5');
  await expect(page.locator('.run', { hasText: /^Cel [ABC][12]$/ })).toHaveCount(1);
});

test('una coincidencia que cruza dos líneas NO se reemplaza y se avisa', async ({ page }) => {
  await abrir(page);
  await page.locator('#btn-search').fill('izquierda uno Columna');
  await page.locator('#replace-input').fill('XX');
  await page.locator('#btn-replace-all').click();
  await expect(page.locator('#replace-result')).toContainText('0 reemplazos; 1 coincidencia no reemplazada');
});
