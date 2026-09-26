import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { SetColorCmd } from '../../src/commands/SetColor';

test('cambiar color actualiza el modelo; deshacer restaura el color previo', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([320, 200]);
  p.drawText('COLOR', { x: 40, y: 150, size: 16, font: f, color: rgb(0.85, 0.1, 0.1) });
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);
  const run = s.model.pages[0]!.runs.find((r) => r.text.includes('COLOR'))!;
  const viejo: [number, number, number] = [run.color[0], run.color[1], run.color[2]];

  await bus.execute(new SetColorCmd(0, run.runId, [10, 20, 200], viejo));
  const azul = s.model.pages[0]!.runs.find((r) => r.text.includes('COLOR'))!;
  expect(azul.color[2]).toBeGreaterThan(150);
  expect(azul.color[0]).toBeLessThan(80);

  await bus.undo();
  const rojo = s.model.pages[0]!.runs.find((r) => r.text.includes('COLOR'))!;
  expect(rojo.color[0]).toBeGreaterThan(200);
});
