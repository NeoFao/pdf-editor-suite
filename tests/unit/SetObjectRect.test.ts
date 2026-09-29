import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { InsertImageCmd } from '../../src/commands/InsertImage';
import { SetObjectRectCmd } from '../../src/commands/SetObjectRect';

test('SetObjectRectCmd mueve la imagen; deshacer vuelve al rect anterior (operación inversa, sin snapshot)', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 300]);
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);
  const w = 4, h = 4; const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = 255; rgba[i * 4 + 3] = 255; }

  await bus.execute(new InsertImageCmd(0, { rgba, imgWidth: w, imgHeight: h, xPt: 10, yPt: 10, wPt: 50, hPt: 50 }));
  const antes = s.engine.listImageObjects(s.doc, 0)[0]!;
  const nuevoRect = { xPt: 100, yPt: 150, wPt: 80, hPt: 30 };

  await bus.execute(new SetObjectRectCmd(0, antes.objIndex, nuevoRect, antes.rectPt));
  const movido = s.engine.listImageObjects(s.doc, 0)[0]!;
  expect(movido.rectPt.xPt).toBeCloseTo(nuevoRect.xPt, 0);
  expect(movido.rectPt.wPt).toBeCloseTo(nuevoRect.wPt, 0);

  await bus.undo();
  const vuelta = s.engine.listImageObjects(s.doc, 0)[0]!;
  expect(vuelta.rectPt.xPt).toBeCloseTo(antes.rectPt.xPt, 0);
  expect(vuelta.rectPt.wPt).toBeCloseTo(antes.rectPt.wPt, 0);

  await bus.redo();
  const rehecho = s.engine.listImageObjects(s.doc, 0)[0]!;
  expect(rehecho.rectPt.xPt).toBeCloseTo(nuevoRect.xPt, 0);
});
