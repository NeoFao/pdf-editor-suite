import { test, expect } from '@playwright/test';
import { abrirDocumento } from './helpers.js';

/**
 * Interfaz en móvil. Este archivo corre bajo el proyecto `movil` de
 * playwright.config.js (Pixel 7), donde vivían dos defectos que en escritorio
 * eran invisibles.
 */
test.describe('Responsive (móvil)', () => {
  test.beforeEach(async ({ page }) => {
    await abrirDocumento(page, 'nativo.pdf');
  });

  /**
   * E-015. La cabecera medía 525 px de contenido en una pantalla de 375: el
   * botón "Descargar PDF" quedaba fuera y era inalcanzable, porque `body`
   * tiene `overflow: hidden`.
   */
  test('E-015: la cabecera no desborda y el botón de descarga es alcanzable', async ({ page }) => {
    const cabecera = await page.evaluate(() => {
      const h = document.querySelector('header');
      return { scrollW: h.scrollWidth, clientW: h.clientWidth };
    });
    expect(cabecera.scrollW).toBeLessThanOrEqual(cabecera.clientW + 1);

    const boton = page.locator('#btn-save-pdf');
    await expect(boton).toBeVisible();
    const caja = await boton.boundingBox();
    const ancho = page.viewportSize().width;
    expect(caja.x + caja.width).toBeLessThanOrEqual(ancho + 1);
    await expect(boton).toBeEnabled();
  });

  /**
   * E-016. `setupPanelsToggle()` estaba declarado dos veces en la clase; la
   * segunda definición ganaba y dejaba sin cablear los cajones móviles, el
   * telón de fondo y los botones de la cabecera.
   */
  test('E-016: los cajones laterales se abren, se excluyen y se cierran', async ({ page }) => {
    const miniaturas = page.locator('#thumbnail-strip');
    const propiedades = page.locator('#properties-panel');
    const telon = page.locator('#sidebar-backdrop');

    await expect(miniaturas).not.toHaveClass(/open-mobile/);

    await page.locator('#btn-mobile-thumbs').click();
    await expect(miniaturas).toHaveClass(/open-mobile/);
    await expect(telon).toBeVisible();

    // Abrir propiedades cierra miniaturas: nunca los dos a la vez.
    await page.locator('#btn-mobile-props').click();
    await expect(propiedades).toHaveClass(/open-mobile/);
    await expect(miniaturas).not.toHaveClass(/open-mobile/);

    // Se toca a la izquierda, fuera del panel: el centro del telón queda
    // debajo del cajón abierto, igual que le pasaría a un dedo.
    await telon.click({ position: { x: 30, y: 300 } });
    await expect(propiedades).not.toHaveClass(/open-mobile/);
    await expect(telon).toBeHidden();
  });

  test('E-016: el botón del ribbon también abre el cajón de miniaturas', async ({ page }) => {
    await page.locator('.ribbon-tab[data-tab="pages"]').click();
    await page.locator('#btn-toggle-thumbnails').click();
    await expect(page.locator('#thumbnail-strip')).toHaveClass(/open-mobile/);
  });

  test('el documento se ajusta al ancho al abrirlo en móvil', async ({ page }) => {
    const { zoom, anchoPagina, anchoViewport } = await page.evaluate(() => {
      const pg = document.querySelector('.acrobat-page-wrapper').getBoundingClientRect();
      return {
        zoom: window.docState.zoom,
        anchoPagina: pg.width,
        anchoViewport: document.getElementById('document-viewport').clientWidth
      };
    });
    expect(zoom).toBeLessThan(1);
    expect(anchoPagina).toBeLessThanOrEqual(anchoViewport);
  });

  test('el cuerpo nunca desplaza horizontalmente', async ({ page }) => {
    const desborde = await page.evaluate(
      () => document.body.scrollWidth > document.body.clientWidth + 1
    );
    expect(desborde).toBe(false);
  });
});
