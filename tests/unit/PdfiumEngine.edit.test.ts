import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function unaLinea(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.TimesRoman);
  const p = d.addPage([320, 200]);
  p.drawText('ORIGINAL-TIMES', { x: 40, y: 150, size: 18, font: f, color: rgb(0.85, 0.1, 0.1) });
  return d.save();
}
async function dosLineas(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([320, 200]);
  p.drawText('linea de arriba', { x: 40, y: 150, size: 12, font: f, color: rgb(0, 0, 0) });
  p.drawText('linea de abajo', { x: 40, y: 120, size: 12, font: f, color: rgb(0, 0, 0) });
  return d.save();
}

test('editar-conserva-fuente-tamano-color-posicion (solo cambia el texto)', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await unaLinea());
  const antes = eng.getPageText(doc, 0).find((r) => r.text.includes('ORIGINAL'))!;
  const res = eng.editTextRun(doc, 0, antes.runId, 'CAMBIADO-EN-SITIO');
  expect(res.ok).toBe(true);
  const doc2 = await eng.open(eng.save(doc));
  const despues = eng.getPageText(doc2, 0).find((r) => r.text.includes('CAMBIADO'))!;
  expect(despues).toBeDefined();
  expect(despues.fontName).toBe(antes.fontName);
  expect(Math.round(despues.sizePt)).toBe(Math.round(antes.sizePt));
  expect(despues.color).toEqual(antes.color);
  expect(Math.round(despues.boxPt.yPt)).toBe(Math.round(antes.boxPt.yPt));
  expect(Math.round(despues.boxPt.xPt)).toBe(Math.round(antes.boxPt.xPt));
  eng.close(doc); eng.close(doc2);
});

test('editar-texto-mas-largo-no-pisa-vecina', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await dosLineas());
  const arriba = eng.getPageText(doc, 0).find((r) => r.text.includes('arriba'))!;
  eng.editTextRun(doc, 0, arriba.runId, 'linea de arriba mucho mucho mas larga que antes');
  const runs = eng.getPageText(await eng.open(eng.save(doc)), 0);
  const a = runs.find((r) => r.text.includes('arriba'))!;
  const b = runs.find((r) => r.text.includes('abajo'))!;
  // No se solapan verticalmente: el techo de la de abajo queda por debajo del suelo de la de arriba.
  expect(b.boxPt.yPt + b.boxPt.hPt).toBeLessThanOrEqual(a.boxPt.yPt + 0.5);
  eng.close(doc);
});

test('glifo-ausente-se-detecta (no modifica, informa)', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await dosLineas()); // Helvetica: sin glifos CJK
  const run = eng.getPageText(doc, 0).find((r) => r.text.includes('arriba'))!;
  const res = eng.editTextRun(doc, 0, run.runId, 'texto con 中 (kanji)');
  expect(res).toEqual({ ok: false, reason: 'glyph-missing' });
  // El original sigue intacto
  const sigue = eng.getPageText(doc, 0).find((r) => r.text.includes('arriba'));
  expect(sigue).toBeDefined();
  eng.close(doc);
});

test('not-a-text-run cuando el runId no es texto', async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([200, 200]);
  p.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const res = eng.editTextRun(doc, 0, 0, 'nada'); // objeto 0 es un rectángulo
  expect(res).toEqual({ ok: false, reason: 'not-a-text-run' });
  eng.close(doc);
});
