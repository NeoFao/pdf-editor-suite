import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

/** Ancho útil real del visor: su `clientWidth` (ya sin la barra de scroll) menos el padding CSS a los lados. */
async function anchoUtilViewer(page: Page): Promise<number> {
  return page.evaluate(() => {
    const v = document.getElementById('viewer')!;
    const cs = getComputedStyle(v);
    return v.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
  });
}

for (const vp of [{ width: 1000, height: 800 }, { width: 390, height: 800 }]) {
  test(`ajuste al ancho (viewport ${vp.width}px): la página ocupa el ancho útil del visor al abrir`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(FIXTURE);

    const pagina = page.locator('.page').first();
    await expect(pagina).toBeVisible();

    const util = await anchoUtilViewer(page);
    let anchoInicial = 0;
    await expect
      .poll(async () => { anchoInicial = (await pagina.boundingBox())!.width; return Math.abs(anchoInicial - util); })
      .toBeLessThanOrEqual(4);

    // Acercar cambia el ancho en pantalla…
    await page.locator('#btn-zoom-in').click();
    await expect.poll(async () => (await pagina.boundingBox())!.width).toBeGreaterThan(anchoInicial + 5);

    // …y #btn-fit-width lo vuelve a ajustar al ancho útil.
    await page.locator('#btn-fit-width').click();
    await expect
      .poll(async () => Math.abs((await pagina.boundingBox())!.width - util))
      .toBeLessThanOrEqual(4);
  });
}
