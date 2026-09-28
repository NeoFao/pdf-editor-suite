import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';

// E-030: al editar, el texto quedaba desplazado en vertical porque la UI
// alineaba con `boxPt` (caja ajustada a los glifos) en vez del origen real de
// la línea base. `originPt` expone (e, f) de la matriz del objeto de texto —
// el punto exacto donde el motor apoya la línea base al pintar.
test('getPageText devuelve originPt = punto de inserción del texto', async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 800]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());

  eng.insertText(doc, 0, { xPt: 72, yPt: 700, text: 'ORIGEN', sizePt: 14 });

  const run = eng.getPageText(doc, 0).find((r) => r.text.includes('ORIGEN'))!;
  expect(run).toBeDefined();
  expect(Math.abs(run.originPt.xPt - 72)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(run.originPt.yPt - 700)).toBeLessThanOrEqual(0.5);

  eng.close(doc);
});
