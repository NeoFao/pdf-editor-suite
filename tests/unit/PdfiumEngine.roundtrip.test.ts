import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function pdfDe(texto: string): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.TimesRoman);
  const p = d.addPage([320, 200]);
  p.drawText(texto, { x: 40, y: 150, size: 18, font: f, color: rgb(0.85, 0.1, 0.1) });
  return d.save();
}

test('abre, cuenta, mide y guarda un PDF válido', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await pdfDe('HOLA'));
  expect(eng.pageCount(doc)).toBe(1);
  const s = eng.pageSize(doc, 0);
  expect(Math.round(s.widthPt)).toBe(320);
  expect(Math.round(s.heightPt)).toBe(200);
  const out = eng.save(doc);
  expect(new TextDecoder().decode(out.subarray(0, 5))).toBe('%PDF-');
  eng.close(doc);
});
