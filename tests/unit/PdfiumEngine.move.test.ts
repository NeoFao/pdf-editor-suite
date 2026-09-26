import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

test('moveRun desplaza el run por el delta dado (y es reversible por delta inverso)', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([320, 200]);
  p.drawText('MOVER', { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const antes = eng.getPageText(doc, 0).find((r) => r.text.includes('MOVER'))!;

  expect(eng.moveRun(doc, 0, antes.runId, 30, 20)).toBe(true);
  const movido = eng.getPageText(doc, 0).find((r) => r.text.includes('MOVER'))!;
  expect(Math.round(movido.boxPt.xPt)).toBe(Math.round(antes.boxPt.xPt) + 30);
  expect(Math.round(movido.boxPt.yPt)).toBe(Math.round(antes.boxPt.yPt) + 20);

  // Delta inverso vuelve al origen (base del deshacer sin snapshot).
  eng.moveRun(doc, 0, antes.runId, -30, -20);
  const vuelta = eng.getPageText(doc, 0).find((r) => r.text.includes('MOVER'))!;
  expect(Math.round(vuelta.boxPt.xPt)).toBe(Math.round(antes.boxPt.xPt));
  expect(Math.round(vuelta.boxPt.yPt)).toBe(Math.round(antes.boxPt.yPt));
  eng.close(doc);
});
