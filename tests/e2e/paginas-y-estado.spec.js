import { test, expect } from '@playwright/test';
import { abrirDocumento, editarLinea, esperarZoomEstable, exportarPDF, franjasCambiadas, perfilDeFilas, cargarBytesEnVisor } from './helpers.js';

/**
 * Ciclo de vida del documento: operaciones de página, zoom y liberación de
 * recursos. Aquí vivían defectos silenciosos que solo se notaban al guardar.
 */
test.describe('Páginas y ciclo de vida', () => {
  test.beforeEach(async ({ page }) => {
    await abrirDocumento(page, 'nativo.pdf');
    page.on('dialog', (d) => d.accept());
  });

  /**
   * E-007. loadPDFBuffer no limpiaba `annotations`. Tras rotar/duplicar/borrar,
   * las ediciones quedaban ancladas a números de página que ya habían cambiado
   * y se volvían a incrustar en la siguiente exportación.
   */
  test('E-007: una operación de páginas consolida la edición y limpia el estado', async ({ page }) => {
    await editarLinea(page, 'La segunda linea', 'EDITADO ANTES DE ROTAR');

    await page.locator('.ribbon-tab[data-tab="pages"]').click();
    await page.locator('#btn-ribbon-rotate-cw').click();
    await page.waitForFunction(() => document.getElementById('global-loading-overlay').classList.contains('hidden'));

    const estado = await page.evaluate(() => ({
      anotaciones: Object.values(window.docState.annotations)
        .reduce((n, p) => n + p.texts.length + p.strokes.length + p.stamps.length, 0),
      rotacion: window.docState.pdfLibDoc.getPage(0).getRotation().angle,
      undo: window.docState.undoStack.length
    }));

    expect(estado.anotaciones, 'las ediciones ya están dentro del PDF').toBe(0);
    expect(estado.undo, 'el historial se reinicia con el documento').toBe(0);
    expect(estado.rotacion).toBe(90);

    // Y la edición sobrevivió a la rotación: sigue incrustada en el documento.
    // Se comprueba visualmente porque el texto original permanece en el flujo
    // de contenido debajo del parche blanco (ver E-024).
    const antes = await perfilDeFilas(page, 1);
    const bytes = await exportarPDF(page);
    await cargarBytesEnVisor(page, bytes);
    const despues = await perfilDeFilas(page, 1);
    expect(
      franjasCambiadas(antes.perfil, despues.perfil).length,
      'la exportación no debe añadir nada: la edición ya estaba incrustada'
    ).toBe(0);
  });

  /**
   * E-012. rotatePage hacía `(angulo + deg) % 360`, que con -90 produce un
   * /Rotate negativo que algunos visores no interpretan.
   */
  test('E-012: rotar en sentido antihorario normaliza el ángulo a [0,360)', async ({ page }) => {
    await page.locator('.ribbon-tab[data-tab="pages"]').click();
    await page.locator('#btn-ribbon-rotate-ccw').click();
    await page.waitForFunction(() => document.getElementById('global-loading-overlay').classList.contains('hidden'));

    const angulo = await page.evaluate(() => window.docState.pdfLibDoc.getPage(0).getRotation().angle);
    expect(angulo).toBe(270);
  });

  test('duplicar, reordenar y eliminar páginas mantienen el visor coherente', async ({ page }) => {
    await page.locator('.ribbon-tab[data-tab="pages"]').click();

    await page.locator('#btn-ribbon-duplicate-page').click();
    await page.waitForFunction(() => window.docState.totalPages === 3);
    await expect(page.locator('.thumb-item')).toHaveCount(3);
    await expect(page.locator('.acrobat-page-wrapper')).toHaveCount(3);

    await page.locator('#btn-ribbon-delete-page').click();
    await page.waitForFunction(() => window.docState.totalPages === 2);
    await expect(page.locator('.thumb-item')).toHaveCount(2);
    await expect(page.locator('#label-total-pages')).toHaveText('2');
  });

  /**
   * E-014. `state.pdfJsDoc` nunca se destruía: cada getDocument() dejaba vivo
   * un worker reteniendo el PDF completo.
   */
  test('E-014: recargar el documento libera el pdf.js anterior', async ({ page }) => {
    const antes = await page.evaluate(() => window.docState.pdfJsDoc !== null);
    expect(antes).toBe(true);

    // Se observa la llamada a destroy() en lugar de intentar usar el documento
    // después: pdf.js sirve de su caché las páginas ya solicitadas, así que
    // `getPage(1)` puede resolver aunque el documento esté destruido. Esa
    // aserción pasaba o fallaba según el orden de ejecución.
    const destruido = await page.evaluate(async () => {
      const previo = window.docState.pdfJsDoc;
      let llamado = false;
      const original = previo.destroy.bind(previo);
      previo.destroy = () => { llamado = true; return original(); };

      await window.unifiedApp.createBlankPDF();
      return { llamado, reemplazado: window.docState.pdfJsDoc !== previo };
    });

    expect(destruido.llamado, 'loadPDFBuffer debe destruir el documento anterior').toBe(true);
    expect(destruido.reemplazado, 'y sustituirlo por el nuevo').toBe(true);
  });

  /**
   * E-009. `transform: scale()` no ocupa espacio de maquetación: al ampliar,
   * la página se recortaba sin scroll horizontal posible.
   */
  test('E-009: al ampliar el zoom la página sigue siendo alcanzable con scroll', async ({ page }) => {
    const medir = () => page.evaluate(() => {
      const vp = document.getElementById('document-viewport');
      const pg = document.querySelector('.acrobat-page-wrapper').getBoundingClientRect();
      return { scrollW: vp.scrollWidth, clientW: vp.clientWidth, anchoVisual: Math.round(pg.width) };
    });

    await page.evaluate(() => window.docState.setZoom(1.0));
    await esperarZoomEstable(page);
    const base = await medir();

    await page.evaluate(() => window.docState.setZoom(3.0));
    await esperarZoomEstable(page);
    const ampliado = await medir();

    // El contenido escalado se ve de verdad...
    expect(ampliado.anchoVisual).toBeGreaterThan(base.anchoVisual * 2.5);
    // ...y el contenedor reserva espacio para poder desplazarse hasta el borde.
    expect(ampliado.scrollW).toBeGreaterThan(ampliado.clientW);
    expect(ampliado.scrollW).toBeGreaterThanOrEqual(ampliado.anchoVisual);
  });

  test('E-009: el escenario no se realimenta al cambiar el zoom varias veces', async ({ page }) => {
    const natural = () => page.evaluate(() => {
      const st = document.getElementById('pdf-render-stage');
      const previo = st.style.transform;
      st.style.transform = 'none';
      const w = st.offsetWidth;
      st.style.transform = previo;
      return w;
    });

    const inicial = await natural();
    for (const z of [0.5, 1.8, 3.0, 1.0]) {
      await page.evaluate((v) => window.docState.setZoom(v), z);
      await esperarZoomEstable(page);
    }
    expect(await natural()).toBe(inicial);
  });

  test('cerrar el documento devuelve la app al estado inicial', async ({ page }) => {
    await page.locator('#btn-file-menu').click();
    await page.locator('#menu-close-file').click();

    await expect(page.locator('#welcome-screen')).toBeVisible();
    await expect(page.locator('#pdf-zoom-sizer')).toBeHidden();
    await expect(page.locator('#thumb-count-badge')).toHaveText('0');
    await expect(page.locator('#info-total-pages')).toHaveText('0');

    const limpio = await page.evaluate(() => ({
      undo: window.docState.undoStack.length,
      paginas: window.docState.totalPages,
      render: window.unifiedApp.renderedPages.size
    }));
    expect(limpio).toEqual({ undo: 0, paginas: 0, render: 0 });
  });
});
