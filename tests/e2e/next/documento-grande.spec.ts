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

type Diagnostico = { renderPage: number; getPageText: number; paginasPintadas: number };
const leerDiagnostico = () => (window as unknown as { __diagnostico: Diagnostico }).__diagnostico;

/**
 * Recorre `#viewer` de arriba abajo (o abajo a arriba) en `pasos` tramos,
 * fijando `scrollTop` directamente (dispara el evento nativo 'scroll' del
 * navegador en cada paso, igual que un scroll real) y dejando un respiro
 * entre tramos para que `Viewer.renderVisible()`/`evictFarPages()`
 * reaccionen — "saltos... esperando a que pinte cada tramo" del encargo.
 * No usa clic en miniaturas a propósito: un clic en otra parte del
 * documento dispara `blur` sobre cualquier `.run` en edición, lo que
 * confundiría el test de "una edición en curso no se desaloja" de más abajo.
 */
async function recorrerViewer(page: import('@playwright/test').Page, pasos: number, direccion: 1 | -1 = 1): Promise<void> {
  await page.evaluate(
    async ({ pasos, direccion }) => {
      const el = document.getElementById('viewer')!;
      const max = el.scrollHeight - el.clientHeight;
      for (let i = 1; i <= pasos; i++) {
        const frac = direccion === 1 ? i / pasos : 1 - i / pasos;
        el.scrollTop = Math.round(max * frac);
        el.dispatchEvent(new Event('scroll'));
        await new Promise((r) => setTimeout(r, 30));
      }
    },
    { pasos, direccion }
  );
}

/**
 * E-045 (docs/ERRORES-CONOCIDOS.md): el visor ya era perezoso al PINTAR
 * (E-043: `renderVisible()` solo renderiza lo visible), pero `Viewer.rendered`
 * solo CRECÍA — nada desalojaba una página que salía de la vista. Recorrer
 * un documento de 500 páginas dejaba los 500 `<canvas>` (bitmap RGBA
 * completo) vivos en memoria a la vez.
 */
test.describe('documento grande: desalojo de páginas lejanas del visor (E-045)', () => {
  test('recorrer las 500 páginas mantiene acotado el nº de páginas pintadas a la vez', async ({ page }) => {
    await page.goto('/index.next.html?diagnostico=1');
    await page.locator('#file-input').setInputFiles(GRANDE);
    await expect(page.locator('.run').first()).toBeVisible();

    await recorrerViewer(page, 20, 1); // de la página 1 a la 500, en 20 tramos
    await expect(page.getByText('Pagina 500', { exact: true })).toBeVisible();

    const diag = await page.evaluate(leerDiagnostico);
    expect(diag.paginasPintadas).toBeGreaterThan(0);
    expect(diag.paginasPintadas).toBeLessThanOrEqual(12);

    // Cotejo estructural independiente del propio contador: el nº de
    // <canvas> del visor principal (sin contar miniaturas) tiene que
    // coincidir con ese aforo — cada página desalojada quita su <canvas> del DOM.
    const canvasesViewer = await page.locator('#viewer canvas:not(.thumb)').count();
    expect(canvasesViewer).toBeLessThanOrEqual(12);
  });

  test('volver a la página 1 tras recorrer el documento la repinta y su capa de texto sigue funcionando', async ({ page }) => {
    await page.goto('/index.next.html?diagnostico=1');
    await page.locator('#file-input').setInputFiles(GRANDE);
    await expect(page.locator('.run').first()).toBeVisible();

    await recorrerViewer(page, 20, 1);
    await expect(page.getByText('Pagina 500', { exact: true })).toBeVisible();
    // Mismo aforo que el test anterior: si nada desaloja, esto ya falla aquí.
    expect((await page.evaluate(leerDiagnostico)).paginasPintadas).toBeLessThanOrEqual(12);
    await recorrerViewer(page, 20, -1); // de vuelta a la página 1

    const primeraLinea = page.getByText('Pagina 1', { exact: true });
    await expect(primeraLinea).toBeVisible();
    await primeraLinea.click();
    await expect(primeraLinea).toHaveClass(/editing/);
  });

  test('una página con una edición sin terminar no se desaloja al desplazarse lejos y volver', async ({ page }) => {
    await page.goto('/index.next.html?diagnostico=1');
    await page.locator('#file-input').setInputFiles(GRANDE);
    await expect(page.locator('.run').first()).toBeVisible();

    const primeraLinea = page.getByText('Pagina 1', { exact: true });
    await primeraLinea.click();
    await expect(primeraLinea).toHaveClass(/editing/);
    await page.keyboard.type('-SIN-GUARDAR'); // deja la edición A MEDIAS, sin blur

    await recorrerViewer(page, 20, 1); // scroll lejos, SIN clic (no dispara blur)
    await expect(page.getByText('Pagina 500', { exact: true })).toBeVisible();
    // El resto del documento SÍ se desaloja con normalidad (el aforo se
    // mantiene acotado); la excepción es solo la página en edición.
    expect((await page.evaluate(leerDiagnostico)).paginasPintadas).toBeLessThanOrEqual(12);

    await recorrerViewer(page, 20, -1); // scroll de vuelta

    // El mismo bloque sigue en edición, con el texto a medias intacto: no se
    // desalojó (y por tanto no se destruyó) mientras tenía foco/edición viva.
    // (No se asume en qué posición quedó el cursor al escribir: solo que
    // ambos fragmentos siguen ahí, no que el original se perdiera.)
    const bloqueEnEdicion = page.locator('.run.editing');
    await expect(bloqueEnEdicion).toHaveCount(1);
    const texto = (await bloqueEnEdicion.textContent()) ?? '';
    expect(texto).toContain('Pagina 1');
    expect(texto).toContain('SIN-GUARDAR');
  });
});
