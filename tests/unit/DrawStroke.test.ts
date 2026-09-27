import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { DrawStrokeCmd } from '../../src/commands/DrawStroke';

function hayRojo(data: Uint8ClampedArray): boolean {
  for (let i = 0; i < data.length; i += 4) if (data[i]! > 170 && data[i+1]! < 100 && data[i+2]! < 100) return true;
  return false;
}

test('dibujar un trazo lo hace visible; deshacer lo quita (snapshot)', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 200]);
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);
  const pts = [{ xPt: 30, yPt: 100 }, { xPt: 150, yPt: 150 }, { xPt: 270, yPt: 100 }];

  await bus.execute(new DrawStrokeCmd(0, pts));
  expect(hayRojo(s.engine.renderPage(s.doc, 0, 1).data)).toBe(true);
  await bus.undo();
  expect(hayRojo(s.engine.renderPage(s.doc, 0, 1).data)).toBe(false);
});
