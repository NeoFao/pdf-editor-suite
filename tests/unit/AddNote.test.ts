import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { AddNoteCmd } from '../../src/commands/AddNote';

test('AddNoteCmd añade una nota; deshacer la quita y rehacer la repone (snapshot)', async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 200]);
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);

  await bus.execute(new AddNoteCmd(0, 60, 150, 'Mi nota'));
  expect(s.engine.getNotes(s.doc, 0)).toHaveLength(1);
  expect(s.engine.getNotes(s.doc, 0)[0]!.text).toBe('Mi nota');

  await bus.undo();
  expect(s.engine.getNotes(s.doc, 0)).toHaveLength(0);

  await bus.redo();
  expect(s.engine.getNotes(s.doc, 0)).toHaveLength(1);
  expect(s.engine.getNotes(s.doc, 0)[0]!.text).toBe('Mi nota');
});
