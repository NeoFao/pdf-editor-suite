import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Fixture con un único run en Times-Roman incrustado, tamaño y color
 * conocidos, para los tests de `setRunFontSize`/`setRunFont` (panel de
 * propiedades). A diferencia de `PdfiumEngine.standardfont.test.ts`
 * (subconjunto sin glifos latinos), aquí la fuente original SÍ cubre el
 * texto: lo que se prueba es que el tamaño/la fuente cambian sin tocar lo
 * demás, no la ruta de sustitución por glifo faltante.
 */
async function conUnRun(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const times = await d.embedFont(StandardFonts.TimesRoman);
  const p = d.addPage([320, 200]);
  p.drawText('Texto de prueba', { x: 72, y: 120, size: 14, font: times, color: rgb(0.2, 0.4, 0.6) });
  return d.save();
}

// --- setRunFontSize ---------------------------------------------------

test('setRunFontSize cambia el tamaño y conserva la MISMA fuente, texto, color y origen', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await conUnRun());
  const original = eng.getPageText(doc, 0)[0]!;

  const res = eng.setRunFontSize(doc, 0, original.runId, 24);
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error('unreachable');

  const runs = eng.getPageText(doc, 0);
  expect(runs).toHaveLength(1);
  const nuevo = runs[0]!;
  expect(nuevo.runId).toBe(res.runId);
  expect(Math.round(nuevo.sizePt)).toBe(24);
  expect(nuevo.text).toBe('Texto de prueba');
  // Misma fuente incrustada (no Helvetica por defecto).
  expect(nuevo.fontName).toBe(original.fontName);
  expect(nuevo.fontName).toContain('Times');
  expect(nuevo.color[0]).toBe(original.color[0]);
  expect(nuevo.color[1]).toBe(original.color[1]);
  expect(nuevo.color[2]).toBe(original.color[2]);
  expect(Math.abs(nuevo.originPt.xPt - original.originPt.xPt)).toBeLessThan(0.5);
  expect(Math.abs(nuevo.originPt.yPt - original.originPt.yPt)).toBeLessThan(0.5);

  eng.close(doc);
});

test('setRunFontSize persiste tras save + open', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await conUnRun());
  const original = eng.getPageText(doc, 0)[0]!;
  const res = eng.setRunFontSize(doc, 0, original.runId, 24);
  expect(res.ok).toBe(true);

  const bytes = eng.save(doc);
  const doc2 = await eng.open(bytes);
  const nuevo = eng.getPageText(doc2, 0)[0]!;
  expect(Math.round(nuevo.sizePt)).toBe(24);
  expect(nuevo.fontName).toBe(original.fontName);
  expect(nuevo.text).toBe('Texto de prueba');
  expect(Math.abs(nuevo.originPt.xPt - original.originPt.xPt)).toBeLessThan(0.5);
  expect(Math.abs(nuevo.originPt.yPt - original.originPt.yPt)).toBeLessThan(0.5);

  eng.close(doc); eng.close(doc2);
});

test('setRunFontSize conserva el z-order entre otros dos runs', async () => {
  const d = await PDFDocument.create();
  const times = await d.embedFont(StandardFonts.TimesRoman);
  const p = d.addPage([320, 200]);
  p.drawText('primera', { x: 40, y: 160, size: 12, font: times });
  p.drawText('media', { x: 40, y: 130, size: 12, font: times });
  p.drawText('tercera', { x: 40, y: 100, size: 12, font: times });

  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const medio = eng.getPageText(doc, 0).find((r) => r.text === 'media')!;
  expect(medio.runId).toBe(1);

  const res = eng.setRunFontSize(doc, 0, medio.runId, 20);
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error('unreachable');
  expect(res.runId).toBe(1);

  const runs = eng.getPageText(doc, 0);
  expect(runs.find((r) => r.runId === 0)!.text).toBe('primera');
  expect(runs.find((r) => r.runId === 1)!.text).toBe('media');
  expect(runs.find((r) => r.runId === 2)!.text).toBe('tercera');
  eng.close(doc);
});

test('setRunFontSize con 0 devuelve invalid-size y no modifica nada', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await conUnRun());
  const original = eng.getPageText(doc, 0)[0]!;

  const res = eng.setRunFontSize(doc, 0, original.runId, 0);
  expect(res).toEqual({ ok: false, reason: 'invalid-size' });

  const runs = eng.getPageText(doc, 0);
  expect(runs).toHaveLength(1);
  expect(Math.round(runs[0]!.sizePt)).toBe(14);
  eng.close(doc);
});

test('setRunFontSize con 500 devuelve invalid-size y no modifica nada', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await conUnRun());
  const original = eng.getPageText(doc, 0)[0]!;

  const res = eng.setRunFontSize(doc, 0, original.runId, 500);
  expect(res).toEqual({ ok: false, reason: 'invalid-size' });

  const runs = eng.getPageText(doc, 0);
  expect(runs).toHaveLength(1);
  expect(Math.round(runs[0]!.sizePt)).toBe(14);
  eng.close(doc);
});

test('setRunFontSize sobre un objeto que no es texto devuelve not-a-text-run', async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 200]);
  p.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const res = eng.setRunFontSize(doc, 0, 0, 20);
  expect(res).toEqual({ ok: false, reason: 'not-a-text-run' });
  eng.close(doc);
});

// --- setRunFont ---------------------------------------------------------

test('setRunFont cambia la fuente y conserva tamaño, texto y posición', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await conUnRun());
  const original = eng.getPageText(doc, 0)[0]!;

  const res = eng.setRunFont(doc, 0, original.runId, 'Courier-Bold');
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error('unreachable');
  expect(res.fontName).toBe('Courier-Bold');

  const nuevo = eng.getPageText(doc, 0).find((r) => r.runId === res.runId)!;
  expect(nuevo.fontName).toContain('Courier');
  expect(nuevo.text).toBe('Texto de prueba');
  expect(Math.round(nuevo.sizePt)).toBe(14);
  expect(Math.abs(nuevo.originPt.xPt - original.originPt.xPt)).toBeLessThan(0.5);
  expect(Math.abs(nuevo.originPt.yPt - original.originPt.yPt)).toBeLessThan(0.5);

  eng.close(doc);
});

test('setRunFont con un nombre fuera de la lista estándar no modifica nada', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await conUnRun());
  const original = eng.getPageText(doc, 0)[0]!;

  const res = eng.setRunFont(doc, 0, original.runId, 'Comic-Sans-Falsa');
  expect(res).toEqual({ ok: false, reason: 'invalid-font' });

  const runs = eng.getPageText(doc, 0);
  expect(runs).toHaveLength(1);
  expect(runs[0]!.fontName).toBe(original.fontName);
  eng.close(doc);
});

test('setRunFont sobre un objeto que no es texto devuelve not-a-text-run', async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 200]);
  p.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const res = eng.setRunFont(doc, 0, 0, 'Helvetica');
  expect(res).toEqual({ ok: false, reason: 'not-a-text-run' });
  eng.close(doc);
});
