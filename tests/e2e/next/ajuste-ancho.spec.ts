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

// Revisión de PR #63: en 1440×900 (el viewport por defecto del proyecto
// `next`) "ajustar al ancho" dejaba la página unos px MÁS ANCHA que el hueco
// disponible — `Math.round` a la centésima más cercana puede REDONDEAR HACIA
// ARRIBA el factor de escala, así que `cssWidth = scale * widthPt` supera
// `disponible` en hasta medio punto porcentual (unos px en una A4). El visor
// (`overflow: auto`) responde con una barra de scroll horizontal, y como el
// contenido desborda, los márgenes automáticos (`margin: 0 auto` en `.page`,
// Viewer.layout) colapsan a un reparto asimétrico en vez de centrar: la
// página queda pegada a la derecha y el hueco gris solo se ve a la izquierda.
test('ajustar al ancho en 1440×900: sin scroll horizontal y con el mismo margen a los dos lados', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  // Los márgenes se miden contra la caja de CONTENIDO del visor (basada en
  // `clientWidth`, que excluye el hueco de la barra de scroll VERTICAL —
  // siempre a la derecha en LTR, y esperable/correcto en cualquier panel con
  // `overflow-y: auto`), no contra `getBoundingClientRect()` a secas: esa
  // incluiría el hueco del scroll en el lado derecho y haría parecer
  // "asimétrico" un centrado que en realidad es correcto.
  const medidas = async () => page.evaluate(() => {
    const v = document.getElementById('viewer')!;
    const p = document.querySelector('.page') as HTMLElement;
    const vr = v.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    const cs = getComputedStyle(v);
    const padL = parseFloat(cs.paddingLeft || '0');
    const padR = parseFloat(cs.paddingRight || '0');
    const contenidoIzq = vr.left + padL; // #viewer no tiene borde: la caja de contenido empieza en vr.left
    const contenidoDer = vr.left + v.clientWidth - padR;
    return {
      scrollWidth: v.scrollWidth,
      clientWidth: v.clientWidth,
      margenIzq: pr.left - contenidoIzq,
      margenDer: contenidoDer - pr.right
    };
  });

  await expect.poll(async () => (await medidas()).scrollWidth <= (await medidas()).clientWidth).toBe(true);
  const { margenIzq, margenDer } = await medidas();
  expect(Math.abs(margenIzq - margenDer)).toBeLessThanOrEqual(2);
});

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
