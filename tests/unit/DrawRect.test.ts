import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { DrawRectCmd } from '../../src/commands/DrawRect';

test('DrawRectCmd: dibuja un rectángulo (path con trazo); deshacer lo quita (snapshot)', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 200]);
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);
  const rect = { xPt: 30, yPt: 30, wPt: 100, hPt: 60 };

  await bus.execute(new DrawRectCmd(0, rect, [0, 0, 255], 2));
  expect(s.engine.listPathObjects(s.doc, 0)).toHaveLength(1);

  await bus.undo();
  expect(s.engine.listPathObjects(s.doc, 0)).toHaveLength(0);

  await bus.redo();
  expect(s.engine.listPathObjects(s.doc, 0)).toHaveLength(1);
});
