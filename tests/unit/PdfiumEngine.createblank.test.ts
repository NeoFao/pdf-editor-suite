import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';

test('createBlank crea un PDF de una página en blanco del tamaño pedido', async () => {
  const eng = await PdfiumEngine.create();
  const bytes = eng.createBlank(595, 842); // A4 en puntos PDF
  expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');

  const doc = await eng.open(bytes);
  expect(eng.pageCount(doc)).toBe(1);
  const s = eng.pageSize(doc, 0);
  expect(Math.round(s.widthPt)).toBe(595);
  expect(Math.round(s.heightPt)).toBe(842);
  // Sin objetos de texto ni de otro tipo: página en blanco de verdad.
  expect(eng.getPageText(doc, 0)).toHaveLength(0);
  eng.close(doc);
});
