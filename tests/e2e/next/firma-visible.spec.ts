import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIX = (n: string) => path.resolve(AQUI, '../../fixtures/generados/' + n);

/**
 * Una firma recién insertada tiene que quedar en la PARTE VISIBLE de la página actual y
 * SELECCIONADA (con tiradores), para colocarla enseguida (E-070). Antes se centraba en la
 * página entera: en una página alta o con zoom la firma caía fuera del visor y el usuario
 * no veía nada. Medido en px CSS de viewport (getBoundingClientRect).
 */
async function abrir(page: Page, fixture: string, zoomClics: number, scrollFrac: number): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIX(fixture));
  await expect(page.locator('.run').first()).toBeVisible();
  for (let i = 0; i < zoomClics; i++) await page.locator('#btn-zoom-in').click();
  // Deja a la vista una franja de la mitad de la página 1 (fracción de su alto).
  await page.locator('#viewer').evaluate((v, f) => {
    const p = v.querySelector('.page') as HTMLElement;
    v.scrollTop = p.offsetTop + p.offsetHeight * f - v.clientHeight / 2;
  }, scrollFrac);
  await abrirPestana(page, 'firmar');
}

async function dibujar(page: Page, guardar: string | null): Promise<void> {
  await page.locator('#btn-sign').click();
  const b = (await page.locator('#sig-canvas').boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + 40);
  await page.mouse.down();
  await page.mouse.move(b.x + 200, b.y + 110, { steps: 8 });
  await page.mouse.move(b.x + 320, b.y + 60, { steps: 8 });
  await page.mouse.up();
  if (guardar) { await page.locator('#sig-guardar').check(); await page.locator('#sig-nombre').fill(guardar); }
  await page.locator('#sig-confirm').click();
}

async function comprobarVisibleYSeleccionada(page: Page): Promise<void> {
  const caja = page.locator('.image-box.selected');
  await expect(caja).toHaveCount(1);
  await page.waitForTimeout(400); // deja terminar cualquier desplazamiento del visor
  const v = (await page.locator('#viewer').boundingBox())!;
  const b = (await caja.boundingBox())!;
  expect(b.x, 'borde izquierdo dentro del visor').toBeGreaterThanOrEqual(v.x - 1);
  expect(b.y, 'borde superior dentro del visor').toBeGreaterThanOrEqual(v.y - 1);
  expect(b.x + b.width, 'borde derecho dentro del visor').toBeLessThanOrEqual(v.x + v.width + 1);
  expect(b.y + b.height, 'borde inferior dentro del visor').toBeLessThanOrEqual(v.y + v.height + 1);
}

test('firma dibujada con zoom alto: queda dentro del visor y seleccionada', async ({ page }) => {
  await abrir(page, 'nativo.pdf', 4, 0.45);
  await dibujar(page, null);
  await comprobarVisibleYSeleccionada(page);
});

test('firma desde imagen con zoom alto: queda dentro del visor y seleccionada', async ({ page }) => {
  await abrir(page, 'nativo.pdf', 4, 0.45);
  await page.locator('#btn-sign-upload').setInputFiles(FIX('firma-blanca.png'));
  await expect(page.locator('#status')).toContainText('Firma insertada desde imagen');
  await comprobarVisibleYSeleccionada(page);
});

test('firma guardada con zoom alto: queda dentro del visor y seleccionada', async ({ page }) => {
  await abrir(page, 'nativo.pdf', 4, 0.2);
  await dibujar(page, 'Visible');
  await expect(page.locator('#status')).toContainText('Firma insertada');
  // Cambia la zona visible y la inserta de nuevo desde «Mis firmas».
  await page.locator('#viewer').evaluate((v) => { v.scrollTop += 500; });
  await page.locator('#btn-mis-firmas').click();
  await page.getByRole('button', { name: 'Insertar firma «Visible»' }).click();
  await expect(page.locator('#status')).toHaveText('Firma «Visible» insertada.');
  await comprobarVisibleYSeleccionada(page);
});

test('grande.pdf a media página: la firma dibujada cae en la franja visible', async ({ page }) => {
  await abrir(page, 'grande.pdf', 2, 0.5);
  await dibujar(page, null);
  await comprobarVisibleYSeleccionada(page);
});
