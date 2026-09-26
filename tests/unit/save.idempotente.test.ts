import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

test('guardar-dos-veces-es-idempotente: mismo texto y sin duplicar el run editado', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.TimesRoman);
  const p = d.addPage([320, 200]);
  p.drawText('ORIGINAL', { x: 40, y: 150, size: 18, font: f, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const run = eng.getPageText(doc, 0).find((r) => r.text.includes('ORIGINAL'))!;
  eng.editTextRun(doc, 0, run.runId, 'EDITADO');

  const a = eng.save(doc);
  const b = eng.save(doc);

  const runsA = eng.getPageText(await eng.open(a), 0);
  const runsB = eng.getPageText(await eng.open(b), 0);
  const textosA = runsA.map((r) => r.text).sort();
  const textosB = runsB.map((r) => r.text).sort();
  expect(textosA).toEqual(textosB);                         // guardar 2 veces = igual
  expect(runsA.filter((r) => r.text.includes('EDITADO')).length).toBe(1); // no duplicado
  expect(runsA.some((r) => r.text.includes('EDITADO'))).toBe(true);
  eng.close(doc);
});
