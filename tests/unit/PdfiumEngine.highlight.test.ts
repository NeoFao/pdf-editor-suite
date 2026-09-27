import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument } from 'pdf-lib';

test('highlightRect pinta un rectángulo amarillo visible al renderizar', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  expect(eng.highlightRect(doc, 0, { xPt: 40, yPt: 120, wPt: 160, hPt: 24 }, [255, 235, 0])).toBe(true);

  const { data } = eng.renderPage(await eng.open(eng.save(doc)), 0, 1);
  let amarillo = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! > 200 && data[i+1]! > 180 && data[i+2]! < 120) { amarillo = true; break; }
  }
  expect(amarillo).toBe(true);
  eng.close(doc);
});
