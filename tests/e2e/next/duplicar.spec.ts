import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf'); // 2 páginas

test('duplicar: la copia aparece y sube el conteo de miniaturas', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('#thumbs canvas')).toHaveCount(2);
  await page.locator('#btn-duplicate').click();
  await expect(page.locator('#thumbs canvas')).toHaveCount(3);
  await expect(page.locator('#page-indicator')).toHaveText('1 / 3');
});
