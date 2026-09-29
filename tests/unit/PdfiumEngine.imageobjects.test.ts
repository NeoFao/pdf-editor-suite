import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';

function imagenRoja(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = 255; rgba[i * 4 + 3] = 255; }
  return rgba;
}

test('listImageObjects devuelve las imágenes de la página con su caja actual', async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());

  expect(eng.listImageObjects(doc, 0)).toEqual([]);

  expect(eng.insertImage(doc, 0, { rgba: imagenRoja(4, 4), imgWidth: 4, imgHeight: 4, xPt: 50, yPt: 60, wPt: 100, hPt: 80 })).toBe(true);

  const imgs = eng.listImageObjects(doc, 0);
  expect(imgs.length).toBe(1);
  expect(imgs[0]!.rectPt.xPt).toBeCloseTo(50, 1);
  expect(imgs[0]!.rectPt.yPt).toBeCloseTo(60, 1);
  expect(imgs[0]!.rectPt.wPt).toBeCloseTo(100, 1);
  expect(imgs[0]!.rectPt.hPt).toBeCloseTo(80, 1);
  eng.close(doc);
});

test('listImageObjects no incluye runs de texto ni trazos, solo imágenes', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([300, 200]);
  p.drawText('hola', { x: 20, y: 150, size: 14, font: f, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  eng.drawStroke(doc, 0, [{ xPt: 10, yPt: 10 }, { xPt: 50, yPt: 50 }], [0, 0, 0], 2);
  expect(eng.insertImage(doc, 0, { rgba: imagenRoja(2, 2), imgWidth: 2, imgHeight: 2, xPt: 10, yPt: 10, wPt: 20, hPt: 20 })).toBe(true);

  const imgs = eng.listImageObjects(doc, 0);
  expect(imgs.length).toBe(1);
  eng.close(doc);
});

test('setObjectRect mueve y redimensiona la imagen (±0.5pt) y persiste tras guardar y reabrir', async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 300]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  eng.insertImage(doc, 0, { rgba: imagenRoja(4, 4), imgWidth: 4, imgHeight: 4, xPt: 10, yPt: 10, wPt: 50, hPt: 50 });
  const antes = eng.listImageObjects(doc, 0)[0]!;

  const nuevoRect = { xPt: 100, yPt: 120, wPt: 90, hPt: 40 };
  expect(eng.setObjectRect(doc, 0, antes.objIndex, nuevoRect)).toBe(true);

  const movido = eng.listImageObjects(doc, 0)[0]!;
  expect(movido.rectPt.xPt).toBeCloseTo(nuevoRect.xPt, 0);
  expect(movido.rectPt.yPt).toBeCloseTo(nuevoRect.yPt, 0);
  expect(movido.rectPt.wPt).toBeCloseTo(nuevoRect.wPt, 0);
  expect(movido.rectPt.hPt).toBeCloseTo(nuevoRect.hPt, 0);

  // Persiste tras guardar y reabrir (no es solo estado en memoria de este objeto).
  const reabierto = await eng.open(eng.save(doc));
  const persistido = eng.listImageObjects(reabierto, 0)[0]!;
  expect(persistido.rectPt.xPt).toBeCloseTo(nuevoRect.xPt, 0);
  expect(persistido.rectPt.yPt).toBeCloseTo(nuevoRect.yPt, 0);
  expect(persistido.rectPt.wPt).toBeCloseTo(nuevoRect.wPt, 0);
  expect(persistido.rectPt.hPt).toBeCloseTo(nuevoRect.hPt, 0);
  eng.close(doc);
  eng.close(reabierto);
});

test('setObjectRect devuelve false para un objIndex que no es imagen', async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 200]);
  p.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  expect(eng.setObjectRect(doc, 0, 0, { xPt: 0, yPt: 0, wPt: 10, hPt: 10 })).toBe(false);
  eng.close(doc);
});

test('deleteObject elimina la imagen de la página', async () => {
  const d = await PDFDocument.create();
  d.addPage([200, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  eng.insertImage(doc, 0, { rgba: imagenRoja(2, 2), imgWidth: 2, imgHeight: 2, xPt: 10, yPt: 10, wPt: 50, hPt: 50 });
  const img = eng.listImageObjects(doc, 0)[0]!;

  expect(eng.deleteObject(doc, 0, img.objIndex)).toBe(true);
  expect(eng.listImageObjects(doc, 0)).toEqual([]);

  const reabierto = await eng.open(eng.save(doc));
  expect(eng.listImageObjects(reabierto, 0)).toEqual([]);
  eng.close(doc);
  eng.close(reabierto);
});

test('deleteObject devuelve false para un índice inexistente', async () => {
  const d = await PDFDocument.create();
  d.addPage([200, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  expect(eng.deleteObject(doc, 0, 5)).toBe(false);
  eng.close(doc);
});
