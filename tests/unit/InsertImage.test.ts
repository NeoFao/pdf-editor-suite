import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { InsertImageCmd } from '../../src/commands/InsertImage';

function hayRojo(data: Uint8ClampedArray): boolean {
  for (let i = 0; i < data.length; i += 4) if (data[i]! > 180 && data[i+1]! < 90 && data[i+2]! < 90) return true;
  return false;
}

test('insertar imagen la hace visible; deshacer la quita (snapshot)', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 200]);
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);
  const w = 8, h = 8; const rgba = new Uint8Array(w*h*4);
  for (let i = 0; i < w*h; i++) { rgba[i*4] = 255; rgba[i*4+3] = 255; }

  await bus.execute(new InsertImageCmd(0, { rgba, imgWidth: w, imgHeight: h, xPt: 60, yPt: 60, wPt: 120, hPt: 90 }));
  expect(hayRojo(s.engine.renderPage(s.doc, 0, 1).data)).toBe(true);
  await bus.undo();
  expect(hayRojo(s.engine.renderPage(s.doc, 0, 1).data)).toBe(false);
});
