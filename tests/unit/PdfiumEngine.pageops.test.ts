import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function docDos(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p0 = d.addPage([300, 200]); p0.drawText('UNO', { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  const p1 = d.addPage([300, 200]); p1.drawText('DOS', { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  return d.save();
}

test('rotatePage acumula y normaliza; el delta inverso revierte', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docDos());
  expect(eng.rotatePage(doc, 0, 90)).toBe(90);
  expect(eng.pageRotation(doc, 0)).toBe(90);
  expect(eng.rotatePage(doc, 0, 90)).toBe(180);
  expect(eng.rotatePage(doc, 0, -90)).toBe(90); // inverso
  eng.close(doc);
});

test('deletePage elimina la página y reindexa', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docDos());
  expect(eng.pageCount(doc)).toBe(2);
  eng.deletePage(doc, 0);
  expect(eng.pageCount(doc)).toBe(1);
  expect(eng.getPageText(doc, 0).map((r) => r.text).join(' ')).toContain('DOS');
  eng.close(doc);
});
