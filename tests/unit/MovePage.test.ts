import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { MovePageCmd } from '../../src/commands/MovePage';

test('reordenar actualiza el modelo; deshacer revierte', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (const t of ['UNO', 'DOS', 'TRES']) { const p = d.addPage([300, 200]); p.drawText(t, { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) }); }
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);
  const t0 = () => s.model.pages[0]!.runs.map((r) => r.text).join(' ');

  await bus.execute(new MovePageCmd(0, 1));
  expect(t0()).toContain('DOS');
  await bus.undo();
  expect(t0()).toContain('UNO');
});
