import { test, expect } from '@playwright/test';
import {
  abrirDocumento,
  bloquePorTexto,
  contarBloquesConTexto,
  editarLinea,
  textosDeBloques
} from './helpers.js';

/**
 * Edición in-place del texto que ya venía en el PDF (estilo Acrobat / PDF Agile).
 * Es la función central del producto: cada test de aquí fija un defecto real
 * registrado en docs/ERRORES-CONOCIDOS.md.
 */
test.describe('Texto Vivo — edición in-place', () => {
  test.beforeEach(async ({ page }) => {
    await abrirDocumento(page, 'nativo.pdf');
  });

  test('extrae una línea por renglón, sin partirlas ni fusionarlas', async ({ page }) => {
    const textos = await textosDeBloques(page, 1);
    expect(textos).toContain('Este documento contiene texto nativo seleccionable.');
    expect(textos).toContain('Quinta linea final del parrafo de prueba.');
    // Un renglón = un bloque: si el agrupamiento se rompe aparecen fragmentos sueltos.
    expect(textos.every((t) => t.trim().length > 0)).toBe(true);
  });

  test('un clic con el cursor por defecto abre la edición (no hace falta la herramienta Texto)', async ({ page }) => {
    const bloque = await bloquePorTexto(page, 'La segunda linea');
    await expect(page.locator('[data-action="tool"].active')).toHaveAttribute('data-tool', 'select');

    await bloque.locator('.text-block-content').click();

    await expect(bloque).toHaveClass(/editing/);
    await expect(bloque.locator('.text-block-content')).toHaveAttribute('contenteditable', 'true');
  });

  /**
   * E-001. El bloque se construía con innerHTML indentado; los saltos de línea
   * de la plantilla quedaban como nodos de texto y, con `white-space: pre-wrap`
   * + `height: auto`, se pintaban como renglones vacíos: 14 px -> 105 px.
   * El cuadro blanco tapaba tres líneas del documento.
   */
  test('E-001: el cuadro de edición NO crece en vertical', async ({ page }) => {
    const bloque = await bloquePorTexto(page, 'La segunda linea');
    const altoReposo = (await bloque.boundingBox()).height;

    await bloque.locator('.text-block-content').click();
    await expect(bloque).toHaveClass(/editing/);
    const altoEditando = (await bloque.boundingBox()).height;

    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Un texto bastante mas largo que el original para forzar el desbordamiento horizontal');
    const altoEscribiendo = (await bloque.boundingBox()).height;

    // Tolerancia de 2 px por el borde de foco; nunca un múltiplo de la línea.
    expect(altoEditando).toBeLessThanOrEqual(altoReposo + 2);
    expect(altoEscribiendo).toBeLessThanOrEqual(altoReposo + 2);
  });

  test('E-001: el bloque en edición no se solapa con la línea siguiente', async ({ page }) => {
    const segunda = await bloquePorTexto(page, 'La segunda linea');
    const tercera = await bloquePorTexto(page, 'Tercera linea');
    const cajaTercera = await tercera.boundingBox();

    await segunda.locator('.text-block-content').click();
    await expect(segunda).toHaveClass(/editing/);
    const cajaSegunda = await segunda.boundingBox();

    expect(cajaSegunda.y + cajaSegunda.height).toBeLessThanOrEqual(cajaTercera.y + 1);
  });

  /**
   * E-003. `${line.str}` se interpolaba dentro de innerHTML: un PDF con `<` o
   * `&` en su texto corrompía la capa y permitía inyectar marcado.
   */
  test('E-003: el texto del PDF se muestra literal, nunca como HTML', async ({ page }) => {
    await abrirDocumento(page, 'hostil.pdf');

    const textos = await textosDeBloques(page, 1);
    const conPayload = textos.find((t) => t.includes('onerror'));
    expect(conPayload, 'el texto hostil debe llegar completo y literal').toContain('<img');
    expect(conPayload).toContain('<b>negrita</b>');

    // Ni un solo elemento real creado a partir del texto del documento.
    const inyectados = await page.locator('.acrobat-text-layer img, .acrobat-text-layer b').count();
    expect(inyectados).toBe(0);
    expect(await page.evaluate(() => window.__XSS)).toBeUndefined();
  });

  /**
   * E-006. Los textos se pintaban además en el canvas superpuesto, con
   * `textBaseline: middle` sobre el borde superior del bloque: el resultado era
   * un duplicado desplazado media línea.
   */
  test('E-006: editar no deja texto fantasma en el canvas de anotaciones', async ({ page }) => {
    await editarLinea(page, 'La segunda linea', 'TEXTO EDITADO');

    const textosEnCanvas = await page.evaluate(
      () => window.docState.annotations[1].texts.length
    );
    expect(textosEnCanvas).toBe(1); // el registro existe (para exportar)...

    // ...pero redrawPageAnnotations no debe pintarlo: solo trazos y máscaras.
    const fuente = await page.evaluate(async () => {
      const r = await fetch('/js/app.js');
      return r.text();
    });
    const cuerpoRedraw = fuente.slice(fuente.indexOf('redrawPageAnnotations(pageNum) {'));
    const hastaFin = cuerpoRedraw.slice(0, cuerpoRedraw.indexOf('\n  }'));
    expect(hastaFin).not.toContain('fillText');
  });

  /**
   * E-010. Una segunda edición del mismo bloque apilaba otra máscara, y
   * Deshacer no retiraba ninguna: el texto original quedaba tapado para siempre.
   */
  test('E-010: la máscara blanca es una por bloque y Deshacer la retira', async ({ page }) => {
    await editarLinea(page, 'La segunda linea', 'PRIMER CAMBIO');
    await editarLinea(page, 'PRIMER CAMBIO', 'SEGUNDO CAMBIO');

    const mascaras = () => page.evaluate(
      () => window.docState.annotations[1].strokes.filter((s) => s.isMask).length
    );
    expect(await mascaras()).toBe(1);

    await page.locator('#btn-undo').click();
    await page.locator('#btn-undo').click();

    expect(await mascaras()).toBe(0);
    await expect(await bloquePorTexto(page, 'La segunda linea')).toBeVisible();
  });

  /**
   * E-011. Rehacer restauraba el texto en pantalla pero no el registro ni la
   * máscara: el cambio rehecho no llegaba al PDF y el original reasomaba.
   */
  test('E-011: deshacer y rehacer dejan el estado coherente', async ({ page }) => {
    await editarLinea(page, 'La segunda linea', 'CAMBIO REHECHO');

    const estado = () => page.evaluate(() => ({
      texts: window.docState.annotations[1].texts.length,
      masks: window.docState.annotations[1].strokes.filter((s) => s.isMask).length
    }));

    expect(await estado()).toEqual({ texts: 1, masks: 1 });

    await page.locator('#btn-undo').click();
    expect(await estado()).toEqual({ texts: 0, masks: 0 });

    await page.locator('#btn-redo').click();
    expect(await estado()).toEqual({ texts: 1, masks: 1 });
    await expect(await bloquePorTexto(page, 'CAMBIO REHECHO')).toBeVisible();
  });

  /**
   * E-013. Fuente y Tamaño del panel solo afectaban a cuadros nuevos. Al pulsar
   * el control, el contenteditable pierde el foco: si esa referencia se borra en
   * el blur, el cambio nunca se aplica.
   */
  test('E-013: el panel de Propiedades actúa sobre el bloque en edición', async ({ page }) => {
    const bloque = await bloquePorTexto(page, 'Cuarta linea');
    await bloque.locator('.text-block-content').click();

    await page.locator('#prop-font-size').fill('26');
    await page.locator('#prop-font-family').selectOption("'Times New Roman', serif");

    await expect(bloque).toHaveCSS('font-size', '26px');
    await expect(bloque).toHaveCSS('font-family', /Times New Roman/);
  });

  test('la papelera de un bloque lo borra y Deshacer lo devuelve', async ({ page }) => {
    const bloque = await bloquePorTexto(page, 'Quinta linea');
    await bloque.hover();
    await bloque.locator('.acrobat-delete-btn').click();

    expect(await contarBloquesConTexto(page, 'Quinta linea')).toBe(0);

    await page.locator('#btn-undo').click();
    await expect(await bloquePorTexto(page, 'Quinta linea')).toBeVisible();
  });
});
