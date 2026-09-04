import { test, expect } from '@playwright/test';
import {
  abrirDocumento,
  cargarBytesEnVisor,
  editarLinea,
  exportarPDF,
  franjasCambiadas,
  perfilDeFilas,
  textoExtraidoDelPDF,
  bloquePorTexto
} from './helpers.js';

/**
 * Lo que sale del botón "Descargar PDF".
 *
 * La aserción base de todo este archivo: **una edición solo puede alterar lo
 * que el usuario tocó**. Se comprueba extrayendo el texto del PDF resultante
 * con pdf.js, no comparando píxeles: es determinista y no se rompe al cambiar
 * una fuente o un margen.
 */
test.describe('Exportación', () => {
  test.beforeEach(async ({ page }) => {
    await abrirDocumento(page, 'nativo.pdf');
  });

  /**
   * E-002. El parche blanco usaba `block.offsetHeight`, que durante la edición
   * valía 105 px en vez de 14. El PDF exportado salía con tres renglones
   * borrados. Éste es el test que más importa del repositorio.
   */
  test('E-002: editar una línea NO borra las vecinas del PDF exportado', async ({ page }) => {
    // Huella visual del documento intacto, franja horizontal a franja horizontal.
    const original = await perfilDeFilas(page, 1);

    await editarLinea(page, 'La segunda linea', 'SEGUNDA LINEA REESCRITA');
    const bytes = await exportarPDF(page);
    await cargarBytesEnVisor(page, bytes);
    const exportado = await perfilDeFilas(page, 1);

    const cambiadas = franjasCambiadas(original.perfil, exportado.perfil);

    // Solo puede haber cambiado la banda de la línea editada. Con el defecto
    // original cambiaban cuatro renglones seguidos (~14 franjas de 8 px).
    expect(cambiadas.length).toBeGreaterThan(0);
    expect(
      cambiadas.length,
      `franjas alteradas: ${cambiadas.join(', ')} — una línea ocupa ~3 franjas de 8 px`
    ).toBeLessThanOrEqual(5);

    // Y son contiguas: un solo renglón, no varios dispersos.
    expect(cambiadas[cambiadas.length - 1] - cambiadas[0]).toBeLessThanOrEqual(5);

    // Las líneas vecinas siguen siendo texto real y seleccionable.
    const [pagina1] = await textoExtraidoDelPDF(page, bytes);
    expect(pagina1).toContain('Tercera linea con numeros');
    expect(pagina1).toContain('Cuarta linea para verificar el agrupamiento');
    expect(pagina1).toContain('Quinta linea final del parrafo');
  });

  test('E-002: la máscara tampoco desborda al agrandar la tipografía', async ({ page }) => {
    const original = await perfilDeFilas(page, 1);

    const bloque = await bloquePorTexto(page, 'Tercera linea');
    await bloque.locator('.text-block-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('TERCERA AGRANDADA');
    await page.locator('#prop-font-size').fill('28');
    await page.locator('header').click({ position: { x: 5, y: 5 } });

    const bytes = await exportarPDF(page);
    await cargarBytesEnVisor(page, bytes);
    const exportado = await perfilDeFilas(page, 1);

    // Al agrandar, el texto nuevo puede invadir el interlineado: se toleran
    // dos franjas más que en el caso normal, pero no un párrafo entero.
    const cambiadas = franjasCambiadas(original.perfil, exportado.perfil);
    expect(cambiadas.length).toBeLessThanOrEqual(7);
  });

  /**
   * E-004. Se generaba un PNG de página completa a 2× POR CADA texto. Con diez
   * ediciones el archivo se disparaba y la exportación tardaba una eternidad.
   */
  test('E-004: N ediciones no multiplican el peso del archivo', async ({ page }) => {
    await editarLinea(page, 'Este documento', 'UNA');
    const unaEdicion = (await exportarPDF(page)).byteLength;

    await editarLinea(page, 'La segunda linea', 'DOS');
    await editarLinea(page, 'Tercera linea', 'TRES');
    await editarLinea(page, 'Cuarta linea', 'CUATRO');
    const cuatroEdiciones = (await exportarPDF(page)).byteLength;

    // Una sola capa por página: cuatro ediciones pesan casi lo mismo que una.
    // Con el defecto original la relación era ~4x.
    expect(cuatroEdiciones).toBeLessThan(unaEdicion * 1.6);
  });

  /**
   * E-005. exportAndDownloadPDF incrustaba sobre el documento vivo. Exportar
   * dos veces quemaba las anotaciones por duplicado y dejaba el estado sucio.
   */
  test('E-005: exportar dos veces produce el mismo resultado', async ({ page }) => {
    await editarLinea(page, 'La segunda linea', 'IDEMPOTENTE');

    const primera = await exportarPDF(page);
    const segunda = await exportarPDF(page);

    const [texto1] = await textoExtraidoDelPDF(page, primera);
    const [texto2] = await textoExtraidoDelPDF(page, segunda);

    expect(texto2).toBe(texto1);
    // Y el documento en memoria sigue sin tocar.
    const anotaciones = await page.evaluate(
      () => window.docState.annotations[1].texts.length
    );
    expect(anotaciones).toBe(1);
  });

  test('las anotaciones dibujadas llegan al PDF', async ({ page }) => {
    await page.locator('[data-tool="pencil"]').click();
    const pagina = page.locator('#acrobat-page-1 .acrobat-overlay-canvas');
    const caja = await pagina.boundingBox();
    await page.mouse.move(caja.x + 60, caja.y + 400);
    await page.mouse.down();
    await page.mouse.move(caja.x + 300, caja.y + 420, { steps: 8 });
    await page.mouse.up();

    const trazos = await page.evaluate(() => window.docState.annotations[1].strokes.length);
    expect(trazos).toBe(1);

    const bytes = await exportarPDF(page);
    // El trazo se incrusta como imagen: el PDF crece respecto al original.
    expect(bytes.byteLength).toBeGreaterThan(3000);
    const [pagina1] = await textoExtraidoDelPDF(page, bytes);
    expect(pagina1).toContain('Quinta linea final del parrafo');
  });

  /**
   * E-008. Los filtros (Magic Color / B-N / Grises) solo existían en el canvas
   * de pantalla: al guardar se perdían por completo.
   */
  test('E-008: el filtro aplicado se incrusta en el PDF', async ({ page }) => {
    await page.locator('.ribbon-tab[data-tab="ocr"]').click();
    await page.locator('.btn-apply-filter[data-filter="bw"]').click();
    await expect(page.locator('#toast-container')).toContainText(/Filtro/);

    const marcado = await page.evaluate(
      () => window.unifiedApp.renderedPages.get(1).activeFilter
    );
    expect(marcado).toBe('bw');

    const bytes = await exportarPDF(page);
    // Rasterizar la página la vuelve mucho más pesada que el original vectorial.
    expect(bytes.byteLength).toBeGreaterThan(20_000);
  });

  test('el nombre del archivo descargado deriva del documento', async ({ page }) => {
    await editarLinea(page, 'La segunda linea', 'X');
    const descarga = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#btn-save-pdf').click()
    ]).then(([d]) => d);

    expect(descarga.suggestedFilename()).toBe('nativo_Editado.pdf');
  });
});
