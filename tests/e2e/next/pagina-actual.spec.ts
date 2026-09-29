import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPestana } from './_ayudas';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PAGINAS_PEQUENAS = path.resolve(AQUI, '../../fixtures/generados/paginas-pequenas.pdf');
const PAGINAS_PEQUENAS_MARCADORES = path.resolve(AQUI, '../../fixtures/generados/paginas-pequenas-marcadores.pdf');
const NATIVO = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf'); // A4, 2 páginas: NO caben todas, hace falta scroll real

// E-032 (docs/ERRORES-CONOCIDOS.md): la página "actual" (`App.currentPage`)
// dependía de que el IntersectionObserver del Viewer reaccionara a un scroll
// real. Con `paginas-pequenas.pdf` las 4 páginas caben a la vez en el
// viewport (1440×900): el scroll no se mueve al navegar y antes del arreglo
// `currentPage` se quedaba con el valor anterior.

test.describe('E-032: la "página actual" sigue la selección explícita del usuario', () => {
  test('clic en una miniatura fija la página actual aunque el scroll no se mueva; Eliminar página borra la elegida, no la primera', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(PAGINAS_PEQUENAS);
    await expect(page.locator('.run').first()).toBeVisible();
    await expect(page.locator('#thumbs canvas')).toHaveCount(4);

    // Las 4 páginas ya son visibles: seleccionar la 3 no mueve el scroll.
    await page.locator('#thumbs canvas').nth(2).click();
    await expect(page.locator('#page-indicator')).toHaveText('3 / 4');
    await expect(page.locator('#thumbs canvas').nth(2)).toHaveClass(/active/);

    await abrirPestana(page, 'organizar');
    await page.locator('#btn-delete-page').click();

    await expect(page.locator('#thumbs canvas')).toHaveCount(3);
    // El defecto destructivo: sin el arreglo, esto borraba PAGINA-1.
    await expect(page.locator('.run', { hasText: 'PAGINA-3' })).toHaveCount(0);
    await expect(page.locator('.run', { hasText: 'PAGINA-1' })).toHaveCount(1);
    await expect(page.locator('.run', { hasText: 'PAGINA-2' })).toHaveCount(1);
    await expect(page.locator('.run', { hasText: 'PAGINA-4' })).toHaveCount(1);
  });

  test('siguiente/anterior avanzan la página actual aunque todo el documento quepa en pantalla', async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(PAGINAS_PEQUENAS);
    await expect(page.locator('.run').first()).toBeVisible();

    await expect(page.locator('#page-indicator')).toHaveText('1 / 4');
    await page.locator('#btn-next').click();
    await expect(page.locator('#page-indicator')).toHaveText('2 / 4');
    await page.locator('#btn-prev').click();
    await expect(page.locator('#page-indicator')).toHaveText('1 / 4');
  });

  test('clic en un marcador fija la página actual a la suya, aunque todas quepan en pantalla', async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(PAGINAS_PEQUENAS_MARCADORES);
    await expect(page.locator('.run').first()).toBeVisible();

    await page.locator('#tab-outline').click();
    await page.locator('.outline-item', { hasText: 'Marcador 3' }).click();
    await expect(page.locator('#page-indicator')).toHaveText('3 / 4');
  });

  test('el scroll manual del usuario sigue actualizando el indicador', async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(NATIVO);
    await expect(page.locator('.run').first()).toBeVisible();
    await expect(page.locator('#page-indicator')).toHaveText('1 / 2');

    await page.locator('#viewer').hover();
    // Rueda del ratón: scroll real del usuario, no programático.
    await page.mouse.wheel(0, 2000);
    await expect(page.locator('#page-indicator')).toHaveText('2 / 2');
  });

  // Corrección de revisión de E-032: el pin que fija goToPage() solo se
  // liberaba con `wheel`/`touchmove`. PageDown/flechas/Home/End/espacio con
  // el visor enfocado, o arrastrar la barra de scroll, no emiten ninguno de
  // los dos — el indicador se quedaba congelado tras una navegación
  // explícita y "Eliminar página" podía volver a actuar sobre la página
  // equivocada. Mismo defecto que E-032, con otro disparador.

  test('el teclado (PageDown/flechas/Home/End) con el visor enfocado también libera el pin', async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(NATIVO);
    await expect(page.locator('.run').first()).toBeVisible();

    // Clic explícito en la miniatura 1: fija el pin en la página 1 (goToPage).
    await page.locator('#thumbs canvas').first().click();
    await expect(page.locator('#page-indicator')).toHaveText('1 / 2');

    // Ver el comentario equivalente en el test de "arrastrar la barra" más
    // abajo: scrollToPage(0) no mueve nada (ya estábamos en la página 1), así
    // que Viewer depende de su temporizador de respaldo (~150ms) para cerrar
    // la ventana de "scroll programático en curso". Sin este margen, el
    // 'scroll' que dispara End más abajo puede llegar mientras esa ventana
    // sigue abierta y quedar ignorado en vez de liberar el pin.
    await page.waitForTimeout(200);

    await page.locator('#viewer').focus();
    await page.keyboard.press('End');

    await expect(page.locator('#page-indicator')).toHaveText('2 / 2');
  });

  test('arrastrar la barra de scroll (scroll directo del DOM, sin wheel/touchmove) también libera el pin', async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(NATIVO);
    await expect(page.locator('.run').first()).toBeVisible();

    await page.locator('#thumbs canvas').first().click();
    await expect(page.locator('#page-indicator')).toHaveText('1 / 2');

    // La miniatura 1 ya era la página actual: scrollToPage(0) no mueve nada,
    // así que Viewer no ve ningún 'scroll' que cerrar y depende de su propio
    // temporizador de respaldo (~150ms, Viewer.armScrollEndFallback) para
    // soltar la ventana de "scroll programático en curso". No hay ningún
    // evento de plataforma que esperar aquí — igual que los otros dos
    // `waitForTimeout` de la suite, tras una transición CSS sin evento (ver
    // docs/TESTING.md § "Sin esperas por tiempo cuando haya una condición
    // que esperar"): sin este margen, la escritura de scrollTop de abajo
    // podría llegar mientras el propio clic todavía se considera "en vuelo"
    // y quedar tratada como parte de ese scroll programático.
    await page.waitForTimeout(200);

    // Simula lo que hace el navegador al arrastrar el thumb de la barra de
    // scroll: mueve scrollTop directamente en el DOM. No pasa por
    // scrollToPage() ni dispara wheel/touchmove.
    await page.evaluate(() => {
      const root = document.querySelector('#viewer') as HTMLElement;
      const destino = document.querySelector('.page[data-page="1"]') as HTMLElement;
      const rootRect = root.getBoundingClientRect();
      const destRect = destino.getBoundingClientRect();
      root.scrollTop += destRect.top - rootRect.top;
    });

    await expect(page.locator('#page-indicator')).toHaveText('2 / 2');
  });
});
