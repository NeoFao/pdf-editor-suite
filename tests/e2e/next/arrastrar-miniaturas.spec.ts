import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PAGINAS_PEQUENAS = path.resolve(AQUI, '../../fixtures/generados/paginas-pequenas.pdf'); // 4 páginas: PAGINA-1..4

/** Texto de cada página del PDF en `rutaPdf`, en orden, vía el motor real (no la UI). */
async function ordenDePaginas(rutaPdf: string): Promise<string[]> {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(rutaPdf)));
  const total = eng.pageCount(doc);
  const orden: string[] = [];
  for (let i = 0; i < total; i++) {
    orden.push(eng.getPageText(doc, i).map((r) => r.text).join(' '));
  }
  eng.close(doc);
  return orden;
}

/** Descarga tras #btn-save y devuelve la ruta local del PDF guardado. */
async function guardarYDescargar(page: Page, nombre: string): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, nombre);
  await download.saveAs(destino);
  return destino;
}

/** Mueve el ratón al centro de la miniatura `indice` y presiona el botón (sin soltar). */
async function empezarArrastre(page: Page, indice: number): Promise<{ x: number; y: number }> {
  const miniatura = page.locator('#thumbs canvas').nth(indice);
  const caja = (await miniatura.boundingBox())!;
  const x = caja.x + caja.width / 2;
  const y = caja.y + caja.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  return { x, y };
}

test.describe('arrastrar-miniaturas: reordenar páginas arrastrando (estilo Acrobat)', () => {
  test('arrastrar la miniatura 1 debajo de la 3 reordena a 2,3,1,4; muestra el indicador; Deshacer restaura 1,2,3,4', async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(PAGINAS_PEQUENAS);
    await expect(page.locator('.run').first()).toBeVisible();
    await expect(page.locator('#thumbs canvas')).toHaveCount(4);
    await expect(page.locator('#page-indicator')).toHaveText('1 / 4');

    const cajaTercera = (await page.locator('#thumbs canvas').nth(2).boundingBox())!;
    const { x } = await empezarArrastre(page, 0); // miniatura 1 (índice 0, PAGINA-1)
    // Justo debajo del borde inferior de la miniatura 3, por encima del punto
    // medio de la 4: ahí es donde cae el indicador de "insertar antes de la 4".
    await page.mouse.move(x, cajaTercera.y + cajaTercera.height + 2, { steps: 8 });

    // El indicador de inserción (línea entre miniaturas) aparece mientras se arrastra.
    await expect(page.locator('.thumb-drop-indicator')).toHaveCount(1);
    await expect(page.locator('#thumbs canvas').nth(0)).toHaveClass(/thumb-dragging/);

    await page.mouse.up();

    // El indicador desaparece al soltar y currentPage sigue a la página movida
    // (ahora en la posición 3 de 4, vía goToPage — E-032/navegacion-por-gotopage).
    await expect(page.locator('.thumb-drop-indicator')).toHaveCount(0);
    await expect(page.locator('#page-indicator')).toHaveText('3 / 4');

    const destino1 = await guardarYDescargar(page, 'reordenada-arrastre.pdf');
    expect(await ordenDePaginas(destino1)).toEqual([
      expect.stringContaining('PAGINA-2'),
      expect.stringContaining('PAGINA-3'),
      expect.stringContaining('PAGINA-1'),
      expect.stringContaining('PAGINA-4')
    ]);

    // Es UN único comando deshacible.
    await page.locator('#btn-undo').click();
    const destino2 = await guardarYDescargar(page, 'reordenada-deshecha.pdf');
    expect(await ordenDePaginas(destino2)).toEqual([
      expect.stringContaining('PAGINA-1'),
      expect.stringContaining('PAGINA-2'),
      expect.stringContaining('PAGINA-3'),
      expect.stringContaining('PAGINA-4')
    ]);
  });

  test('un clic sin arrastrar sigue navegando y no reordena', async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(PAGINAS_PEQUENAS);
    await expect(page.locator('.run').first()).toBeVisible();

    await page.locator('#thumbs canvas').nth(1).click(); // clic normal, sin mover
    await expect(page.locator('#page-indicator')).toHaveText('2 / 4');
    await expect(page.locator('.thumb-drop-indicator')).toHaveCount(0);

    // El orden del documento no cambió: la primera página sigue siendo PAGINA-1.
    const destino = await guardarYDescargar(page, 'sin-arrastre.pdf');
    expect(await ordenDePaginas(destino)).toEqual([
      expect.stringContaining('PAGINA-1'),
      expect.stringContaining('PAGINA-2'),
      expect.stringContaining('PAGINA-3'),
      expect.stringContaining('PAGINA-4')
    ]);
  });

  test('Escape a mitad de arrastre cancela sin cambios', async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(PAGINAS_PEQUENAS);
    await expect(page.locator('.run').first()).toBeVisible();
    await expect(page.locator('#page-indicator')).toHaveText('1 / 4');

    const cajaCuarta = (await page.locator('#thumbs canvas').nth(3).boundingBox())!;
    const { x } = await empezarArrastre(page, 0);
    await page.mouse.move(x, cajaCuarta.y + cajaCuarta.height / 2, { steps: 8 });
    await expect(page.locator('.thumb-drop-indicator')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(page.locator('.thumb-drop-indicator')).toHaveCount(0);
    await expect(page.locator('#thumbs canvas').nth(0)).not.toHaveClass(/thumb-dragging/);

    await page.mouse.up();

    // currentPage no cambió (nunca se llegó a soltar sobre un destino válido).
    await expect(page.locator('#page-indicator')).toHaveText('1 / 4');

    const destino = await guardarYDescargar(page, 'escape-cancela.pdf');
    expect(await ordenDePaginas(destino)).toEqual([
      expect.stringContaining('PAGINA-1'),
      expect.stringContaining('PAGINA-2'),
      expect.stringContaining('PAGINA-3'),
      expect.stringContaining('PAGINA-4')
    ]);
  });
});
