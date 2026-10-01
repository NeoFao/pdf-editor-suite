import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { AddNoteCmd } from '../../src/commands/AddNote';
import { SetNoteTextCmd } from '../../src/commands/SetNoteText';
import { RemoveNoteCmd } from '../../src/commands/RemoveNote';

async function sesion() {
  const d = await PDFDocument.create();
  d.addPage([300, 200]);
  d.addPage([300, 200]);
  const s = await EditSession.open(await PdfiumEngine.create(), await d.save());
  return { s, bus: new CommandBus(s) };
}

test('SetNoteTextCmd cambia el texto; deshacer lo restaura y rehacer lo repone', async () => {
  const { s, bus } = await sesion();
  await bus.execute(new AddNoteCmd(1, 60, 150, 'antes'));
  const idx = s.engine.getNotes(s.doc, 1)[0]!.index;

  await bus.execute(new SetNoteTextCmd(1, idx, 'después ñ 🎉'));
  expect(s.engine.getNotes(s.doc, 1)[0]!.text).toBe('después ñ 🎉');
  await bus.undo();
  expect(s.engine.getNotes(s.doc, 1)[0]!.text).toBe('antes');
  await bus.redo();
  expect(s.engine.getNotes(s.doc, 1)[0]!.text).toBe('después ñ 🎉');
});

test('RemoveNoteCmd borra la nota; deshacer la repone (snapshot) y rehacer la quita', async () => {
  const { s, bus } = await sesion();
  await bus.execute(new AddNoteCmd(0, 60, 150, 'una'));
  await bus.execute(new AddNoteCmd(0, 90, 150, 'dos'));
  const idx = s.engine.getNotes(s.doc, 0)[0]!.index;

  await bus.execute(new RemoveNoteCmd(0, idx));
  expect(s.engine.getNotes(s.doc, 0).map((n) => n.text)).toEqual(['dos']);
  await bus.undo();
  expect(s.engine.getNotes(s.doc, 0).map((n) => n.text)).toEqual(['una', 'dos']);
  await bus.redo();
  expect(s.engine.getNotes(s.doc, 0).map((n) => n.text)).toEqual(['dos']);
});
