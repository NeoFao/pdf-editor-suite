import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

test('deleteRun elimina el texto DE VERDAD: no queda extraíble tras guardar (E-024)', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([320, 200]);
  p.drawText('DATO-CONFIDENCIAL', { x: 40, y: 150, size: 14, font: f, color: rgb(0, 0, 0) });
  p.drawText('texto que se queda', { x: 40, y: 110, size: 12, font: f, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const objetivo = eng.getPageText(doc, 0).find((r) => r.text.includes('CONFIDENCIAL'))!;

  expect(eng.deleteRun(doc, 0, objetivo.runId)).toBe(true);

  // Tras guardar y reabrir, el texto ya no se puede extraer (no es una máscara).
  const runs = eng.getPageText(await eng.open(eng.save(doc)), 0);
  const textos = runs.map((r) => r.text).join(' | ');
  expect(textos).not.toContain('CONFIDENCIAL');
  expect(textos).toContain('se queda');
  eng.close(doc);
});

test('deleteRun devuelve false si el runId no es texto', async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 200]);
  p.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  expect(eng.deleteRun(doc, 0, 0)).toBe(false);
  eng.close(doc);
});
