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
  // 1024x768 (escritorio, con pestañas): con 1440x900 cada clic de zoom repinta ~8 Mpx y a CPU x6 los 4 clics
  // se comían 26 s de los 60 s del test (E-107). La página sigue desbordando el visor en los dos ejes.
  await page.setViewportSize({ width: 1024, height: 768 });
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
  // El visor puede seguir desplazándose (scroll suave) justo después de insertar: se espera a la condición
  // (ningún borde fuera del visor), no a un tiempo fijo (E-091, E-107).
  await expect.poll(async () => {
    const v = (await page.locator('#viewer').boundingBox())!;
    const b = (await caja.boundingBox())!;
    const fuera: string[] = [];
    if (b.x < v.x - 1) fuera.push('izquierdo');
    if (b.y < v.y - 1) fuera.push('superior');
    if (b.x + b.width > v.x + v.width + 1) fuera.push('derecho');
    if (b.y + b.height > v.y + v.height + 1) fuera.push('inferior');
    return fuera;
  }, 'bordes de la firma fuera del visor').toEqual([]);
}

test('firma dibujada con zoom alto: queda dentro del visor y seleccionada', async ({ page }) => {
  await abrir(page, 'nativo.pdf', 3, 0.45);
  await dibujar(page, null);
  await comprobarVisibleYSeleccionada(page);
});

test('firma desde imagen con zoom alto: queda dentro del visor y seleccionada', async ({ page }) => {
  await abrir(page, 'nativo.pdf', 3, 0.45);
  await page.locator('#btn-sign-upload').setInputFiles(FIX('firma-blanca.png'));
  await expect(page.locator('#status')).toContainText('Firma insertada desde imagen');
  await comprobarVisibleYSeleccionada(page);
});

test('firma guardada con zoom alto: queda dentro del visor y seleccionada', async ({ page }) => {
  await abrir(page, 'nativo.pdf', 3, 0.2);
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
