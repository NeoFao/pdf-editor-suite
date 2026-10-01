import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { SetOutlineCmd } from '../../src/commands/SetOutline';
import type { OutlineItem } from '../../src/engine/PdfEngine';

test('SetOutlineCmd escribe el árbol, notifica a la UI y deshacer/rehacer restauran el anterior', async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 200]); d.addPage([300, 200]);
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);
  let avisos = 0;
  s.model.onOutlineChange(() => { avisos++; });

  const antes = engine.getOutline(s.doc);
  expect(antes).toEqual([]);
  const despues: OutlineItem[] = [{ title: 'Ñ 😀', pageIndex: 1, children: [{ title: 'hijo', pageIndex: 0, children: [] }] }];

  await bus.execute(new SetOutlineCmd(antes, despues, 'Nuevo marcador'));
  expect(engine.getOutline(s.doc)).toEqual(despues);
  expect(avisos).toBe(1);

  await bus.undo();
  expect(engine.getOutline(s.doc)).toEqual([]);
  expect(avisos).toBe(2);

  await bus.redo();
  expect(engine.getOutline(s.doc)).toEqual(despues);
  // El PDF guardado conserva el outline.
  const re = await engine.open(engine.save(s.doc));
  expect(engine.getOutline(re)).toEqual(despues);
});
