import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

/**
 * Las tres pestañas del panel lateral (Páginas, Marcadores, Comentarios) tienen
 * que caber enteras en el ancho del panel: con 168 px la primera quedaba
 * recortada por la izquierda al enfocar la última (E-051). Medido en px CSS de
 * viewport (getBoundingClientRect), sin aritmética de canvas ni de puntos PDF.
 */
test('las tres pestañas del panel lateral caben dentro del panel, sin recorte ni desplazamiento', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(NATIVO);
  await expect(page.locator('.run').first()).toBeVisible();

  const panel = await page.locator('#sidebar').boundingBox();
  expect(panel).not.toBeNull();
  for (const id of ['tab-pages', 'tab-outline', 'tab-comments']) {
    await page.locator('#' + id).click();
    const caja = await page.locator('#' + id).boundingBox();
    expect(caja, id).not.toBeNull();
    expect(caja!.x, `${id} no se sale por la izquierda`).toBeGreaterThanOrEqual(panel!.x - 0.5);
    expect(caja!.x + caja!.width, `${id} no se sale por la derecha`).toBeLessThanOrEqual(panel!.x + panel!.width + 0.5);
    // El texto de la pestaña no queda truncado (scrollWidth == clientWidth).
    const truncada = await page.locator('#' + id).evaluate((e) => e.scrollWidth > e.clientWidth);
    expect(truncada, `${id} sin texto truncado`).toBe(false);
  }
  expect(await page.locator('#sidebar').evaluate((e) => e.scrollLeft)).toBe(0);
});
