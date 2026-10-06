import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');
const IMG = path.resolve(AQUI, '../../fixtures/generados/rojo.png');

/** Móvil real: pantalla táctil y 390x844. Los toques van por CDP (`Input.dispatchTouchEvent`), que SÍ respeta `touch-action`. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** Arrastra un dedo de (x0,y0) a (x1,y1) con pasos intermedios. */
async function arrastrarConDedo(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  const pasos = 12;
  for (let i = 1; i <= pasos; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x0 + ((x1 - x0) * i) / pasos, y: y0 + ((y1 - y0) * i) / pasos }]
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function abrir(page: Page): Promise<void> {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(PDF);
  await expect(page.locator('.run').first()).toBeVisible();
}

test('táctil: con Rectángulo activo, arrastrar con el dedo dibuja el rectángulo y se puede deshacer (N2)', async ({ page }) => {
  await abrir(page);
  await page.locator('#viewer').focus();
  await page.keyboard.press('r');
  await expect(page.locator('#btn-rect')).toHaveAttribute('aria-pressed', 'true');

  const caja = (await page.locator('.page').first().boundingBox())!;
  await arrastrarConDedo(page, caja.x + 60, caja.y + 220, caja.x + 220, caja.y + 300);

  await expect(page.locator('#status')).toHaveText('Rectángulo dibujado.');
  await page.keyboard.press('Control+Z');
  await expect(page.locator('#status')).toHaveText('Deshecho: Rectángulo');
});

test('táctil: con la herramienta «ninguna», arrastrar el dedo hace scroll del visor (N2)', async ({ page }) => {
  await abrir(page);
  const antes = await page.locator('#viewer').evaluate((el) => el.scrollTop);
  const caja = (await page.locator('.page').first().boundingBox())!;
  // En un hueco sin líneas de texto, de abajo hacia arriba (scroll hacia el final).
  await arrastrarConDedo(page, caja.x + 20, caja.y + 600, caja.x + 20, caja.y + 300);
  await expect.poll(() => page.locator('#viewer').evaluate((el) => el.scrollTop)).toBeGreaterThan(antes + 50);
});

test('táctil: con la imagen seleccionada, arrastrarla con el dedo la mueve y no desplaza el visor (N2)', async ({ page }) => {
  await abrir(page);
  await page.locator('#btn-insert-image').setInputFiles(IMG);
  await expect(page.locator('#status')).toHaveText('Imagen insertada.');
  // Un toque la selecciona (la selección es lo que activa `touch-action: none`: el scroll normal con el dedo no se rompe).
  const sinSel = page.locator('.image-box');
  await expect(sinSel).toHaveCount(1);
  const b0 = (await sinSel.boundingBox())!;
  await page.touchscreen.tap(b0.x + b0.width / 2, b0.y + b0.height / 2);
  const caja = page.locator('.image-box.selected');
  await expect(caja).toHaveCount(1);
  await expect(caja).toHaveCSS('touch-action', 'none');

  const antesScroll = await page.locator('#viewer').evaluate((el) => el.scrollTop);
  const b = (await caja.boundingBox())!;
  const antes = b.y;
  await arrastrarConDedo(page, b.x + b.width / 2, b.y + b.height / 2, b.x + b.width / 2, b.y + b.height / 2 + 60);

  await expect.poll(async () => (await page.locator('.image-box').boundingBox())!.y).toBeGreaterThan(antes + 30);
  expect(await page.locator('#viewer').evaluate((el) => el.scrollTop)).toBe(antesScroll);
  await expect(page.locator('#status')).toContainText('Imagen movida');
});
