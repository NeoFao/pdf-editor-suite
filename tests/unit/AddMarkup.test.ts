import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { AddMarkupCmd } from '../../src/commands/AddMarkup';
import { RemoveNoteCmd } from '../../src/commands/RemoveNote';
import { rectToQuad } from '../../src/coords/quads';

test('AddMarkupCmd crea una anotación real; deshacer la quita, rehacer la repone y borrarla deja el texto', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  d.addPage([300, 200]).drawText('HOLA', { x: 40, y: 150, size: 20, font: f });
  const s = await EditSession.open(await PdfiumEngine.create(), await d.save());
  const bus = new CommandBus(s);
  const quad = rectToQuad({ xPt: 40, yPt: 146, wPt: 60, hPt: 24 });

  await bus.execute(new AddMarkupCmd(0, 'highlight', [quad], [250, 204, 21]));
  expect(s.engine.getComments(s.doc, 0).map((c) => c.kind)).toEqual(['highlight']);

  await bus.undo();
  expect(s.engine.getComments(s.doc, 0)).toEqual([]);

  await bus.redo();
  const c = s.engine.getComments(s.doc, 0);
  expect(c.map((x) => x.kind)).toEqual(['highlight']);

  await bus.execute(new RemoveNoteCmd(0, c[0]!.index));
  expect(s.engine.getComments(s.doc, 0)).toEqual([]);
  expect(s.engine.getPageText(s.doc, 0).map((r) => r.text).join('')).toContain('HOLA');
  await bus.undo(); // deshacer el borrado devuelve la anotación
  expect(s.engine.getComments(s.doc, 0)).toHaveLength(1);
});
