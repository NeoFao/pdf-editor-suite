import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana } from './_ayudas';

// E-072: tras rotar 90° la página cambia de vertical a apaisada (o al revés) y el
// "ajustar al ancho" no se recalculaba: la página se salía del visor. Con zoom
// manual, en cambio, rotar NO debe tocar la escala.
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();
}

/** Ancho útil del visor en px CSS (clientWidth sin padding). */
const anchoUtil = (page: Page) => page.evaluate(() => {
  const v = document.getElementById('viewer')!;
  const cs = getComputedStyle(v);
  return v.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
});

test('modo ajustar al ancho: rotar reajusta, sin scroll horizontal', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'organizar');
  await page.locator('#btn-rotate').click();
  const pagina = page.locator('.page').first();
  // Espera a que la página sea apaisada (la rotación ya se pintó) antes de medir.
  await expect.poll(async () => { const b = (await pagina.boundingBox())!; return b.width > b.height; }).toBe(true);
  await expect.poll(async () => Math.abs((await pagina.boundingBox())!.width - (await anchoUtil(page)))).toBeLessThanOrEqual(4);
  const sin = await page.evaluate(() => { const v = document.getElementById('viewer')!; return v.scrollWidth <= v.clientWidth; });
  expect(sin).toBe(true);
});

test('modo zoom manual: rotar no cambia la escala', async ({ page }) => {
  await abrir(page);
  await page.locator('#btn-zoom-in').click();
  await expect(page.locator('#zoom-pct')).not.toHaveText('100%');
  const antes = await page.locator('#zoom-pct').textContent();
  await abrirPestana(page, 'organizar');
  await page.locator('#btn-rotate').click();
  await expect.poll(async () => (await page.locator('.page').first().boundingBox())!.width).toBeGreaterThan(0);
  await expect(page.locator('#zoom-pct')).toHaveText(antes!);
});
