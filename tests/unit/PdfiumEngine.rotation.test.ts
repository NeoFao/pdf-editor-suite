import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, degrees } from 'pdf-lib';

test('pageRotation lee la rotación real de la página', async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 200]);
  const p1 = d.addPage([300, 200]);
  p1.setRotation(degrees(90));
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  expect(eng.pageRotation(doc, 0)).toBe(0);
  expect(eng.pageRotation(doc, 1)).toBe(90);
  eng.close(doc);
});
