import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { RotatePageCmd } from '../../src/commands/RotatePage';
import { DeletePageCmd } from '../../src/commands/DeletePage';

async function sesionDos(): Promise<EditSession> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p0 = d.addPage([300, 200]); p0.drawText('UNO', { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  const p1 = d.addPage([300, 200]); p1.drawText('DOS', { x: 40, y: 150, size: 16, font: f, color: rgb(0, 0, 0) });
  const engine = await PdfiumEngine.create();
  return EditSession.open(engine, await d.save());
}

test('rotar página actualiza el modelo; deshacer revierte', async () => {
  const s = await sesionDos();
  const bus = new CommandBus(s);
  await bus.execute(new RotatePageCmd(0, 90));
  expect(s.model.pages[0]!.rotation).toBe(90);
  await bus.undo();
  expect(s.model.pages[0]!.rotation).toBe(0);
});

test('eliminar página reduce el conteo; deshacer la restaura (snapshot)', async () => {
  const s = await sesionDos();
  const bus = new CommandBus(s);
  await bus.execute(new DeletePageCmd(0));
  expect(s.model.pages.length).toBe(1);
  expect(s.ensureText(0).map((r) => r.text).join(' ')).toContain('DOS');
  await bus.undo();
  expect(s.model.pages.length).toBe(2);
  expect(s.ensureText(0).map((r) => r.text).join(' ')).toContain('UNO');
});
