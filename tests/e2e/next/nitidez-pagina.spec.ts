import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FUENTES = path.resolve(AQUI, '../../fixtures/generados/fuentes.pdf');
// Página grande (A4): ajustada al ancho ya roza el límite de píxeles a DPR alto.
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

/** Ancho de bitmap del canvas de la primera página y ancho CSS con el que se muestra. */
async function medir(page: Page): Promise<{ bitmap: number; css: number; alto: number; altoCss: number; dpr: number }> {
  return page.evaluate(() => {
    const cv = document.querySelector('.page canvas') as HTMLCanvasElement;
    const r = cv.getBoundingClientRect();
    return { bitmap: cv.width, css: r.width, alto: cv.height, altoCss: r.height, dpr: window.devicePixelRatio };
  });
}

async function abrir(page: Page, pdf = FUENTES): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(pdf);
  await expect(page.locator('.run').first()).toBeVisible();
}

test.describe('DPR 2', () => {
  test.use({ deviceScaleFactor: 2 });

  test('nitidez: el bitmap de la página es ancho CSS x 2 y el tamaño CSS no cambia (N3)', async ({ page }) => {
    await abrir(page);
    const m = await medir(page);
    expect(m.dpr).toBe(2);
    expect(m.bitmap / m.css).toBeGreaterThan(1.98);
    expect(m.bitmap / m.css).toBeLessThan(2.02);
    expect(m.alto / m.altoCss).toBeGreaterThan(1.98);
    // El `.page` conserva su tamaño: el canvas no lo desborda.
    const wrapper = (await page.locator('.page').first().boundingBox())!;
    expect(Math.abs(wrapper.width - m.css)).toBeLessThan(1.5);
  });

  test('nitidez: la prueba de oro de reposo sigue en verde con DPR 2 (E-029)', async ({ page }) => {
    await abrir(page);
    await expect(page.locator('.run')).toHaveCount(2);
    const wrapper = page.locator('.page').first();
    const antes = await wrapper.screenshot({ animations: 'disabled' });
    await page.evaluate(() => { document.querySelectorAll<HTMLElement>('.run').forEach((el) => { el.style.visibility = 'hidden'; }); });
    const despues = await wrapper.screenshot({ animations: 'disabled' });
    expect(Buffer.compare(antes, despues)).toBe(0);
  });

  test('nitidez: al cambiar el DPR en caliente (zoom del navegador) la página se vuelve a pintar (N3)', async ({ page }) => {
    await abrir(page);
    expect((await medir(page)).bitmap / (await medir(page)).css).toBeGreaterThan(1.98);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    // La emulación por CDP cambia el DPR sin avisar a `matchMedia`; el zoom real también dispara `resize`.
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await expect.poll(async () => { const m = await medir(page); return m.bitmap / m.css; }).toBeLessThan(1.05);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await expect.poll(async () => { const m = await medir(page); return m.bitmap / m.css; }).toBeGreaterThan(1.98);
  });
});

test.describe('DPR 1', () => {
  test.use({ deviceScaleFactor: 1 });

  test('nitidez: con DPR 1 el bitmap sigue siendo 1:1 con el CSS', async ({ page }) => {
    await abrir(page);
    const m = await medir(page);
    expect(m.bitmap / m.css).toBeGreaterThan(0.99);
    expect(m.bitmap / m.css).toBeLessThan(1.01);
  });

  test('nitidez: la prueba de oro de reposo sigue en verde con DPR 1 (E-029)', async ({ page }) => {
    await abrir(page);
    await expect(page.locator('.run')).toHaveCount(2);
    const wrapper = page.locator('.page').first();
    const antes = await wrapper.screenshot({ animations: 'disabled' });
    await page.evaluate(() => { document.querySelectorAll<HTMLElement>('.run').forEach((el) => { el.style.visibility = 'hidden'; }); });
    const despues = await wrapper.screenshot({ animations: 'disabled' });
    expect(Buffer.compare(antes, despues)).toBe(0);
  });
});

test.describe('DPR 3', () => {
  test.use({ deviceScaleFactor: 3 });

  test('nitidez: el factor se acota (DPR máx. 2,5) y el bitmap respeta el límite de píxeles por página', async ({ page }) => {
    await abrir(page, NATIVO);
    const m = await medir(page);
    expect(m.bitmap / m.css).toBeLessThanOrEqual(2.51);
    expect(m.bitmap / m.css).toBeGreaterThan(1.4);
    // Con mucho zoom manual el límite de píxeles manda: nunca más de 8 Mpx por página.
    for (let i = 0; i < 6; i++) await page.locator('#btn-zoom-in').click();
    await expect.poll(async () => { const z = await medir(page); return z.css; }).toBeGreaterThan(m.css * 1.2);
    const z = await medir(page);
    expect(z.bitmap * z.alto).toBeLessThanOrEqual(Math.max(8_000_000, z.css * z.altoCss) * 1.02);
  });
});
