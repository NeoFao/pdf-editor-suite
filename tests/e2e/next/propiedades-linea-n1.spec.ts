import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const POR_GLIFO = path.resolve(AQUI, '../../fixtures/generados/por-glifo.pdf');

/**
 * N1 F4 (4): el panel de propiedades cambia color, tamaño y fuente de una línea COMPUESTA (un objeto por glifo) entera,
 * en un solo paso de deshacer. `por-glifo.pdf`: «Columna izquierda uno» son 21 objetos de Helvetica 11 pt.
 */
async function seleccionarLinea(page: Page, texto = 'Columna izquierda uno') {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(POR_GLIFO);
  const run = page.locator('.run', { hasText: texto });
  await run.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#props-panel')).toBeVisible();
  return run;
}

/** Píxeles «azules» (b alto, r y g bajos) del canvas de la primera página. */
async function pixelesAzules(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.page canvas')!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 2]! > 200 && d[i]! < 80 && d[i + 1]! < 80) n++;
    return n;
  });
}

test('color: toda la línea cambia de color y UN Deshacer lo restaura', async ({ page }) => {
  await seleccionarLinea(page);
  await page.waitForTimeout(300);
  expect(await pixelesAzules(page)).toBe(0);
  await page.locator('#btn-color').fill('#0000ff');
  await expect(page.locator('#status')).toHaveText('Color aplicado.');
  await expect.poll(() => pixelesAzules(page)).toBeGreaterThan(100);
  await page.locator('#btn-undo').click();
  await expect.poll(() => pixelesAzules(page)).toBe(0);
});

test('tamaño: la línea entera se escala (ancho × k) y Deshacer la devuelve', async ({ page }) => {
  const run = await seleccionarLinea(page);
  const antes = (await run.boundingBox())!;
  await page.locator('#prop-size').fill('22');
  await page.locator('#prop-size').dispatchEvent('change');
  await expect(page.locator('#status')).toHaveText('Tamaño cambiado.');
  await expect(page.locator('#prop-size')).toHaveValue('22');
  const nuevo = page.locator('.run', { hasText: 'Columna izquierda uno' });
  await expect.poll(async () => (await nuevo.boundingBox())!.width / antes.width).toBeGreaterThan(1.8);
  const despues = (await nuevo.boundingBox())!;
  expect(despues.width / antes.width).toBeLessThan(2.2);
  expect(Math.abs(despues.x - antes.x)).toBeLessThan(2); // el origen de la línea no se mueve
  await page.locator('#btn-undo').click();
  await expect.poll(async () => Math.abs((await page.locator('.run', { hasText: 'Columna izquierda uno' }).boundingBox())!.width - antes.width)).toBeLessThan(1);
});

test('fuente: toda la línea pasa a Courier, sigue leyéndose igual y Deshacer la devuelve', async ({ page }) => {
  await seleccionarLinea(page);
  await page.locator('#prop-font').selectOption('Courier');
  await expect(page.locator('#status')).toHaveText('Fuente cambiada a Courier.');
  await expect(page.locator('.run', { hasText: 'Columna izquierda uno' })).toHaveText('Columna izquierda uno');
  // Una sola .run para la línea (UN objeto ahora) y las demás líneas siguen ahí.
  await expect(page.locator('.page').first().locator('.run')).toHaveCount(20);
  await page.locator('#btn-undo').click();
  await expect(page.locator('.run', { hasText: 'Columna izquierda uno' })).toHaveText('Columna izquierda uno');
});

test('una línea multiestilo conserva su color de tramo al cambiar el tamaño', async ({ page }) => {
  await seleccionarLinea(page, 'Estilo mixto: normal NEGRITA y fin.');
  await page.locator('#prop-size').fill('16.5');
  await page.locator('#prop-size').dispatchEvent('change');
  await expect(page.locator('#status')).toHaveText('Tamaño cambiado.');
  const run = page.locator('.run', { hasText: 'Estilo mixto: normal NEGRITA y fin.' });
  await run.click(); // edita: el editor pinta los tramos con su estilo
  await expect(run.locator('.run-estilo')).toHaveCount(3);
  const rojo = await run.locator('.run-estilo').nth(1).evaluate((e) => getComputedStyle(e).color);
  expect(rojo).toBe('rgb(255, 0, 0)');
});
