import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { SetFormCheckedCmd } from '../../src/commands/SetFormChecked';

async function sesion(): Promise<{ session: EditSession; annotIndex: number }> {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([300, 200]);
  const form = d.getForm();
  const acepto = form.createCheckBox('acepto');
  acepto.addToPage(p, { x: 20, y: 150, width: 20, height: 20 });
  form.updateFieldAppearances(font);

  const engine = await PdfiumEngine.create();
  const session = await EditSession.open(engine, await d.save());
  const field = engine.listFormFields(session.doc, 0).find((f) => f.name === 'acepto')!;
  return { session, annotIndex: field.annotIndex };
}

test('SetFormCheckedCmd marca la casilla; deshacer la desmarca', async () => {
  const { session, annotIndex } = await sesion();
  const bus = new CommandBus(session);

  await bus.execute(new SetFormCheckedCmd(0, annotIndex, true));
  expect(session.engine.listFormFields(session.doc, 0).find((f) => f.annotIndex === annotIndex)!.checked).toBe(true);

  await bus.undo();
  expect(session.engine.listFormFields(session.doc, 0).find((f) => f.annotIndex === annotIndex)!.checked).toBe(false);
});

test('redo reaplica la marca', async () => {
  const { session, annotIndex } = await sesion();
  const bus = new CommandBus(session);

  await bus.execute(new SetFormCheckedCmd(0, annotIndex, true));
  await bus.undo();
  await bus.redo();
  expect(session.engine.listFormFields(session.doc, 0).find((f) => f.annotIndex === annotIndex)!.checked).toBe(true);
});
