import { test, expect } from '@playwright/test';
import { abrirDocumento } from './helpers.js';

/**
 * Que cada control haga algo. Varios botones del ribbon y del menú Archivo
 * estaban en el HTML sin ningún manejador detrás: se veían, se pulsaban y no
 * pasaba nada. Un test por familia de controles.
 */
test.describe('Cableado de la interfaz', () => {
  test('la app arranca sin errores de consola', async ({ page }) => {
    const errores = [];
    page.on('console', (m) => m.type() === 'error' && errores.push(m.text()));
    page.on('pageerror', (e) => errores.push(String(e)));

    await abrirDocumento(page, 'nativo.pdf');
    expect(errores).toEqual([]);
  });

  test('todas las pestañas del ribbon muestran su sección y ocultan el resto', async ({ page }) => {
    await abrirDocumento(page, 'nativo.pdf');
    const pestanas = await page.locator('.ribbon-tab').evaluateAll(
      (els) => els.map((e) => e.dataset.tab)
    );
    expect(pestanas.length).toBeGreaterThan(0);

    for (const tab of pestanas) {
      await page.locator(`.ribbon-tab[data-tab="${tab}"]`).click();
      await expect(page.locator(`#ribbon-sec-${tab}`)).toBeVisible();
      const visibles = await page.locator('.ribbon-content-section:visible').count();
      expect(visibles, `solo la sección ${tab} debe estar visible`).toBe(1);
    }
  });

  /**
   * E-017. Los atajos V/P/T/U cambiaban el estado pero no el botón resaltado
   * ni el cursor: la interfaz mentía sobre la herramienta activa.
   */
  test('E-017: los atajos de teclado sincronizan estado, ribbon y cursor', async ({ page }) => {
    await abrirDocumento(page, 'nativo.pdf');

    const casos = [['p', 'pencil'], ['u', 'highlighter'], ['e', 'eraser'], ['h', 'hand'], ['r', 'rect'], ['t', 'text'], ['v', 'select']];
    for (const [tecla, herramienta] of casos) {
      await page.locator('body').press(tecla);
      await expect(page.locator('[data-action="tool"].active')).toHaveAttribute('data-tool', herramienta);
      const estado = await page.evaluate(() => window.docState.activeTool);
      expect(estado).toBe(herramienta);
    }
  });

  /**
   * E-018. El selector "Más colores" del ribbon se escribía pero nunca se leía:
   * elegir un color personalizado no tenía ningún efecto.
   */
  test('E-018: los tres controles de color quedan sincronizados', async ({ page }) => {
    await abrirDocumento(page, 'nativo.pdf');

    await page.locator('#ribbon-color-custom').evaluate((el) => {
      el.value = '#00aaff';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(await page.evaluate(() => window.docState.properties.color)).toBe('#00aaff');
    await expect(page.locator('#prop-stroke-color')).toHaveValue('#00aaff');
    await expect(page.locator('#prop-stroke-color-hex')).toHaveText('#00aaff');

    // Y en sentido inverso, desde el panel de propiedades.
    await page.locator('#prop-stroke-color').evaluate((el) => {
      el.value = '#10b981';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#ribbon-color-custom')).toHaveValue('#10b981');
  });

  /**
   * E-019. "Insertar otro PDF…" del menú Archivo no tenía ningún listener.
   */
  test('E-019: todos los elementos del menú Archivo responden', async ({ page }) => {
    await abrirDocumento(page, 'nativo.pdf');

    await page.locator('#btn-file-menu').click();
    await expect(page.locator('#dropdown-file-menu')).toBeVisible();

    // Insertar otro PDF abre un selector de archivos: se observa el evento.
    const seleccion = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('#menu-insert-pdf').click();
    await (await seleccion).setFiles([]);

    await expect(page.locator('#dropdown-file-menu')).toBeHidden();
  });

  test('las herramientas de dibujo cambian el cursor del visor', async ({ page }) => {
    await abrirDocumento(page, 'nativo.pdf');
    await page.locator('[data-tool="pencil"]').click();
    await expect(page.locator('#acrobat-page-1 .acrobat-overlay-canvas')).toHaveCSS('cursor', 'crosshair');
  });

  test('los modales se abren y se cierran', async ({ page }) => {
    await abrirDocumento(page, 'nativo.pdf');

    await page.locator('.ribbon-tab[data-tab="sign"]').click();
    await page.locator('#btn-ribbon-draw-sign').click();
    await expect(page.locator('#modal-signature')).toBeVisible();
    await page.locator('#btn-modal-sig-close').click();
    await expect(page.locator('#modal-signature')).toBeHidden();

    await page.locator('.ribbon-tab[data-tab="convert"]').click();
    await page.locator('#btn-open-md-editor').click();
    await expect(page.locator('#modal-markdown')).toBeVisible();
    // La vista previa compila KaTeX y resalta el código.
    await expect(page.locator('#modal-md-preview .katex')).toBeVisible();
    await expect(page.locator('#modal-md-preview pre code')).toBeVisible();
    await page.locator('#btn-modal-md-close').click();
    await expect(page.locator('#modal-markdown')).toBeHidden();
  });

  test('firmar estampa un sello movible y deshacible', async ({ page }) => {
    await abrirDocumento(page, 'nativo.pdf');
    await page.locator('.ribbon-tab[data-tab="sign"]').click();
    await page.locator('#btn-stamp-approved').click();

    await expect(page.locator('#acrobat-page-1 .stamp-overlay')).toHaveCount(1);
    await page.locator('#btn-undo').click();
    await expect(page.locator('#acrobat-page-1 .stamp-overlay')).toHaveCount(0);
  });

  /**
   * E-020. makeStampInteractive registraba pointermove/pointerup en `window`
   * por cada sello y no los retiraba nunca.
   */
  test('E-020: los sellos no dejan listeners globales acumulados', async ({ page }) => {
    await abrirDocumento(page, 'nativo.pdf');

    await page.evaluate(() => {
      window.__globales = 0;
      const original = window.addEventListener.bind(window);
      window.addEventListener = (tipo, ...resto) => {
        if (tipo === 'pointermove' || tipo === 'pointerup') window.__globales++;
        return original(tipo, ...resto);
      };
    });

    await page.locator('.ribbon-tab[data-tab="sign"]').click();
    for (let i = 0; i < 3; i++) await page.locator('#btn-stamp-approved').click();
    await expect(page.locator('#acrobat-page-1 .stamp-overlay')).toHaveCount(3);

    // Sin arrastrar ninguno, no debe haberse registrado ni un listener global.
    expect(await page.evaluate(() => window.__globales)).toBe(0);
  });
});
