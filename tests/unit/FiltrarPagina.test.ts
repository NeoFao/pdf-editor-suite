import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { FiltrarPaginaCmd } from '../../src/commands/FiltrarPagina';

function imagenColor(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 220;     // R
    rgba[i * 4 + 1] = 40;  // G
    rgba[i * 4 + 2] = 40;  // B (rojo intenso, claramente NO gris)
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

test('FiltrarPaginaCmd aplica el filtro a todas las imágenes de la página y se puede deshacer', async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 200]);
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);

  engine.insertImage(s.doc, 0, { rgba: imagenColor(4, 4), imgWidth: 4, imgHeight: 4, xPt: 20, yPt: 20, wPt: 80, hPt: 80 });
  const img = engine.listImageObjects(s.doc, 0)[0]!;
  const antes = engine.getImagePixels(s.doc, 0, img.objIndex)!;
  expect(antes.rgba[0]).not.toBe(antes.rgba[1]); // sigue siendo rojo, no gris

  const cmd = new FiltrarPaginaCmd(0, 'grises');
  await bus.execute(cmd);
  expect(cmd.imagenesAfectadas).toBe(1);

  const img2 = engine.listImageObjects(s.doc, 0)[0]!;
  const despues = engine.getImagePixels(s.doc, 0, img2.objIndex)!;
  for (let i = 0; i < despues.rgba.length; i += 4) {
    expect(despues.rgba[i]).toBe(despues.rgba[i + 1]);
    expect(despues.rgba[i + 1]).toBe(despues.rgba[i + 2]);
  }

  await bus.undo();
  const img3 = engine.listImageObjects(s.doc, 0)[0]!;
  const tras = engine.getImagePixels(s.doc, 0, img3.objIndex)!;
  expect(tras.rgba[0]).not.toBe(tras.rgba[1]); // vuelve a ser rojo
});

test('FiltrarPaginaCmd en una página sin imágenes no afecta nada (imagenesAfectadas = 0)', async () => {
  const d = await PDFDocument.create();
  d.addPage([200, 200]);
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);

  const cmd = new FiltrarPaginaCmd(0, 'bn');
  await bus.execute(cmd);
  expect(cmd.imagenesAfectadas).toBe(0);
});
