import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument } from 'pdf-lib';

test('fillRect pinta un rectángulo rojo opaco visible al renderizar', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  expect(eng.fillRect(doc, 0, { xPt: 40, yPt: 120, wPt: 160, hPt: 24 }, [220, 20, 20])).toBe(true);

  const { data } = eng.renderPage(await eng.open(eng.save(doc)), 0, 1);
  let rojo = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! > 170 && data[i+1]! < 100 && data[i+2]! < 100) { rojo = true; break; }
  }
  expect(rojo).toBe(true);
  eng.close(doc);
});
