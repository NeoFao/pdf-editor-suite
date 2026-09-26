import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { EditTextRunCmd } from '../../src/commands/EditTextRun';

async function sesion(): Promise<{ session: EditSession; runId: number; original: string }> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.TimesRoman);
  const p = d.addPage([320, 200]);
  p.drawText('ORIGINAL', { x: 40, y: 150, size: 18, font: f, color: rgb(0, 0, 0) });
  const engine = await PdfiumEngine.create();
  const session = await EditSession.open(engine, await d.save());
  const r = session.model.pages[0]!.runs.find((x) => x.text.includes('ORIGINAL'))!;
  return { session, runId: r.runId, original: r.text };
}

test('dos ediciones con la misma clave = UN paso de deshacer; undo restaura el original', async () => {
  const { session, runId, original } = await sesion();
  const bus = new CommandBus(session);
  await bus.execute(new EditTextRunCmd(0, runId, 'AB', original));
  await bus.execute(new EditTextRunCmd(0, runId, 'ABC', 'AB'));
  expect(session.model.pages[0]!.runs[0]!.text).toBe('ABC');
  await bus.undo();
  expect(session.model.pages[0]!.runs[0]!.text).toBe(original);
  expect(bus.canUndo()).toBe(false);
  expect(session.engine.getPageText(session.doc, 0)[0]!.text).toBe(original);
});

test('redo reaplica la edición', async () => {
  const { session, runId, original } = await sesion();
  const bus = new CommandBus(session);
  await bus.execute(new EditTextRunCmd(0, runId, 'NUEVO', original));
  await bus.undo();
  expect(session.model.pages[0]!.runs[0]!.text).toBe(original);
  await bus.redo();
  expect(session.model.pages[0]!.runs[0]!.text).toBe('NUEVO');
});
