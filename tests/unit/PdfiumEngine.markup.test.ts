import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { rectToQuad, type QuadPt } from '../../src/coords/quads';

/** Página 300×200 con "HOLA MUNDO" en negro; su caja de texto está en torno a y=150. */
async function abrir() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  d.addPage([300, 200]).drawText('HOLA MUNDO', { x: 40, y: 150, size: 20, font: f, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  return { eng, doc };
}

const CAJA = { xPt: 40, yPt: 146, wPt: 120, hPt: 24 };

test('addMarkup crea /Highlight, /Underline y /StrikeOut que persisten con QuadPoints, color y Contents', async () => {
  const { eng, doc } = await abrir();
  const q = [rectToQuad(CAJA)];
  const iH = eng.addMarkup(doc, 0, 'highlight', q, [255, 235, 0], 'nota ñ');
  const iU = eng.addMarkup(doc, 0, 'underline', q, [255, 0, 0]);
  const iS = eng.addMarkup(doc, 0, 'strikeout', q, [0, 0, 255]);
  expect([iH, iU, iS]).toEqual([0, 1, 2]);

  const doc2 = await eng.open(eng.save(doc));
  const c = eng.getComments(doc2, 0);
  expect(c.map((x) => x.kind)).toEqual(['highlight', 'underline', 'strikeout']);
  expect(c[0]!.text).toBe('nota ñ');
  expect(c[1]!.text).toBe('');
  expect(c[0]!.author).toBe('');
  // El rect de la anotación envuelve la caja.
  expect(c[0]!.rectPt.xPt).toBeLessThanOrEqual(CAJA.xPt + 0.01);
  expect(c[0]!.rectPt.wPt).toBeGreaterThanOrEqual(CAJA.wPt - 0.01);

  const quads = eng.getMarkupQuads(doc2, 0, 0);
  expect(quads).toHaveLength(1);
  const esperado = q[0]!;
  quads[0]!.forEach((v, i) => expect(v).toBeCloseTo(esperado[i]!, 1));

  expect(eng.getMarkupColor(doc2, 0, 0)).toEqual([255, 235, 0]);
  expect(eng.getMarkupColor(doc2, 0, 1)).toEqual([255, 0, 0]);
  expect(eng.getMarkupColor(doc2, 0, 2)).toEqual([0, 0, 255]);
  eng.close(doc); eng.close(doc2);
});

test('addMarkup con autor guarda /T; sin autor lo deja vacío', async () => {
  const { eng, doc } = await abrir();
  eng.addMarkup(doc, 0, 'highlight', [rectToQuad(CAJA)], [255, 235, 0], '', 'Ñoño');
  eng.addMarkup(doc, 0, 'highlight', [rectToQuad(CAJA)], [255, 235, 0]);
  const c = eng.getComments(doc, 0);
  expect(c[0]!.author).toBe('Ñoño');
  expect(c[1]!.author).toBe('');
  eng.close(doc);
});

test('un resaltado con varios quads los guarda todos (uno por línea)', async () => {
  const { eng, doc } = await abrir();
  const quads: QuadPt[] = [rectToQuad(CAJA), rectToQuad({ xPt: 40, yPt: 100, wPt: 80, hPt: 24 })];
  eng.addMarkup(doc, 0, 'highlight', quads, [255, 235, 0]);
  const doc2 = await eng.open(eng.save(doc));
  expect(eng.getMarkupQuads(doc2, 0, 0)).toHaveLength(2);
  eng.close(doc); eng.close(doc2);
});

/** Alfa-composición sobre blanco: ¿hay píxeles con tinte amarillo / rojo / etc.? */
function contar(data: Uint8ClampedArray | Uint8Array, pred: (r: number, g: number, b: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if (pred(data[i]!, data[i + 1]!, data[i + 2]!)) n++;
  return n;
}

test('la apariencia generada se pinta: el resaltado es amarillo y el texto de debajo sigue legible', async () => {
  const { eng, doc } = await abrir();
  const antes = eng.renderPage(doc, 0, 2).data;
  const oscurosAntes = contar(antes, (r, g, b) => r < 90 && g < 90 && b < 90);
  expect(oscurosAntes).toBeGreaterThan(50);

  eng.addMarkup(doc, 0, 'highlight', [rectToQuad(CAJA)], [255, 235, 0]);
  const despues = eng.renderPage(await eng.open(eng.save(doc)), 0, 2).data;
  expect(contar(despues, (r, g, b) => r > 200 && g > 180 && b < 140)).toBeGreaterThan(500); // amarillo
  // Multiply: los píxeles negros del texto siguen oscuros (no quedan tapados por el amarillo).
  const oscurosDespues = contar(despues, (r, g, b) => r < 90 && g < 90 && b < 90);
  expect(oscurosDespues).toBeGreaterThan(oscurosAntes * 0.8);
  eng.close(doc);
});

test('subrayado y tachado pintan su color en el render', async () => {
  const { eng, doc } = await abrir();
  eng.addMarkup(doc, 0, 'underline', [rectToQuad(CAJA)], [255, 0, 0]);
  eng.addMarkup(doc, 0, 'strikeout', [rectToQuad(CAJA)], [0, 0, 255]);
  const { data } = eng.renderPage(await eng.open(eng.save(doc)), 0, 2);
  expect(contar(data, (r, g, b) => r > 200 && g < 80 && b < 80)).toBeGreaterThan(30);
  expect(contar(data, (r, g, b) => b > 200 && r < 80 && g < 80)).toBeGreaterThan(30);
  eng.close(doc);
});

test('el texto bajo el resaltado queda intacto y borrar la anotación quita solo la anotación', async () => {
  const { eng, doc } = await abrir();
  const textoAntes = eng.getPageText(doc, 0).map((r) => r.text);
  const baseline = eng.renderPage(doc, 0, 2).data;
  const idx = eng.addMarkup(doc, 0, 'highlight', [rectToQuad(CAJA)], [255, 235, 0]);
  const doc2 = await eng.open(eng.save(doc));
  expect(eng.getPageText(doc2, 0).map((r) => r.text)).toEqual(textoAntes);

  expect(eng.removeNote(doc2, 0, idx)).toBe(true);
  expect(eng.getComments(doc2, 0)).toEqual([]);
  expect(eng.getPageText(doc2, 0).map((r) => r.text)).toEqual(textoAntes);
  const trasBorrar = eng.renderPage(doc2, 0, 2).data;
  expect(Buffer.compare(Buffer.from(trasBorrar), Buffer.from(baseline))).toBe(0); // píxeles idénticos al original
  eng.close(doc); eng.close(doc2);
});

test('getComments lista el marcado propio aunque no tenga /Contents', async () => {
  const { eng, doc } = await abrir();
  eng.addMarkup(doc, 0, 'underline', [rectToQuad(CAJA)], [255, 0, 0]);
  expect(eng.getComments(doc, 0).map((c) => c.kind)).toEqual(['underline']);
  eng.close(doc);
});
