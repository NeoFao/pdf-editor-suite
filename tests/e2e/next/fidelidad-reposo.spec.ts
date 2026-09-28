import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');

// E-029: la capa de texto pintaba el texto VISIBLE en negro sans-serif encima
// del canvas, donde el motor ya lo había pintado con su fuente real. Estos
// tests fijan el contrato: en reposo la capa es invisible (prueba de oro de
// píxeles); solo al editar se hace visible, con la mejor aproximación de la
// tipografía real.

test('fidelidad-reposo: en reposo la capa de texto no altera ni un píxel del render del motor', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const runs = page.locator('.run');
  await expect(runs.first()).toBeVisible();
  await expect(runs).toHaveCount(2);

  const wrapper = page.locator('.page').first();
  const antes = await wrapper.screenshot();

  // Oculta toda la capa de texto por script, sin tocar el canvas de abajo.
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('.run').forEach((el) => { el.style.visibility = 'hidden'; });
  });
  const despues = await wrapper.screenshot();

  expect(Buffer.compare(antes, despues)).toBe(0);
});

test('fidelidad-reposo: color transparente y tirador oculto en reposo', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await expect(run).toBeVisible();

  const color = await run.evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe('rgba(0, 0, 0, 0)');

  const handleOpacity = await run.locator('.run-drag').evaluate((el) => getComputedStyle(el).opacity);
  expect(handleOpacity).toBe('0');
});

test('fidelidad-reposo: al editar aparece la tipografía real de la línea; Escape vuelve a transparente', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  const run = page.locator('.run', { hasText: 'ORIGINAL-TIMES' });
  await expect(run).toBeVisible();

  await run.click();

  const estiloEdicion = await run.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { background: cs.backgroundColor, color: cs.color, fontFamily: cs.fontFamily, fontSize: cs.fontSize };
  });
  expect(estiloEdicion.background).toBe('rgb(255, 255, 255)');
  // Times, rojo (0.85, 0.1, 0.1) en el fixture.
  expect(estiloEdicion.color).toMatch(/^rgb\(2\d\d, \d{1,2}, \d{1,2}\)$/);
  expect(estiloEdicion.fontFamily).toContain('serif');
  expect(estiloEdicion.fontFamily).not.toContain('sans-serif');
  const size = parseFloat(estiloEdicion.fontSize);
  expect(size).toBeGreaterThan(17); // 18pt × escala 1, tolerancia ±1px
  expect(size).toBeLessThan(19);

  await page.keyboard.press('Escape');
  const colorTrasEscape = await run.evaluate((el) => getComputedStyle(el).color);
  expect(colorTrasEscape).toBe('rgba(0, 0, 0, 0)');
});
