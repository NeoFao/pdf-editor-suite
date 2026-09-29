import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { HighlightRunCmd } from '../../src/commands/HighlightRun';

function hayAmarillo(data: Uint8ClampedArray): boolean {
  for (let i = 0; i < data.length; i += 4) if (data[i]! > 200 && data[i+1]! > 180 && data[i+2]! < 120) return true;
  return false;
}

test('resaltar pinta amarillo; deshacer lo quita (snapshot)', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([300, 200]); p.drawText('TEXTO', { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);
  const run = s.ensureText(0).find((r) => r.text.includes('TEXTO'))!;

  await bus.execute(new HighlightRunCmd(0, run.boxPt));
  expect(hayAmarillo(s.engine.renderPage(s.doc, 0, 1).data)).toBe(true);
  await bus.undo();
  expect(hayAmarillo(s.engine.renderPage(s.doc, 0, 1).data)).toBe(false);
});
