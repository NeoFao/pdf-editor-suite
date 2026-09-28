import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { SetFormChoiceCmd } from '../../src/commands/SetFormChoice';

async function sesion(): Promise<{ session: EditSession; annotIndex: number }> {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([300, 200]);
  const form = d.getForm();
  const dropdown = form.createDropdown('pais');
  dropdown.addOptions(['Perú', 'Chile', 'México']);
  dropdown.select('Chile');
  dropdown.addToPage(p, { x: 20, y: 150, width: 150, height: 20 });
  form.updateFieldAppearances(font);

  const engine = await PdfiumEngine.create();
  const session = await EditSession.open(engine, await d.save());
  const field = engine.listFormFields(session.doc, 0).find((f) => f.name === 'pais')!;
  return { session, annotIndex: field.annotIndex };
}

test('SetFormChoiceCmd cambia la selección; deshacer restaura la previa', async () => {
  const { session, annotIndex } = await sesion();
  const bus = new CommandBus(session);

  await bus.execute(new SetFormChoiceCmd(0, annotIndex, ['Perú'], ['Chile']));
  expect(session.engine.listFormFields(session.doc, 0).find((f) => f.annotIndex === annotIndex)!.value).toBe('Perú');

  await bus.undo();
  expect(session.engine.listFormFields(session.doc, 0).find((f) => f.annotIndex === annotIndex)!.value).toBe('Chile');
});

test('redo reaplica la selección elegida', async () => {
  const { session, annotIndex } = await sesion();
  const bus = new CommandBus(session);

  await bus.execute(new SetFormChoiceCmd(0, annotIndex, ['México'], ['Chile']));
  await bus.undo();
  await bus.redo();
  expect(session.engine.listFormFields(session.doc, 0).find((f) => f.annotIndex === annotIndex)!.value).toBe('México');
});

test('dos cambios con la misma clave se fusionan en un solo paso de deshacer', async () => {
  const { session, annotIndex } = await sesion();
  const bus = new CommandBus(session);

  await bus.execute(new SetFormChoiceCmd(0, annotIndex, ['Perú'], ['Chile']));
  await bus.execute(new SetFormChoiceCmd(0, annotIndex, ['México'], ['Perú']));
  expect(session.engine.listFormFields(session.doc, 0).find((f) => f.annotIndex === annotIndex)!.value).toBe('México');

  await bus.undo();
  expect(session.engine.listFormFields(session.doc, 0).find((f) => f.annotIndex === annotIndex)!.value).toBe('Chile');
  expect(bus.canUndo()).toBe(false);
});
