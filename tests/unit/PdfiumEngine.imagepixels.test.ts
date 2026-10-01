import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { JPEG_2X2_ROJO } from './_jpegsFijos';

// `replaceImageJpeg` necesita un JPEG YA CODIFICADO de verdad: bytes fijos en
// ./_jpegsFijos.ts (generados una vez con Chromium), no un navegador dentro de
// Vitest (E-049).

function imagenDegradado(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = Math.round((x / (w - 1)) * 255);
      rgba[i + 1] = Math.round((y / (h - 1)) * 255);
      rgba[i + 2] = 128;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

test('getImagePixels devuelve el bitmap a su resolución nativa (BGRA→RGBA)', async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const original = imagenDegradado(8, 6);
  eng.insertImage(doc, 0, { rgba: original, imgWidth: 8, imgHeight: 6, xPt: 20, yPt: 20, wPt: 80, hPt: 60 });

  const img = eng.listImageObjects(doc, 0)[0]!;
  const pix = eng.getImagePixels(doc, 0, img.objIndex);
  expect(pix).not.toBeNull();
  expect(pix!.width).toBe(8);
  expect(pix!.height).toBe(6);
  expect(pix!.rgba.length).toBe(8 * 6 * 4);
  // Compara con tolerancia mínima (por si el motor recodifica el bitmap internamente).
  for (let i = 0; i < original.length; i++) {
    expect(Math.abs(pix!.rgba[i]! - original[i]!)).toBeLessThanOrEqual(1);
  }
  eng.close(doc);
});

test('getImagePixels devuelve null si el objIndex no es una imagen', async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 200]);
  p.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  expect(eng.getImagePixels(doc, 0, 0)).toBeNull();
  eng.close(doc);
});

test('replaceImagePixels: viaje de ida y vuelta conservando la MATRIZ (rect ±0.5pt), persiste tras guardar y reabrir', async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 300]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  eng.insertImage(doc, 0, { rgba: imagenDegradado(4, 4), imgWidth: 4, imgHeight: 4, xPt: 30, yPt: 40, wPt: 90, hPt: 70 });

  const antes = eng.listImageObjects(doc, 0)[0]!;
  const rectAntes = antes.rectPt;

  const nuevaImagen = imagenDegradado(20, 16); // resolución NATIVA distinta a la original
  const ok = eng.replaceImagePixels(doc, 0, antes.objIndex, nuevaImagen, 20, 16);
  expect(ok).toBe(true);

  const despues = eng.listImageObjects(doc, 0)[0]!;
  expect(despues.rectPt.xPt).toBeCloseTo(rectAntes.xPt, 0);
  expect(despues.rectPt.yPt).toBeCloseTo(rectAntes.yPt, 0);
  expect(despues.rectPt.wPt).toBeCloseTo(rectAntes.wPt, 0);
  expect(despues.rectPt.hPt).toBeCloseTo(rectAntes.hPt, 0);

  const pix = eng.getImagePixels(doc, 0, despues.objIndex);
  expect(pix!.width).toBe(20);
  expect(pix!.height).toBe(16);

  // Persiste tras guardar y reabrir (no solo en memoria).
  const reabierto = await eng.open(eng.save(doc));
  const persistido = eng.listImageObjects(reabierto, 0)[0]!;
  expect(Math.abs(persistido.rectPt.xPt - rectAntes.xPt)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(persistido.rectPt.yPt - rectAntes.yPt)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(persistido.rectPt.wPt - rectAntes.wPt)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(persistido.rectPt.hPt - rectAntes.hPt)).toBeLessThanOrEqual(0.5);
  const pixPersistido = eng.getImagePixels(reabierto, 0, persistido.objIndex);
  expect(pixPersistido!.width).toBe(20);
  expect(pixPersistido!.height).toBe(16);

  eng.close(doc);
  eng.close(reabierto);
});

test('replaceImagePixels devuelve false para un objIndex que no es imagen', async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 200]);
  p.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  expect(eng.replaceImagePixels(doc, 0, 0, imagenDegradado(2, 2), 2, 2)).toBe(false);
  eng.close(doc);
});

test('filtrar una imagen no toca el texto vectorial de la misma página (getPageText igual antes y después)', async () => {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([300, 300]);
  p.drawText('texto vectorial intacto', { x: 20, y: 250, size: 14, font });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  eng.insertImage(doc, 0, { rgba: imagenDegradado(6, 6), imgWidth: 6, imgHeight: 6, xPt: 20, yPt: 20, wPt: 100, hPt: 100 });

  const textoAntes = eng.getPageText(doc, 0).map((r) => r.text);

  const img = eng.listImageObjects(doc, 0)[0]!;
  const pix = eng.getImagePixels(doc, 0, img.objIndex)!;
  // Filtro trivial: invierte los canales de color (no hace falta importar filtros.ts aquí).
  const invertido = new Uint8Array(pix.rgba.length);
  for (let i = 0; i < pix.rgba.length; i += 4) {
    invertido[i] = 255 - pix.rgba[i]!;
    invertido[i + 1] = 255 - pix.rgba[i + 1]!;
    invertido[i + 2] = 255 - pix.rgba[i + 2]!;
    invertido[i + 3] = pix.rgba[i + 3]!;
  }
  expect(eng.replaceImagePixels(doc, 0, img.objIndex, invertido, pix.width, pix.height)).toBe(true);

  const textoDespues = eng.getPageText(doc, 0).map((r) => r.text);
  expect(textoDespues).toEqual(textoAntes);
  eng.close(doc);
});

test('replaceImageJpeg: sustituye por un JPEG ya codificado conservando la matriz', async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 300]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  eng.insertImage(doc, 0, { rgba: imagenDegradado(10, 10), imgWidth: 10, imgHeight: 10, xPt: 25, yPt: 35, wPt: 60, hPt: 50 });

  const antes = eng.listImageObjects(doc, 0)[0]!;
  const rectAntes = antes.rectPt;

  const ok = eng.replaceImageJpeg(doc, 0, antes.objIndex, JPEG_2X2_ROJO);
  expect(ok).toBe(true);

  const despues = eng.listImageObjects(doc, 0)[0]!;
  expect(despues.rectPt.xPt).toBeCloseTo(rectAntes.xPt, 0);
  expect(despues.rectPt.yPt).toBeCloseTo(rectAntes.yPt, 0);
  expect(despues.rectPt.wPt).toBeCloseTo(rectAntes.wPt, 0);
  expect(despues.rectPt.hPt).toBeCloseTo(rectAntes.hPt, 0);

  const pix = eng.getImagePixels(doc, 0, despues.objIndex)!;
  expect(pix.width).toBe(2);
  expect(pix.height).toBe(2);
  // JPEG con pérdida: tolerancia amplia, pero debe seguir siendo "rojo".
  expect(pix.rgba[0]!).toBeGreaterThan(180);
  expect(pix.rgba[1]!).toBeLessThan(80);
  expect(pix.rgba[2]!).toBeLessThan(80);

  // Persiste tras guardar y reabrir.
  const reabierto = await eng.open(eng.save(doc));
  const persistido = eng.listImageObjects(reabierto, 0)[0]!;
  expect(Math.abs(persistido.rectPt.xPt - rectAntes.xPt)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(persistido.rectPt.wPt - rectAntes.wPt)).toBeLessThanOrEqual(0.5);

  eng.close(doc);
  eng.close(reabierto);
});

test('replaceImageJpeg devuelve false para un objIndex que no es imagen', async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 200]);
  p.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  expect(eng.replaceImageJpeg(doc, 0, 0, JPEG_2X2_ROJO)).toBe(false);
  eng.close(doc);
});
