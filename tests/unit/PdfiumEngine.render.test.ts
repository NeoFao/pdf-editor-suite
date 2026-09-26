import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

test('renderPage devuelve un bitmap RGBA del tamaño esperado y con contenido', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([320, 200]);
  p.drawText('CONTENIDO', { x: 40, y: 150, size: 24, font: f, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const r = eng.renderPage(doc, 0, 1);
  expect(r.width).toBe(320);
  expect(r.height).toBe(200);
  expect(r.data.length).toBe(320 * 200 * 4);
  // No es todo blanco: hay al menos un píxel oscuro (el texto).
  let hayTinta = false;
  for (let i = 0; i < r.data.length; i += 4) {
    if (r.data[i]! < 128 && r.data[i + 1]! < 128 && r.data[i + 2]! < 128) { hayTinta = true; break; }
  }
  expect(hayTinta).toBe(true);
  eng.close(doc);
});
