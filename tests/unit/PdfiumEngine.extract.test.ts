import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function docTres(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (const t of ['UNO', 'DOS', 'TRES']) { const p = d.addPage([300, 200]); p.drawText(t, { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) }); }
  return d.save();
}

test('extractPages crea un PDF nuevo con solo las páginas elegidas, en orden', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docTres());
  const bytes = eng.extractPages(doc, [0, 2]); // UNO y TRES
  expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');

  const extraido = await eng.open(bytes);
  expect(eng.pageCount(extraido)).toBe(2);
  expect(eng.getPageText(extraido, 0).map((r) => r.text).join(' ')).toContain('UNO');
  expect(eng.getPageText(extraido, 1).map((r) => r.text).join(' ')).toContain('TRES');
  eng.close(doc); eng.close(extraido);
});
