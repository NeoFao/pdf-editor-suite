import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');   // 2 páginas
const EXTRA = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf'); // 1 página

test('insertar otro PDF añade sus páginas (miniaturas e indicador)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(BASE);
  await expect(page.locator('#thumbs canvas')).toHaveCount(2);

  await page.locator('#btn-insert-pdf').setInputFiles(EXTRA);
  await expect(page.locator('#thumbs canvas')).toHaveCount(3);
  await expect(page.locator('#page-indicator')).toHaveText('1 / 3');
});
