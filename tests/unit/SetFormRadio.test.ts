import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { SetFormRadioCmd } from '../../src/commands/SetFormRadio';

async function sesion(): Promise<{ session: EditSession; rojo: number; verde: number; azul: number }> {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([300, 200]);
  const form = d.getForm();
  const radio = form.createRadioGroup('color');
  radio.addOptionToPage('rojo', p, { x: 20, y: 150, width: 15, height: 15 });
  radio.addOptionToPage('verde', p, { x: 20, y: 120, width: 15, height: 15 });
  radio.addOptionToPage('azul', p, { x: 20, y: 90, width: 15, height: 15 });
  form.updateFieldAppearances(font);

  const engine = await PdfiumEngine.create();
  const session = await EditSession.open(engine, await d.save());
  const fields = engine.listFormFields(session.doc, 0);
  return {
    session,
    rojo: fields.find((f) => f.exportValue === 'rojo')!.annotIndex,
    verde: fields.find((f) => f.exportValue === 'verde')!.annotIndex,
    azul: fields.find((f) => f.exportValue === 'azul')!.annotIndex
  };
}

function marcado(session: EditSession): string | undefined {
  return session.engine.listFormFields(session.doc, 0).find((f) => f.checked)?.exportValue;
}

test('SetFormRadioCmd marca el widget; deshacer sin marca previa deja el grupo en Off', async () => {
  const { session, verde } = await sesion();
  const bus = new CommandBus(session);

  await bus.execute(new SetFormRadioCmd(0, verde, null));
  expect(marcado(session)).toBe('verde');

  await bus.undo();
  expect(marcado(session)).toBeUndefined();
});

test('SetFormRadioCmd con marca previa: deshacer vuelve a marcar la anterior', async () => {
  const { session, rojo, azul } = await sesion();
  const bus = new CommandBus(session);

  await bus.execute(new SetFormRadioCmd(0, rojo, null));
  await bus.execute(new SetFormRadioCmd(0, azul, rojo));
  expect(marcado(session)).toBe('azul');

  await bus.undo();
  expect(marcado(session)).toBe('rojo');

  await bus.undo();
  expect(marcado(session)).toBeUndefined();
});

test('redo reaplica la marca', async () => {
  const { session, verde } = await sesion();
  const bus = new CommandBus(session);

  await bus.execute(new SetFormRadioCmd(0, verde, null));
  await bus.undo();
  await bus.redo();
  expect(marcado(session)).toBe('verde');
});
