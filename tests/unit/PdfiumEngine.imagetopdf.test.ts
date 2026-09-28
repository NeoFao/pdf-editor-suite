import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';

test('imageToPdf crea un PDF de una página con la imagen visible', async () => {
  const eng = await PdfiumEngine.create();
  const w = 16, h = 12;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i*4] = 255; rgba[i*4+3] = 255; } // rojo opaco
  const bytes = eng.imageToPdf(rgba, w, h);
  expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');

  const doc = await eng.open(bytes);
  expect(eng.pageCount(doc)).toBe(1);
  const s = eng.pageSize(doc, 0);
  expect(Math.round(s.widthPt)).toBe(16);
  expect(Math.round(s.heightPt)).toBe(12);
  const { data } = eng.renderPage(doc, 0, 1);
  let rojo = false;
  for (let i = 0; i < data.length; i += 4) if (data[i]! > 180 && data[i+1]! < 90 && data[i+2]! < 90) { rojo = true; break; }
  expect(rojo).toBe(true);
  eng.close(doc);
});
