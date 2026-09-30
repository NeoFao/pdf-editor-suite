import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf'); // 2 runs

async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();
  await expect(page.locator('.run')).toHaveCount(2);
}

// A-01 (WCAG 4.1.3)
test('A-01: #status y el aviso de conversión se anuncian (aria-live polite)', async ({ page }) => {
  await page.goto('/index.next.html');
  await expect(page.locator('#status')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#status')).toHaveAttribute('role', 'status');
  await expect(page.locator('#conversion-warnings')).toHaveAttribute('aria-live', 'polite');
});

// A-03 (WCAG 2.1.1): un solo tabstop por capa de texto + flechas entre runs.
test('A-03: Tab llega a la capa de texto (un tabstop), flechas recorren los runs, Enter edita y Escape sale', async ({ page }) => {
  await abrir(page);
  const runs = page.locator('.run');
  // Roving tabindex: exactamente un run con tabindex=0, los demás -1.
  await expect(page.locator('.run[tabindex="0"]')).toHaveCount(1);
  await expect(page.locator('.run[tabindex="-1"]')).toHaveCount(1);
  await expect(runs.first()).toHaveAttribute('role', 'textbox');
  await expect(runs.first()).toHaveAttribute('aria-label', /.+/);
  await expect(page.locator('.text-layer').first()).toHaveAttribute('role', 'group');

  // Tab desde el inicio termina alcanzando el tabstop de la capa.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  let llegado = false;
  for (let i = 0; i < 80 && !llegado; i++) {
    await page.keyboard.press('Tab');
    llegado = await page.evaluate(() => document.activeElement?.classList.contains('run') ?? false);
  }
  expect(llegado, 'Tab debe alcanzar un .run').toBe(true);
  await expect(runs.first()).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(runs.nth(1)).toBeFocused();
  await expect(runs.nth(1)).toHaveAttribute('tabindex', '0');
  await expect(runs.first()).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('ArrowUp');
  await expect(runs.first()).toBeFocused();

  // Enter entra en edición; Escape sale sin cambiar el texto.
  const antes = await runs.first().textContent();
  await page.keyboard.press('Enter');
  await expect(runs.first()).toHaveClass(/editing/);
  await expect(runs.first()).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.press('Escape');
  await expect(runs.first()).not.toHaveClass(/editing/);
  expect(await runs.first().textContent()).toBe(antes);
});

// A-04
test('A-04: Texto… — foco dentro, Tab atrapado, Escape cierra y el foco vuelve al botón', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'convertir');
  const disparador = page.locator('#btn-extract-text');
  await disparador.focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('#text-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-labelledby', /.+/);
  expect(await page.evaluate(() => document.activeElement?.closest('#text-dialog') !== null)).toBe(true);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('#text-dialog') !== null), `Tab ${i}`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(disparador).toBeFocused();
});

// A-05
test('A-05: Comprimir — role=dialog modal, foco atrapado, Escape cierra y devuelve el foco', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'convertir');
  const disparador = page.locator('#btn-compress');
  await disparador.focus();
  await page.keyboard.press('Enter');
  const panel = page.locator('#compress-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('aria-modal', 'true');
  expect(await panel.evaluate((el) => el.getAttribute('role') === 'dialog' || el.tagName === 'DIALOG')).toBe(true);
  const dentro = (): Promise<boolean> => page.evaluate(() => document.activeElement?.closest('#compress-panel') !== null);
  expect(await dentro()).toBe(true);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await dentro(), `Tab ${i}`).toBe(true);
  }
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await dentro(), `Shift+Tab ${i}`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(disparador).toBeFocused();
});

// A-06
test('A-06: el canvas de cada página es role=img con "Página N"', async ({ page }) => {
  await abrir(page);
  const canvas = page.locator('.page canvas').first();
  await expect(canvas).toHaveAttribute('role', 'img');
  await expect(canvas).toHaveAttribute('aria-label', /^Página 1\b/);
});

// A-07 (WCAG 2.5.8): área clicable >= 24x24; la barra no se rompe en 390 px.
test('A-07: las muestras de color miden >= 24x24 (escritorio)', async ({ page }) => {
  await abrir(page);
  await abrirPestana(page, 'comentar');
  const swatches = page.locator('#swatches button.swatch');
  const n = await swatches.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const b = await swatches.nth(i).boundingBox();
    expect(b, `swatch ${i}`).not.toBeNull();
    expect(b!.width, `ancho swatch ${i}`).toBeGreaterThanOrEqual(24);
    expect(b!.height, `alto swatch ${i}`).toBeGreaterThanOrEqual(24);
  }
});

test.describe('móvil 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('A-07: muestras >= 24x24 y sin scroll horizontal de la página', async ({ page }) => {
    await abrir(page);
    await page.locator('#btn-more').click(); // en móvil las barras contextuales viven tras "Más"
    await expect(page.locator('#swatches button.swatch').first()).toBeVisible();
    const dim = await page.locator('#swatches button.swatch').evaluateAll((els) =>
      els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }));
    for (const [w, h] of dim) {
      expect(w).toBeGreaterThanOrEqual(24);
      expect(h).toBeGreaterThanOrEqual(24);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
