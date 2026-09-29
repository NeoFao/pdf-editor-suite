import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { InsertPdfCmd } from '../../src/commands/InsertPdf';

async function unaPagina(texto: string): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([300, 200]); p.drawText(texto, { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  return d.save();
}

test('insertar otro PDF añade sus páginas; deshacer las quita (snapshot)', async () => {
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await unaPagina('DEST'));
  const bus = new CommandBus(s);
  await bus.execute(new InsertPdfCmd(await unaPagina('EXTRA'), 1));
  expect(s.model.pages.length).toBe(2);
  expect(s.ensureText(1).map((r) => r.text).join(' ')).toContain('EXTRA');
  await bus.undo();
  expect(s.model.pages.length).toBe(1);
});
