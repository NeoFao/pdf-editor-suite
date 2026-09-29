import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { SetRunFontSizeCmd } from '../../src/commands/SetRunFontSize';

async function sesion(): Promise<{ session: EditSession; runId: number }> {
  const d = await PDFDocument.create();
  const times = await d.embedFont(StandardFonts.TimesRoman);
  const p = d.addPage([320, 200]);
  p.drawText('Texto de prueba', { x: 72, y: 120, size: 14, font: times, color: rgb(0.2, 0.4, 0.6) });
  const engine = await PdfiumEngine.create();
  const session = await EditSession.open(engine, await d.save());
  const r = session.ensureText(0)[0]!;
  return { session, runId: r.runId };
}

test('execute cambia el tamaño; el comando expone ok y el runId nuevo', async () => {
  const { session, runId } = await sesion();
  const bus = new CommandBus(session);
  const cmd = new SetRunFontSizeCmd(0, runId, 24);
  await bus.execute(cmd);

  expect(cmd.ok).toBe(true);
  const run = session.ensureText(0).find((r) => r.runId === cmd.runId)!;
  expect(Math.round(run.sizePt)).toBe(24);
  expect(run.text).toBe('Texto de prueba');
});

test('undo (snapshot) restaura el tamaño original', async () => {
  const { session, runId } = await sesion();
  const bus = new CommandBus(session);
  const cmd = new SetRunFontSizeCmd(0, runId, 24);
  await bus.execute(cmd);
  expect(cmd.ok).toBe(true);

  await bus.undo();

  const runs = session.ensureText(0);
  expect(runs).toHaveLength(1);
  expect(Math.round(runs[0]!.sizePt)).toBe(14);
  // También en el motor, no solo en la proyección del modelo.
  const desdeMotor = session.engine.getPageText(session.doc, 0)[0]!;
  expect(Math.round(desdeMotor.sizePt)).toBe(14);
});

test('invalid-size: execute deja ok=false y no modifica el documento', async () => {
  const { session, runId } = await sesion();
  const cmd = new SetRunFontSizeCmd(0, runId, 0);
  cmd.execute(session);

  expect(cmd.ok).toBe(false);
  const runs = session.ensureText(0);
  expect(Math.round(runs[0]!.sizePt)).toBe(14);
});
