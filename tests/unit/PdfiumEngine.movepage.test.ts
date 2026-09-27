import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function docTres(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (const t of ['UNO', 'DOS', 'TRES']) {
    const p = d.addPage([300, 200]); p.drawText(t, { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  }
  return d.save();
}
const txt = (eng: PdfiumEngine, doc: number, i: number) => eng.getPageText(doc, i).map((r) => r.text).join(' ');

test('movePage reordena y su inverso lo revierte', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docTres());
  expect(eng.movePage(doc, 0, 1)).toBe(true); // UNO de 0 a 1 → [DOS, UNO, TRES]
  expect(txt(eng, doc, 0)).toContain('DOS');
  expect(txt(eng, doc, 1)).toContain('UNO');
  eng.movePage(doc, 1, 0); // inverso
  expect(txt(eng, doc, 0)).toContain('UNO');
  expect(txt(eng, doc, 1)).toContain('DOS');
  eng.close(doc);
});
