import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function unaPagina(texto: string): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([300, 200]); p.drawText(texto, { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  return d.save();
}

test('importPages inserta las páginas de otro PDF en la posición dada', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await unaPagina('DEST'));
  expect(eng.pageCount(doc)).toBe(1);
  expect(eng.importPages(doc, await unaPagina('EXTRA'), 1)).toBe(true);
  expect(eng.pageCount(doc)).toBe(2);
  expect(eng.getPageText(doc, 1).map((r) => r.text).join(' ')).toContain('EXTRA');
  eng.close(doc);
});
