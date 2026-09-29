import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const GRANDE = path.resolve(AQUI, '../../fixtures/generados/grande.pdf'); // 500 páginas A4, texto único por página ("Pagina N")

/**
 * E-043/E-044 (docs/ERRORES-CONOCIDOS.md): todas las fixtures anteriores
 * tenían 1-4 páginas — muy por debajo de un contrato o manual real (300-1000
 * páginas), que Acrobat abre al instante. Antes del arreglo, abrir un
 * documento de 500 páginas: (a) renderizaba las 500 miniaturas de golpe,
 * (b) leía el texto (`getPageText`, la llamada más cara por página del
 * motor) de las 500 páginas al abrir, y (e) cualquier comando de una sola
 * página (rotar) repetía TODO ese trabajo de nuevo vía `refresh()`.
 *
 * Diagnóstico de solo lectura: `window.__diagnostico = { renderPage,
 * getPageText }` — contadores de cuántas veces se llamó de verdad al motor.
 * Se activa SOLO con `?diagnostico=1` en la URL (ver `src/diagnostico.ts`),
 * para no dejar rastro en producción; aquí es la forma de comprobar "no se
 * llamó al motor para las 500 páginas" sin depender de tiempos de reloj.
 */

test.describe('documento grande (500 páginas): apertura y comandos perezosos', () => {
  test('abrir no renderiza ni lee el texto de las 500 páginas de golpe', async ({ page }) => {
    await page.goto('/index.next.html?diagnostico=1');
    await page.locator('#file-input').setInputFiles(GRANDE);
    await expect(page.locator('.run').first()).toBeVisible();
    // Deja que el IntersectionObserver de las miniaturas termine su primera pasada.
    await page.waitForTimeout(200);

    const diag = await page.evaluate(() => (window as unknown as { __diagnostico: { renderPage: number; getPageText: number } }).__diagnostico);

    // Ni de lejos las 500 páginas: solo las visibles en el visor + las
    // miniaturas visibles/precargadas (rootMargin), con margen.
    expect(diag.renderPage).toBeGreaterThan(0);
    expect(diag.renderPage).toBeLessThan(40);
    expect(diag.getPageText).toBeGreaterThan(0);
    expect(diag.getPageText).toBeLessThan(20);

    // Las miniaturas SÍ existen todas como placeholders (el scroll del panel
    // mide bien desde el principio), aunque no estén todas pintadas.
    await expect(page.locator('#thumbs canvas.thumb')).toHaveCount(500);
  });

  test('el diagnóstico está apagado por defecto (sin ?diagnostico=1)', async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(GRANDE);
    await expect(page.locator('.run').first()).toBeVisible();

    const diag = await page.evaluate(() => (window as unknown as { __diagnostico?: unknown }).__diagnostico);
    expect(diag).toBeUndefined();
  });

  test('rotar la página 1 no re-renderiza ni relee las 500 páginas', async ({ page }) => {
    await page.goto('/index.next.html?diagnostico=1');
    await page.locator('#file-input').setInputFiles(GRANDE);
    await expect(page.locator('.run').first()).toBeVisible();
    await page.waitForTimeout(200);

    const antes = await page.evaluate(() => ({ ...(window as unknown as { __diagnostico: { renderPage: number; getPageText: number } }).__diagnostico }));

    await abrirPestana(page, 'organizar');
    await page.locator('#btn-rotate').click();
    // Sin señal específica que esperar (el propio efecto es "poco trabajo"):
    // deja un instante a que el re-render de la página actual termine.
    await page.waitForTimeout(150);

    const despues = await page.evaluate(() => ({ ...(window as unknown as { __diagnostico: { renderPage: number; getPageText: number } }).__diagnostico }));

    // Rotar UNA página cuesta un puñado de llamadas (esa página + quizá su
    // miniatura), nunca 500.
    expect(despues.getPageText - antes.getPageText).toBeLessThan(5);
    expect(despues.renderPage - antes.renderPage).toBeLessThan(5);
  });

  test('saltar a la página 400 por miniatura la pinta y actualiza el indicador', async ({ page }) => {
    await page.goto('/index.next.html?diagnostico=1');
    await page.locator('#file-input').setInputFiles(GRANDE);
    await expect(page.locator('.run').first()).toBeVisible();

    // Playwright hace scroll hasta el elemento antes de pulsarlo: eso basta
    // para que el IntersectionObserver de miniaturas la pinte antes del clic.
    await page.locator('#thumbs canvas.thumb').nth(399).click();

    await expect(page.locator('#page-indicator')).toHaveText('400 / 500');
    await expect(page.getByText('Pagina 400', { exact: true })).toBeVisible();
  });

  test('buscar "Pagina 499" encuentra la coincidencia sin bloquear el hilo principal', async ({ page }) => {
    await page.goto('/index.next.html?diagnostico=1');
    await page.locator('#file-input').setInputFiles(GRANDE);
    await expect(page.locator('.run').first()).toBeVisible();

    await page.locator('#btn-search').fill('Pagina 499');

    // Aserción ESTRUCTURAL, no de tiempo (docs/TESTING.md, E-040): un
    // requestAnimationFrame programado justo después de lanzar la búsqueda
    // tiene que ejecutarse ANTES de que la búsqueda termine — si el bucle de
    // 500 páginas bloqueara el hilo principal sin ceder, ese frame nunca
    // llegaría a pintarse hasta que la búsqueda ya hubiera terminado.
    const rafGanoLaCarrera = await Promise.race([
      page.evaluate(() => new Promise<boolean>((resolve) => requestAnimationFrame(() => resolve(true)))),
      page.waitForFunction(() => (document.querySelector('#status')?.textContent ?? '').includes('coincidencia')).then(() => false)
    ]);
    expect(rafGanoLaCarrera).toBe(true);

    await expect(page.locator('#status')).toContainText('coincidencia');
    await expect(page.locator('.search-hl').first()).toBeVisible();
  });
});
