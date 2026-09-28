import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { SetFormTextCmd } from '../../src/commands/SetFormText';

async function sesion(): Promise<{ session: EditSession; annotIndex: number }> {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([300, 200]);
  const form = d.getForm();
  const nombre = form.createTextField('nombre');
  nombre.addToPage(p, { x: 20, y: 150, width: 200, height: 20 });
  form.updateFieldAppearances(font);

  const engine = await PdfiumEngine.create();
  const session = await EditSession.open(engine, await d.save());
  const field = engine.listFormFields(session.doc, 0).find((f) => f.name === 'nombre')!;
  return { session, annotIndex: field.annotIndex };
}

test('SetFormTextCmd escribe el valor; deshacer restaura el valor previo', async () => {
  const { session, annotIndex } = await sesion();
  const bus = new CommandBus(session);

  await bus.execute(new SetFormTextCmd(0, annotIndex, 'José Ñúñez', ''));
  expect(session.engine.listFormFields(session.doc, 0).find((f) => f.annotIndex === annotIndex)!.value).toBe('José Ñúñez');

  await bus.undo();
  expect(session.engine.listFormFields(session.doc, 0).find((f) => f.annotIndex === annotIndex)!.value).toBe('');
});

test('redo reaplica el valor escrito', async () => {
  const { session, annotIndex } = await sesion();
  const bus = new CommandBus(session);

  await bus.execute(new SetFormTextCmd(0, annotIndex, 'Nuevo', ''));
  await bus.undo();
  await bus.redo();
  expect(session.engine.listFormFields(session.doc, 0).find((f) => f.annotIndex === annotIndex)!.value).toBe('Nuevo');
});

test('dos escrituras con la misma clave se fusionan en un solo paso de deshacer', async () => {
  const { session, annotIndex } = await sesion();
  const bus = new CommandBus(session);

  await bus.execute(new SetFormTextCmd(0, annotIndex, 'A', ''));
  await bus.execute(new SetFormTextCmd(0, annotIndex, 'AB', 'A'));
  expect(session.engine.listFormFields(session.doc, 0).find((f) => f.annotIndex === annotIndex)!.value).toBe('AB');

  await bus.undo();
  expect(session.engine.listFormFields(session.doc, 0).find((f) => f.annotIndex === annotIndex)!.value).toBe('');
  expect(bus.canUndo()).toBe(false);
});
