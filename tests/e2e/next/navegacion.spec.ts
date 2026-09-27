import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf'); // 2 páginas

test('navegación: miniaturas e indicador de página; siguiente/anterior', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  // Una miniatura por página.
  await expect(page.locator('#thumbs canvas')).toHaveCount(2);
  await expect(page.locator('#page-indicator')).toHaveText('1 / 2');

  // Siguiente → página 2.
  await page.locator('#btn-next').click();
  await expect(page.locator('#page-indicator')).toHaveText('2 / 2');

  // Clic en la primera miniatura → vuelve a la 1.
  await page.locator('#thumbs canvas').first().click();
  await expect(page.locator('#page-indicator')).toHaveText('1 / 2');
});
