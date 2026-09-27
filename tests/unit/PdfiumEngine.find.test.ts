import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function docBusqueda(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([320, 200]);
  p.drawText('ORIGINAL aqui', { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  p.drawText('otra ORIGINAL linea', { x: 40, y: 100, size: 16, font: f, color: rgb(0, 0, 0) });
  return d.save();
}

test('findText encuentra todas las coincidencias con su caja', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docBusqueda());
  const m = eng.findText(doc, 0, 'ORIGINAL');
  expect(m.length).toBe(2);
  for (const r of m) { expect(r.wPt).toBeGreaterThan(0); expect(r.hPt).toBeGreaterThan(0); }
  expect(Math.abs(m[0]!.xPt - 40)).toBeLessThan(12);
  eng.close(doc);
});

test('findText es insensible a mayúsculas y devuelve [] si no hay coincidencias', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docBusqueda());
  expect(eng.findText(doc, 0, 'original').length).toBe(2);
  expect(eng.findText(doc, 0, 'NOEXISTE')).toEqual([]);
  eng.close(doc);
});
