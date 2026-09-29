import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

/**
 * Revisión de PR #63 (capturas 12-movil-cajon): las miniaturas se
 * renderizaban a una resolución fija (120/90 px según orientación) y luego
 * se estiraban con CSS (`.thumb { width: 100% }`) al ancho real del panel —
 * hasta 320px en el cajón móvil, ~150px en el panel de escritorio — así que
 * en cualquier pantalla con `devicePixelRatio` > 1 (o simplemente un panel
 * más ancho que el objetivo fijo de 120/90px) se veían borrosas.
 *
 * `buildThumbnails()` ahora mide el ancho REAL en que se muestran
 * (`App.anchoUtilThumbs()`) y renderiza a ese ancho × `devicePixelRatio`
 * (con tope). El bitmap (`canvas.width`) tiene que ser, como mínimo, el
 * ancho CSS de la miniatura × `devicePixelRatio` (con un 10% de margen para
 * el redondeo del propio motor al convertir puntos PDF a píxeles).
 */
async function comprobarNitidez(page: import('@playwright/test').Page): Promise<void> {
  const medidas = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.thumb') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return { bitmapWidth: canvas.width, cssWidth: rect.width, dpr: window.devicePixelRatio || 1 };
  });
  expect(medidas.bitmapWidth).toBeGreaterThanOrEqual(medidas.cssWidth * medidas.dpr * 0.9);
}

test('miniaturas nítidas en el panel de escritorio: el bitmap cubre el ancho real mostrado', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('canvas.thumb').first()).toBeVisible();
  await comprobarNitidez(page);
});

test('miniaturas nítidas en el cajón móvil (390×844), incluso tras abrirlo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  await page.locator('#btn-drawer').click();
  await expect(page.locator('#sidebar')).toHaveClass(/abierto/);
  await expect(page.locator('canvas.thumb').first()).toBeVisible();
  await comprobarNitidez(page);
});
