import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument } from 'pdf-lib';

test('insertImage coloca una imagen que se ve al renderizar la página', async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());

  // Imagen 8x8 roja (RGBA).
  const w = 8, h = 8;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i*4] = 255; rgba[i*4+1] = 0; rgba[i*4+2] = 0; rgba[i*4+3] = 255; }
  expect(eng.insertImage(doc, 0, { rgba, imgWidth: w, imgHeight: h, xPt: 60, yPt: 60, wPt: 120, hPt: 90 })).toBe(true);

  // Al renderizar, debe existir al menos un píxel claramente rojo.
  const { data } = eng.renderPage(await eng.open(eng.save(doc)), 0, 1);
  let rojo = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! > 180 && data[i+1]! < 90 && data[i+2]! < 90) { rojo = true; break; }
  }
  expect(rojo).toBe(true);
  eng.close(doc);
});
