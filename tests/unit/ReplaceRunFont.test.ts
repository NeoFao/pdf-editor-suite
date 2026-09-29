import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { ReplaceRunFontCmd } from '../../src/commands/ReplaceRunFont';

async function sesion(): Promise<{ session: EditSession; runId: number }> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.ZapfDingbats);
  const p = d.addPage([320, 200]);
  p.drawText('✁✂✃✄', { x: 40, y: 130, size: 18, font: f, color: rgb(0, 0, 0) });
  const engine = await PdfiumEngine.create();
  const session = await EditSession.open(engine, await d.save());
  const r = session.ensureText(0)[0]!;
  return { session, runId: r.runId };
}

test('execute sustituye texto y fuente; el comando expone ok y fontName', async () => {
  const { session, runId } = await sesion();
  const bus = new CommandBus(session);
  const cmd = new ReplaceRunFontCmd(0, runId, 'Mañana €');
  await bus.execute(cmd);

  expect(cmd.ok).toBe(true);
  expect(cmd.fontName).toBe('Helvetica');
  const run = session.ensureText(0).find((r) => r.text === 'Mañana €');
  expect(run).toBeDefined();
});

test('undo (snapshot) restaura el texto y la fuente originales', async () => {
  const { session, runId } = await sesion();
  const bus = new CommandBus(session);
  const cmd = new ReplaceRunFontCmd(0, runId, 'Mañana €');
  await bus.execute(cmd);
  expect(cmd.ok).toBe(true);

  await bus.undo();

  const runs = session.ensureText(0);
  expect(runs).toHaveLength(1);
  expect(runs[0]!.text).toBe('✁✂✃✄');
  expect(runs[0]!.fontName).toBe('ZapfDingbats');
  // También en el motor, no solo en la proyección del modelo.
  const desdeMotor = session.engine.getPageText(session.doc, 0)[0]!;
  expect(desdeMotor.text).toBe('✁✂✃✄');
  expect(desdeMotor.fontName).toBe('ZapfDingbats');
});

test('CJK: execute deja ok=false y no modifica el documento', async () => {
  const { session, runId } = await sesion();
  const cmd = new ReplaceRunFontCmd(0, runId, '漢字');
  await cmd.execute(session); // ejecución directa: no queremos que un fallo quede en la pila de deshacer

  expect(cmd.ok).toBe(false);
  expect(cmd.fontName).toBeNull();
  const runs = session.ensureText(0);
  expect(runs[0]!.text).toBe('✁✂✃✄');
});
