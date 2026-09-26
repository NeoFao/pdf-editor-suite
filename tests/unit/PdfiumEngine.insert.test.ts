import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument } from 'pdf-lib';

test('insertText añade un run nuevo con texto, tamaño y posición dados', async () => {
  const d = await PDFDocument.create();
  d.addPage([320, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  expect(eng.getPageText(doc, 0)).toEqual([]); // página vacía

  const runId = eng.insertText(doc, 0, { xPt: 50, yPt: 120, text: 'TEXTO NUEVO', sizePt: 20, color: [10, 20, 200] });
  expect(runId).toBeGreaterThanOrEqual(0);

  // Persiste tras guardar y reabrir, y es extraíble.
  const runs = eng.getPageText(await eng.open(eng.save(doc)), 0);
  const nuevo = runs.find((r) => r.text.includes('TEXTO NUEVO'));
  expect(nuevo).toBeDefined();
  expect(Math.round(nuevo!.sizePt)).toBe(20);
  expect(Math.round(nuevo!.boxPt.xPt)).toBeGreaterThanOrEqual(45);
  expect(Math.round(nuevo!.boxPt.yPt)).toBeGreaterThanOrEqual(110);
  eng.close(doc);
});
