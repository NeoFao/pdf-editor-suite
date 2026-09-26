import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { MoveRunCmd } from '../../src/commands/MoveRun';

test('mover desplaza el run en el modelo; deshacer lo devuelve', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([320, 200]);
  p.drawText('MOVER', { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);
  const antes = s.model.pages[0]!.runs.find((r) => r.text.includes('MOVER'))!;
  const x0 = Math.round(antes.boxPt.xPt), y0 = Math.round(antes.boxPt.yPt);

  await bus.execute(new MoveRunCmd(0, antes.runId, 25, 15));
  const mov = s.model.pages[0]!.runs.find((r) => r.text.includes('MOVER'))!;
  expect(Math.round(mov.boxPt.xPt)).toBe(x0 + 25);
  expect(Math.round(mov.boxPt.yPt)).toBe(y0 + 15);

  await bus.undo();
  const fin = s.model.pages[0]!.runs.find((r) => r.text.includes('MOVER'))!;
  expect(Math.round(fin.boxPt.xPt)).toBe(x0);
  expect(Math.round(fin.boxPt.yPt)).toBe(y0);
});
