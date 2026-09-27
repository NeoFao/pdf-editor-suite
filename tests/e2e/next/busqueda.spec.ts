import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

test('buscar resalta las coincidencias y limpiar las quita', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await page.locator('#btn-search').fill('ORIGINAL');
  await expect(page.locator('.search-hl').first()).toBeVisible();
  await expect(page.locator('#status')).toContainText('coincidencia');

  await page.locator('#btn-search').fill('');
  await expect(page.locator('.search-hl')).toHaveCount(0);
});
