import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { InsertTextCmd } from '../../src/commands/InsertText';

async function sesionVacia(): Promise<EditSession> {
  const d = await PDFDocument.create();
  d.addPage([320, 200]);
  const engine = await PdfiumEngine.create();
  return EditSession.open(engine, await d.save());
}

test('insertar añade un run al modelo; deshacer lo quita (snapshot)', async () => {
  const s = await sesionVacia();
  const bus = new CommandBus(s);
  expect(s.model.pages[0]!.runs.length).toBe(0);

  await bus.execute(new InsertTextCmd(0, { xPt: 50, yPt: 120, text: 'NUEVO', sizePt: 20 }));
  expect(s.model.pages[0]!.runs.some((r) => r.text.includes('NUEVO'))).toBe(true);

  await bus.undo();
  expect(s.model.pages[0]!.runs.some((r) => r.text.includes('NUEVO'))).toBe(false);

  await bus.redo();
  expect(s.model.pages[0]!.runs.some((r) => r.text.includes('NUEVO'))).toBe(true);
});
