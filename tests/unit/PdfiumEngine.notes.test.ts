import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';

test('addNote crea una nota Text que persiste tras guardar y reabrir; removeNote la quita', async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());

  expect(eng.getNotes(doc, 0)).toEqual([]);

  const idx = eng.addNote(doc, 0, { xPt: 50, yPt: 150, text: 'Revisar cifra — año' });
  expect(idx).toBeGreaterThanOrEqual(0);

  const notas = eng.getNotes(doc, 0);
  expect(notas).toHaveLength(1);
  expect(notas[0]!.text).toBe('Revisar cifra — año');
  expect(notas[0]!.index).toBe(idx);
  // Rect de 20×20 pt con esquina inferior-izquierda en (xPt, yPt − 20).
  expect(notas[0]!.rectPt.xPt).toBeCloseTo(50, 1);
  expect(notas[0]!.rectPt.yPt).toBeCloseTo(130, 1);
  expect(notas[0]!.rectPt.wPt).toBeCloseTo(20, 1);
  expect(notas[0]!.rectPt.hPt).toBeCloseTo(20, 1);

  // Persiste tras guardar y reabrir.
  const doc2 = await eng.open(eng.save(doc));
  const notasTrasGuardar = eng.getNotes(doc2, 0);
  expect(notasTrasGuardar).toHaveLength(1);
  expect(notasTrasGuardar[0]!.text).toBe('Revisar cifra — año');

  const quitada = eng.removeNote(doc2, 0, notasTrasGuardar[0]!.index);
  expect(quitada).toBe(true);
  expect(eng.getNotes(doc2, 0)).toHaveLength(0);

  eng.close(doc);
  eng.close(doc2);
});
