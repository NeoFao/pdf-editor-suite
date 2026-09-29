import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { UnderlineRunCmd } from '../../src/commands/UnderlineRun';
import { StrikethroughRunCmd } from '../../src/commands/StrikethroughRun';

function hayRojo(data: Uint8ClampedArray): boolean {
  for (let i = 0; i < data.length; i += 4) if (data[i]! > 170 && data[i+1]! < 100 && data[i+2]! < 100) return true;
  return false;
}

async function crearSesion() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([300, 200]); p.drawText('TEXTO', { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);
  const run = s.ensureText(0).find((r) => r.text.includes('TEXTO'))!;
  return { s, bus, run };
}

test('subrayar pinta rojo bajo la línea; deshacer lo quita (snapshot)', async () => {
  const { s, bus, run } = await crearSesion();
  await bus.execute(new UnderlineRunCmd(0, run.boxPt, [220, 20, 20]));
  expect(hayRojo(s.engine.renderPage(s.doc, 0, 1).data)).toBe(true);
  await bus.undo();
  expect(hayRojo(s.engine.renderPage(s.doc, 0, 1).data)).toBe(false);
});

test('tachar pinta rojo a media altura; deshacer lo quita (snapshot)', async () => {
  const { s, bus, run } = await crearSesion();
  await bus.execute(new StrikethroughRunCmd(0, run.boxPt, [220, 20, 20]));
  expect(hayRojo(s.engine.renderPage(s.doc, 0, 1).data)).toBe(true);
  await bus.undo();
  expect(hayRojo(s.engine.renderPage(s.doc, 0, 1).data)).toBe(false);
});
