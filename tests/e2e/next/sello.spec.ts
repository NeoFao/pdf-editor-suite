import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');
const IMG = path.resolve(AQUI, '../../fixtures/generados/rojo.png');
const FIRMA = path.resolve(AQUI, '../../fixtures/generados/firma-blanca.png');

/** Descarga el PDF actual (#btn-save) y devuelve sus bytes. */
async function descargar(page: import('@playwright/test').Page, nombre: string): Promise<Uint8Array> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, nombre);
  await download.saveAs(destino);
  return new Uint8Array(fs.readFileSync(destino));
}

// #21 de la tabla de paridad (§9): sello/imagen interactivo — seleccionar,
// mover, redimensionar y borrar una imagen ya insertada, con deshacer.
test('sello: clic selecciona con tiradores, arrastrar mueve, tirador redimensiona, Suprimir borra y Deshacer repone', async ({ page }) => {
  const eng = await PdfiumEngine.create();
  const docFixture = await eng.open(new Uint8Array(fs.readFileSync(PDF)));
  const pageSizePt = eng.pageSize(docFixture, 0);
  eng.close(docFixture);

  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(PDF);
  await expect(page.locator('.run').first()).toBeVisible();

  await page.locator('#btn-insert-image').setInputFiles(IMG);
  await expect(page.locator('#status')).toHaveText('Imagen insertada.');

  const box = page.locator('.image-box');
  await expect(box).toHaveCount(1);

  // Estado inicial en el motor (antes de cualquier interacción con el marco).
  const rectInicial = (await (async () => {
    const bytes = await descargar(page, 'sello-inicial.pdf');
    const d = await eng.open(bytes);
    const r = eng.listImageObjects(d, 0)[0]!.rectPt;
    eng.close(d);
    return r;
  })());

  // Clic → seleccionada, con 4 tiradores en las esquinas.
  await box.click();
  await expect(box).toHaveClass(/selected/);
  await expect(box.locator('.image-handle')).toHaveCount(4);

  // Escala real del DOM (no asumida): px CSS de la página / pt PDF de la página.
  const cajaPagina = (await page.locator('.page').first().boundingBox())!;
  const escala = cajaPagina.width / pageSizePt.widthPt;

  // Arrastrar el marco 50 px hacia la derecha.
  const cajaAntes = (await box.boundingBox())!;
  const cx = cajaAntes.x + cajaAntes.width / 2, cy = cajaAntes.y + cajaAntes.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 50, cy, { steps: 8 });
  await page.mouse.up();

  const rectMovido = (await (async () => {
    const bytes = await descargar(page, 'sello-movido.pdf');
    const d = await eng.open(bytes);
    const r = eng.listImageObjects(d, 0)[0]!.rectPt;
    eng.close(d);
    return r;
  })());
  const dxEsperadoPt = 50 / escala;
  expect(Math.abs((rectMovido.xPt - rectInicial.xPt) - dxEsperadoPt)).toBeLessThan(3);
  expect(Math.abs(rectMovido.yPt - rectInicial.yPt)).toBeLessThan(3);

  // Arrastrar la esquina inferior-derecha → crece.
  const handleSE = box.locator('.image-handle-se');
  const cajaHandle = (await handleSE.boundingBox())!;
  const hx = cajaHandle.x + cajaHandle.width / 2, hy = cajaHandle.y + cajaHandle.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + 40, hy + 40, { steps: 8 });
  await page.mouse.up();

  const rectCrecido = (await (async () => {
    const bytes = await descargar(page, 'sello-crecido.pdf');
    const d = await eng.open(bytes);
    const r = eng.listImageObjects(d, 0)[0]!.rectPt;
    eng.close(d);
    return r;
  })());
  expect(rectCrecido.wPt).toBeGreaterThan(rectMovido.wPt);
  expect(rectCrecido.hPt).toBeGreaterThan(rectMovido.hPt);

  // Suprimir con la imagen seleccionada → desaparece.
  await page.keyboard.press('Delete');
  await expect(box).toHaveCount(0);

  // Deshacer → vuelve.
  await page.locator('#btn-undo').click();
  await expect(box).toHaveCount(1);
});

// #20 de la tabla de paridad (§9): firma subiendo una imagen, quitando el fondo.
test('firma desde imagen: quita el fondo blanco y no tapa el texto de la página que hay debajo', async ({ page }) => {
  const eng = await PdfiumEngine.create();

  // Región ESTRECHA, bien dentro de la línea de referencia del fixture
  // nativo.pdf (generar-fixtures.mjs, pdfNativo: 'Este documento contiene
  // texto nativo seleccionable.' en x=60,y=700,size=12) Y bien dentro del
  // área que va a cubrir la firma (180×90pt) tras colocarla encima: así, si
  // el fondo blanco NO se hubiera quitado, esta región saldría casi
  // enteramente blanca (cubierta a propósito, no solo rozada en el borde).
  const regionPt = { x0: 120, x1: 270, y0: 696, y1: 708 };
  const contarOscuros = (eng2: PdfiumEngine, doc: number, scale: number): number => {
    const { width, data } = eng2.renderPage(doc, 0, scale);
    const x0 = Math.round(regionPt.x0 * scale), x1 = Math.round(regionPt.x1 * scale);
    // Y de render = (alturaPagina - yPt) * escala (origen PDF abajo-izq → arriba-izq).
    const pageH = 841.89;
    const y0 = Math.round((pageH - regionPt.y1) * scale), y1 = Math.round((pageH - regionPt.y0) * scale);
    let oscuros = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (y * width + x) * 4;
        if (data[idx]! < 100 && data[idx + 1]! < 100 && data[idx + 2]! < 100) oscuros++;
      }
    }
    return oscuros;
  };

  const scale = 2;
  const docBase = await eng.open(new Uint8Array(fs.readFileSync(PDF)));
  const oscurosAntes = contarOscuros(eng, docBase, scale);
  expect(oscurosAntes).toBeGreaterThan(0); // el texto está ahí antes de tocar nada
  eng.close(docBase);

  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(PDF);
  await expect(page.locator('.run').first()).toBeVisible();

  // Aleja el zoom para que la página quepa ENTERA en el viewport: la firma
  // se coloca cerca del borde inferior (15% de alto) y hay que arrastrarla
  // cerca del borde superior (línea de referencia); si la página excede el
  // viewport (con "ajustar ancho" al abrir, la altura puede superarlo de
  // sobra), origen y destino del arrastre no son visibles a la vez y
  // `page.mouse` cae fuera de la ventana real — el gesto no llega a
  // `.image-box` y el navegador hace una selección de texto nativa en su
  // lugar (detectado a mano, ver §2.8 del informe de este PR).
  for (let i = 0; i < 5; i++) await page.locator('#btn-zoom-out').click();

  await page.locator('#btn-sign-upload').setInputFiles(FIRMA);
  await expect(page.locator('#status')).toHaveText('Firma insertada desde imagen (fondo quitado).');

  const box = page.locator('.image-box.selected');
  await expect(box).toHaveCount(1);

  // La firma queda seleccionada (#20): arrastrarla hasta encima de la línea de referencia.
  const cajaPagina = (await page.locator('.page').first().boundingBox())!;
  const escalaReal = cajaPagina.width / 595.28;
  const objetivoX = cajaPagina.x + ((regionPt.x0 + regionPt.x1) / 2) * escalaReal;
  const objetivoY = cajaPagina.y + (841.89 - (regionPt.y0 + regionPt.y1) / 2) * escalaReal;

  const cajaFirma = (await box.boundingBox())!;
  const cx = cajaFirma.x + cajaFirma.width / 2, cy = cajaFirma.y + cajaFirma.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(objetivoX, objetivoY, { steps: 10 });
  await page.mouse.up();

  const bytes = await descargar(page, 'firma-sobre-texto.pdf');
  const docFinal = await eng.open(bytes);
  const oscurosDespues = contarOscuros(eng, docFinal, scale);
  eng.close(docFinal);

  // El texto (u otro trazo oscuro, incluida la propia firma) sigue visible:
  // si el fondo blanco de la firma no se hubiera quitado, esta región saldría
  // casi enteramente blanca y este recuento caería muy por debajo del original.
  expect(oscurosDespues).toBeGreaterThan(oscurosAntes * 0.4);
});
