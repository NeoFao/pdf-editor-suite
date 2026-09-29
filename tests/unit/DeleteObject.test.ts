import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { InsertImageCmd } from '../../src/commands/InsertImage';
import { DeleteObjectCmd } from '../../src/commands/DeleteObject';

test('DeleteObjectCmd borra la imagen; deshacer la repone (snapshot)', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 300]);
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);
  const w = 4, h = 4; const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = 255; rgba[i * 4 + 3] = 255; }

  await bus.execute(new InsertImageCmd(0, { rgba, imgWidth: w, imgHeight: h, xPt: 10, yPt: 10, wPt: 50, hPt: 50 }));
  const antes = s.engine.listImageObjects(s.doc, 0)[0]!;

  await bus.execute(new DeleteObjectCmd(0, antes.objIndex));
  expect(s.engine.listImageObjects(s.doc, 0)).toEqual([]);

  await bus.undo();
  expect(s.engine.listImageObjects(s.doc, 0).length).toBe(1);

  await bus.redo();
  expect(s.engine.listImageObjects(s.doc, 0)).toEqual([]);
});
