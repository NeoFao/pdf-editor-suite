import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Fixture con un run en ZapfDingbats (fuente estándar de símbolos, sin
 * ningún glifo latino — ver tests/fixtures/generar-fixtures.mjs para la
 * justificación completa de por qué se eligió esta vía en vez de un
 * subconjunto TrueType real). `editTextRun` a texto latino o CJK sobre este
 * run devuelve `glyph-missing`, igual que un subconjunto real al que le
 * falta el glifo tecleado.
 */
async function subconjunto(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.ZapfDingbats);
  const p = d.addPage([320, 200]);
  p.drawText('✁✂✃✄', { x: 40, y: 130, size: 18, font: f, color: rgb(0.2, 0.4, 0.6) });
  return d.save();
}

test('editTextRun sobre el run de la fixture devuelve glyph-missing para "Mañana €"', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await subconjunto());
  const run = eng.getPageText(doc, 0)[0]!;
  const res = eng.editTextRun(doc, 0, run.runId, 'Mañana €');
  expect(res).toEqual({ ok: false, reason: 'glyph-missing' });
  eng.close(doc);
});

test('replaceRunWithStandardFont sustituye la fuente y aplica "Mañana €"', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await subconjunto());
  const original = eng.getPageText(doc, 0)[0]!;

  const res = eng.replaceRunWithStandardFont(doc, 0, original.runId, 'Mañana €');
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error('unreachable');
  expect(res.fontName).toBe('Helvetica'); // ZapfDingbats no es serif/mono -> Helvetica

  const runs = eng.getPageText(doc, 0);
  const nuevo = runs.find((r) => r.text === 'Mañana €');
  expect(nuevo).toBeDefined();
  expect(nuevo!.runId).toBe(res.runId);
  expect(nuevo!.fontName).toContain('Helvetica');

  // Tamaño y color conservados (18pt, RGB(51,102,153) tras el 0-255 de rgb(0.2,0.4,0.6)).
  expect(Math.round(nuevo!.sizePt)).toBe(18);
  expect(nuevo!.color[0]).toBe(original.color[0]);
  expect(nuevo!.color[1]).toBe(original.color[1]);
  expect(nuevo!.color[2]).toBe(original.color[2]);

  // Posición: el origen de línea base no se mueve (±0.5 pt).
  expect(Math.abs(nuevo!.originPt.xPt - original.originPt.xPt)).toBeLessThan(0.5);
  expect(Math.abs(nuevo!.originPt.yPt - original.originPt.yPt)).toBeLessThan(0.5);

  eng.close(doc);
});

test('replaceRunWithStandardFont persiste tras save + open', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await subconjunto());
  const original = eng.getPageText(doc, 0)[0]!;
  const res = eng.replaceRunWithStandardFont(doc, 0, original.runId, 'Mañana €');
  expect(res.ok).toBe(true);

  const bytes = eng.save(doc);
  const doc2 = await eng.open(bytes);
  const runs = eng.getPageText(doc2, 0);
  const nuevo = runs.find((r) => r.text === 'Mañana €');
  expect(nuevo).toBeDefined();
  expect(nuevo!.fontName).toContain('Helvetica');
  expect(Math.round(nuevo!.sizePt)).toBe(18);
  expect(Math.abs(nuevo!.originPt.xPt - original.originPt.xPt)).toBeLessThan(0.5);
  expect(Math.abs(nuevo!.originPt.yPt - original.originPt.yPt)).toBeLessThan(0.5);

  eng.close(doc); eng.close(doc2);
});

test('replaceRunWithStandardFont con CJK devuelve glyph-missing y no modifica el documento', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await subconjunto());
  const original = eng.getPageText(doc, 0)[0]!;
  const textoAntes = original.text;

  const res = eng.replaceRunWithStandardFont(doc, 0, original.runId, '漢字');
  expect(res).toEqual({ ok: false, reason: 'glyph-missing' });

  const runs = eng.getPageText(doc, 0);
  expect(runs).toHaveLength(1);
  expect(runs[0]!.text).toBe(textoAntes);
  eng.close(doc);
});

test('replaceRunWithStandardFont sobre un objeto que no es texto devuelve not-a-text-run', async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 200]);
  p.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const res = eng.replaceRunWithStandardFont(doc, 0, 0, 'Hola');
  expect(res).toEqual({ ok: false, reason: 'not-a-text-run' });
  eng.close(doc);
});

test('replaceRunWithStandardFont conserva el z-order: el run sustituido sigue en su posición entre los otros dos', async () => {
  const d = await PDFDocument.create();
  const dingbats = await d.embedFont(StandardFonts.ZapfDingbats);
  const helv = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([320, 200]);
  p.drawText('primera', { x: 40, y: 160, size: 12, font: helv });
  p.drawText('\u2701\u2702', { x: 40, y: 130, size: 12, font: dingbats });
  p.drawText('tercera', { x: 40, y: 100, size: 12, font: helv });

  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const runs = eng.getPageText(doc, 0);
  const medio = runs.find((r) => r.fontName === 'ZapfDingbats')!;
  expect(medio.runId).toBe(1); // segundo objeto insertado, en medio

  const res = eng.replaceRunWithStandardFont(doc, 0, medio.runId, 'sustituida');
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error('unreachable');
  // Si PDFium soporta InsertObjectAtIndex, el nuevo objeto vuelve al índice 1.
  expect(res.runId).toBe(1);

  const despues = eng.getPageText(doc, 0);
  expect(despues.find((r) => r.runId === 0)!.text).toBe('primera');
  expect(despues.find((r) => r.runId === 1)!.text).toBe('sustituida');
  expect(despues.find((r) => r.runId === 2)!.text).toBe('tercera');
  eng.close(doc);
});
