import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

test('setRunColor cambia el color del run (verificable tras guardar)', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([320, 200]);
  p.drawText('COLOR', { x: 40, y: 150, size: 16, font: f, color: rgb(0.85, 0.1, 0.1) }); // rojo
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const antes = eng.getPageText(doc, 0).find((r) => r.text.includes('COLOR'))!;
  expect(antes.color[0]).toBeGreaterThan(200); // rojo

  expect(eng.setRunColor(doc, 0, antes.runId, [10, 20, 200])).toBe(true); // a azul

  const despues = eng.getPageText(await eng.open(eng.save(doc)), 0).find((r) => r.text.includes('COLOR'))!;
  expect(despues.color[2]).toBeGreaterThan(150); // azul alto
  expect(despues.color[0]).toBeLessThan(80);     // rojo bajo
  eng.close(doc);
});
