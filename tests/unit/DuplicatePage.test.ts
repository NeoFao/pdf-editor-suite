import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { DuplicatePageCmd } from '../../src/commands/DuplicatePage';

test('duplicar página añade una copia; deshacer la quita (snapshot)', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([300, 200]); p.drawText('UNO', { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);
  await bus.execute(new DuplicatePageCmd(0));
  expect(s.model.pages.length).toBe(2);
  await bus.undo();
  expect(s.model.pages.length).toBe(1);
});
