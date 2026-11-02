import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// E-115: Mayús+flecha cruza páginas. Al agotar el texto de la página N el foco pasa a la N+1 (y al revés);
// Mayús+↓/↑ cae en la primera/última línea de la contigua conservando la x; sobre una selección multipágina
// del ratón se mueve el FOCO y el ancla se queda; el visor trae la página del foco a la vista; y la página
// destino puede no estar pintada (los caracteres vienen del modelo, no del DOM).
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MULTI = path.resolve(AQUI, '../../fixtures/generados/seleccion-multipagina.pdf');

async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(MULTI);
  await expect(page.locator('.run').first()).toBeVisible();
}

/** Enfoca una línea (roving tabindex): las teclas de selección actúan sobre la línea enfocada. */
async function enfocar(page: Page, texto: string): Promise<void> {
  await page.locator('.run', { hasText: texto }).focus();
  await expect(page.locator('.run:focus')).toContainText(texto);
}

async function pulsar(page: Page, tecla: string, veces: number): Promise<void> {
  for (let i = 0; i < veces; i++) await page.keyboard.press(tecla);
}

async function copiar(page: Page): Promise<string> {
  await page.keyboard.press('Control+c');
  return page.evaluate(() => navigator.clipboard.readText());
}

test('Mayús+→ desde el final de p1 pasa a p2: la selección incluye su principio, se copia exacto y p2 queda a la vista', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await abrir(page);
  await enfocar(page, 'Alfa tres');
  await pulsar(page, 'Shift+ArrowRight', 9); // "Alfa tres" entera: aún dentro de p1
  expect(await copiar(page)).toBe('Alfa tres');
  await pulsar(page, 'Shift+ArrowRight', 3); // cruza a p2: "Bet"
  expect(await copiar(page)).toBe('Alfa tres\nBet');
  await expect(page.locator('.page').nth(1).locator('.sel-rect')).toHaveCount(1);
  await expect(page.locator('.page').nth(1).locator('.sel-rect')).toBeInViewport();
});

test('Mayús+← desde el principio de p2 vuelve a p1: el foco queda antes que el ancla', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await abrir(page);
  await enfocar(page, 'Beta uno');
  await pulsar(page, 'Shift+ArrowLeft', 8); // "Beta uno" entera (el ancla es el final de la línea)
  expect(await copiar(page)).toBe('Beta uno');
  await pulsar(page, 'Shift+ArrowLeft', 3); // cruza a p1: "res"
  expect(await copiar(page)).toBe('res\nBeta uno');
  await expect(page.locator('.page').nth(0).locator('.sel-rect')).toHaveCount(1);
});

test('Mayús+↓ desde la última línea de p1 cae en la primera de p2 conservando la columna', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await abrir(page);
  await enfocar(page, 'Alfa tres');
  await pulsar(page, 'Shift+ArrowRight', 3); // foco en la columna de "Alf|"
  await page.keyboard.press('Shift+ArrowDown');
  const [primera, resto] = (await copiar(page)).split('\n');
  expect(primera).toBe('Alfa tres');
  // Mismo x: un prefijo corto (no vacío, no la línea entera) de la primera línea de p2.
  expect(resto!.length).toBeGreaterThan(0);
  expect(resto!.length).toBeLessThan('Beta uno'.length);
  expect('Beta uno'.startsWith(resto!)).toBe(true);
  await expect(page.locator('.page').nth(1).locator('.sel-rect')).toHaveCount(1);
});

test('una selección de ratón de p1 a p2 + Mayús+→: el ancla no cambia y el foco avanza', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await abrir(page);
  for (let k = 0; k < 8; k++) {
    const ultima = await page.locator('.page').nth(2).boundingBox();
    if (ultima && ultima.y + ultima.height < 880) break;
    await page.locator('#btn-zoom-out').click();
  }
  const a = (await page.locator('.run', { hasText: 'Alfa dos' }).boundingBox())!;
  const b = (await page.locator('.run', { hasText: 'Beta uno' }).boundingBox())!;
  await page.mouse.move(a.x + a.width * 0.3, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width * 0.3 + 12, a.y + a.height / 2 + 4, { steps: 3 });
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  const antes = await copiar(page);
  expect(antes.split('\n').length).toBe(3); // cola de "Alfa dos", "Alfa tres" y el principio de "Beta uno"
  await enfocar(page, 'Alfa tres');
  await pulsar(page, 'Shift+ArrowRight', 2);
  const despues = await copiar(page);
  expect(despues.startsWith(antes)).toBe(true); // el ancla (principio) no se movió: solo creció por el final
  expect(despues.length).toBe(antes.length + 2);
  expect('Beta uno'.includes(despues.split('\n').pop()!)).toBe(true);
  await expect(page.locator('.page').nth(0).locator('.sel-rect')).toHaveCount(2); // p1: "Alfa dos" (cola) y "Alfa tres"
});

test('la página destino sin capa pintada funciona igual: la selección sobrevive a pintarla', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1000, height: 400 });
  await abrir(page);
  await expect(page.locator('.page').nth(2).locator('canvas')).toHaveCount(0); // p3 aún sin pintar
  await enfocar(page, 'Alfa tres');
  await pulsar(page, 'Shift+ArrowDown', 5); // p2 L1, L2, L3, p3 L1, y la columna 0 de p3 L2
  await expect(page.locator('.page').nth(2).locator('canvas')).toHaveCount(1); // goToPage la trajo y la pintó
  expect(await copiar(page)).toBe('Alfa tres\nBeta uno\nBeta dos\nBeta tres\nGamma uno');
  // La selección se repinta sobre la página recién pintada (no se descartó, E-057 solo vale para repintados).
  await expect(page.locator('.page').nth(2).locator('.sel-rect')).toHaveCount(1);
  await expect(page.locator('.page').nth(2).locator('.sel-rect')).toBeInViewport();
});
