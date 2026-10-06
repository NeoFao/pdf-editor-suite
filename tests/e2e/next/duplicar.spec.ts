import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf'); // 2 páginas

test('duplicar: la copia aparece y sube el conteo de miniaturas', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('#thumbs canvas')).toHaveCount(2);
  await abrirPestana(page, 'organizar');
  await page.locator('#btn-duplicate').click();
  await expect(page.locator('#thumbs canvas')).toHaveCount(3);
  await expect(page.locator('#page-indicator')).toHaveText('2 / 3'); // E-065: la actual pasa a la copia / primera página insertada
});
