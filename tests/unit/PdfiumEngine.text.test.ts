import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

test('extrae un run con texto, fuente, tamaño y color', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.TimesRoman);
  const p = d.addPage([320, 200]);
  p.drawText('HOLA', { x: 40, y: 150, size: 18, font: f, color: rgb(0.85, 0.1, 0.1) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const runs = eng.getPageText(doc, 0);
  const run = runs.find((r) => r.text.includes('HOLA'));
  expect(run).toBeDefined();
  expect(run!.fontName).toContain('Times');
  expect(Math.round(run!.sizePt)).toBe(18);
  expect(run!.color[0]).toBeGreaterThan(200); // rojo
  expect(run!.boxPt.wPt).toBeGreaterThan(0);
  eng.close(doc);
});

test('pagina-sin-texto-devuelve-vacio (escaneado): getPageText no lanza y da []', async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 200]);
  p.drawRectangle({ x: 20, y: 20, width: 80, height: 40, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  expect(eng.getPageText(doc, 0)).toEqual([]);
  eng.close(doc);
});
