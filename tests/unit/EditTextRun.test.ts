import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { DocumentModel } from '../../src/model/DocumentModel';
import type { PageModel } from '../../src/model/types';
import { CommandBus, type Ctx } from '../../src/commands/Command';
import { EditTextRunCmd } from '../../src/commands/EditTextRun';

async function contexto(): Promise<{ ctx: Ctx; runId: number; original: string }> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.TimesRoman);
  const p = d.addPage([320, 200]);
  p.drawText('ORIGINAL', { x: 40, y: 150, size: 18, font: f, color: rgb(0, 0, 0) });
  const engine = await PdfiumEngine.create();
  const doc = await engine.open(await d.save());
  const runs = engine.getPageText(doc, 0);
  const r = runs.find((x) => x.text.includes('ORIGINAL'))!;
  const pages: PageModel[] = [{ index: 0, sizePt: engine.pageSize(doc, 0), rotation: 0, runs }];
  const model = new DocumentModel(pages);
  return { ctx: { engine, model, doc }, runId: r.runId, original: r.text };
}

test('dos ediciones con la misma clave = UN paso de deshacer; undo restaura el original', async () => {
  const { ctx, runId, original } = await contexto();
  const bus = new CommandBus(ctx);
  bus.execute(new EditTextRunCmd(0, runId, 'AB', original));
  bus.execute(new EditTextRunCmd(0, runId, 'ABC', 'AB'));
  expect(ctx.model.pages[0]!.runs[0]!.text).toBe('ABC');
  bus.undo();  // un solo paso por coalescing
  expect(ctx.model.pages[0]!.runs[0]!.text).toBe(original);
  expect(bus.canUndo()).toBe(false);
  // el motor también volvió al original
  expect(ctx.engine.getPageText(ctx.doc, 0)[0]!.text).toBe(original);
});

test('redo reaplica la edición', async () => {
  const { ctx, runId, original } = await contexto();
  const bus = new CommandBus(ctx);
  bus.execute(new EditTextRunCmd(0, runId, 'NUEVO', original));
  bus.undo();
  expect(ctx.model.pages[0]!.runs[0]!.text).toBe(original);
  bus.redo();
  expect(ctx.model.pages[0]!.runs[0]!.text).toBe('NUEVO');
  expect(ctx.engine.getPageText(ctx.doc, 0)[0]!.text).toBe('NUEVO');
});
