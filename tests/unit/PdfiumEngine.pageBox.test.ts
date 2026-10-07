import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { fixture } from './_util/fixtures';

/**
 * E-084: `pageBox` da la caja visible (CropBox recortada a la MediaBox, o la MediaBox) en pt de usuario sin girar, y su
 * tamaño coincide con `pageSize` (render) salvo el intercambio de ejes de /Rotate 90/270.
 */
test('E-084 pageBox: CropBox desplazada, MediaBox con origen negativo y /Rotate 90', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(fixture('cropbox-desplazado.pdf'));
  expect(eng.pageBox(doc, 0)).toEqual({ origenPt: { xPt: 36, yPt: 36 }, tamanoPt: { widthPt: 400, heightPt: 300 }, rotacion: 0 });
  expect(eng.pageBox(doc, 1)).toEqual({ origenPt: { xPt: -50, yPt: -80 }, tamanoPt: { widthPt: 400, heightPt: 300 }, rotacion: 0 });
  expect(eng.pageBox(doc, 2)).toEqual({ origenPt: { xPt: 36, yPt: 36 }, tamanoPt: { widthPt: 300, heightPt: 400 }, rotacion: 90 });
  // pageSize (visual, lo que pinta el render) coincide con la caja, con ejes cambiados bajo /Rotate 90.
  expect(eng.pageSize(doc, 0)).toEqual({ widthPt: 400, heightPt: 300 });
  expect(eng.pageSize(doc, 2)).toEqual({ widthPt: 400, heightPt: 300 });
  eng.close(doc);
});

test('E-084 pageBox: sin CropBox es la MediaBox con origen (0,0)', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(fixture('nativo.pdf'));
  const b = eng.pageBox(doc, 0);
  expect(b.origenPt).toEqual({ xPt: 0, yPt: 0 });
  expect(b.tamanoPt).toEqual(eng.pageSize(doc, 0));
  eng.close(doc);
});

/** E-098: PDFium no aplica /UserUnit: tamaño, caja, render y coordenadas del texto van sin escalar y son coherentes. */
test('E-098 /UserUnit 2: pageSize, pageBox, render y coordenadas siguen en unidades de usuario sin escalar', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(fixture('userunit.pdf'));
  expect(eng.pageSize(doc, 0)).toEqual({ widthPt: 300, heightPt: 200 });
  expect(eng.pageBox(doc, 0).tamanoPt).toEqual({ widthPt: 300, heightPt: 200 });
  const r = eng.renderPage(doc, 0, 1);
  expect([r.width, r.height]).toEqual([300, 200]);
  expect(eng.getPageText(doc, 0)[0]!.originPt).toEqual({ xPt: 40, yPt: 150 });
  eng.close(doc);
});
