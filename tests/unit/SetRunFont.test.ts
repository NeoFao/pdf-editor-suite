import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { SetRunFontCmd } from '../../src/commands/SetRunFont';

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

test('execute cambia la fuente y conserva el texto; el comando expone ok, fontName y el runId nuevo', async () => {
  const { session, runId } = await sesion();
  const bus = new CommandBus(session);
  const cmd = new SetRunFontCmd(0, runId, 'Courier-Bold');
  await bus.execute(cmd);

  expect(cmd.ok).toBe(true);
  expect(cmd.fontName).toBe('Courier-Bold');
  const run = session.ensureText(0).find((r) => r.runId === cmd.runId)!;
  expect(run.fontName).toContain('Courier');
  expect(run.text).toBe('Texto de prueba');
});

test('undo (snapshot) restaura la fuente original', async () => {
  const { session, runId } = await sesion();
  const bus = new CommandBus(session);
  const cmd = new SetRunFontCmd(0, runId, 'Courier-Bold');
  await bus.execute(cmd);
  expect(cmd.ok).toBe(true);

  await bus.undo();

  const runs = session.ensureText(0);
  expect(runs).toHaveLength(1);
  expect(runs[0]!.fontName).not.toContain('Courier');
  expect(runs[0]!.text).toBe('Texto de prueba');
});

test('nombre fuera de la lista estándar: execute deja ok=false y no modifica el documento', async () => {
  const { session, runId } = await sesion();
  const cmd = new SetRunFontCmd(0, runId, 'Comic-Sans-Falsa');
  cmd.execute(session);

  expect(cmd.ok).toBe(false);
  expect(cmd.fontName).toBeNull();
  const runs = session.ensureText(0);
  expect(runs[0]!.text).toBe('Texto de prueba');
});
