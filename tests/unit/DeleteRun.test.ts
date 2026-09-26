import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { DeleteRunCmd } from '../../src/commands/DeleteRun';

async function sesionDos(): Promise<EditSession> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([320, 200]);
  p.drawText('CONFIDENCIAL', { x: 40, y: 150, size: 14, font: f, color: rgb(0, 0, 0) });
  p.drawText('se queda', { x: 40, y: 110, size: 12, font: f, color: rgb(0, 0, 0) });
  const engine = await PdfiumEngine.create();
  return EditSession.open(engine, await d.save());
}

test('borrar elimina el run del modelo y del motor; deshacer lo restaura (snapshot)', async () => {
  const s = await sesionDos();
  const bus = new CommandBus(s);
  const objetivo = s.model.pages[0]!.runs.find((r) => r.text.includes('CONFIDENCIAL'))!;

  await bus.execute(new DeleteRunCmd(0, objetivo.runId));
  const tras = s.model.pages[0]!.runs.map((r) => r.text).join(' | ');
  expect(tras).not.toContain('CONFIDENCIAL');
  expect(tras).toContain('se queda');
  expect(s.engine.getPageText(s.doc, 0).map((r) => r.text).join(' | ')).not.toContain('CONFIDENCIAL');

  await bus.undo();
  const vuelta = s.model.pages[0]!.runs.map((r) => r.text).join(' | ');
  expect(vuelta).toContain('CONFIDENCIAL');
  expect(vuelta).toContain('se queda');
});
