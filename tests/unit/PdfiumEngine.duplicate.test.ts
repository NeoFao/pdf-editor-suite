import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

test('duplicatePage inserta una copia justo después', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p0 = d.addPage([300, 200]); p0.drawText('UNO', { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  const p1 = d.addPage([300, 200]); p1.drawText('DOS', { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  expect(eng.duplicatePage(doc, 0)).toBe(true);
  expect(eng.pageCount(doc)).toBe(3);
  const t = (i: number) => eng.getPageText(doc, i).map((r) => r.text).join(' ');
  expect(t(0)).toContain('UNO');
  expect(t(1)).toContain('UNO'); // la copia
  expect(t(2)).toContain('DOS');
  eng.close(doc);
});
