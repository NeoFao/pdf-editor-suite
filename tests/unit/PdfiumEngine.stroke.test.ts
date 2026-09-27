import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument } from 'pdf-lib';

test('drawStroke pinta una polilínea visible al renderizar', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const pts = [{ xPt: 30, yPt: 100 }, { xPt: 150, yPt: 150 }, { xPt: 270, yPt: 100 }];
  expect(eng.drawStroke(doc, 0, pts, [255, 0, 0], 4)).toBe(true);

  const { data } = eng.renderPage(await eng.open(eng.save(doc)), 0, 1);
  let rojo = false;
  for (let i = 0; i < data.length; i += 4) if (data[i]! > 180 && data[i+1]! < 90 && data[i+2]! < 90) { rojo = true; break; }
  expect(rojo).toBe(true);

  expect(eng.drawStroke(doc, 0, [{ xPt: 1, yPt: 1 }], [0, 0, 0], 2)).toBe(false); // menos de 2 puntos
  eng.close(doc);
});
