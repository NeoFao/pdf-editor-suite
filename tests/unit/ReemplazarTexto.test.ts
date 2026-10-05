import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { ReemplazarTextoCmd, type CambioTexto } from '../../src/commands/ReemplazarTexto';

/** 3 páginas, 2 líneas por página; cada una contiene "casa". */
async function sesion(extraZapf = false): Promise<EditSession> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) {
    const p = d.addPage([320, 200]);
    p.drawText(`pagina ${i} la casa roja`, { x: 20, y: 150, size: 14, font: f, color: rgb(0, 0, 0) });
    p.drawText(`otra casa y casa ${i}`, { x: 20, y: 100, size: 14, font: f, color: rgb(0, 0, 0) });
    if (extraZapf && i === 1) {
      const z = await d.embedFont(StandardFonts.ZapfDingbats);
      p.drawText('✁✂✃✄', { x: 20, y: 50, size: 14, font: z, color: rgb(0, 0, 0) });
    }
  }
  const engine = await PdfiumEngine.create();
  return EditSession.open(engine, await d.save());
}

function cambios(s: EditSession, de: string, a: string): CambioTexto[] {
  const out: CambioTexto[] = [];
  for (let p = 0; p < s.model.pages.length; p++) {
    for (const r of s.ensureText(p)) {
      if (r.text.includes(de)) out.push({ pageIndex: p, runId: r.runId, oldText: r.text, newText: r.text.split(de).join(a) });
    }
  }
  return out;
}

const textos = (s: EditSession): string[] =>
  s.model.pages.flatMap((_, p) => s.engine.getPageText(s.doc, p).map((r) => r.text));

test('Reemplazar todo: do aplica todos los cambios y undo los deshace de GOLPE (un solo paso)', async () => {
  const s = await sesion();
  const antes = textos(s);
  const bus = new CommandBus(s);
  const cs = cambios(s, 'casa', 'piso');
  expect(cs).toHaveLength(6);
  await bus.execute(new ReemplazarTextoCmd(cs, 'Reemplazar todo'));

  const despues = textos(s);
  expect(despues.some((t) => t.includes('casa'))).toBe(false);
  expect(despues.filter((t) => t.includes('piso'))).toHaveLength(6);
  expect(s.ensureText(1).some((r) => r.text.includes('piso'))).toBe(true); // modelo sincronizado

  await bus.undo();
  expect(textos(s)).toEqual(antes);
  expect(bus.canUndo()).toBe(false); // era UN solo paso

  await bus.redo();
  expect(textos(s)).toEqual(despues);
});

test('conserva fuente, tamaño y color del run original', async () => {
  const s = await sesion();
  const orig = s.engine.getPageText(s.doc, 0)[0]!;
  await new CommandBus(s).execute(new ReemplazarTextoCmd(cambios(s, 'casa', 'piso'), 'Reemplazar todo'));
  const nuevo = s.engine.getPageText(s.doc, 0)[0]!;
  expect(nuevo.fontName).toBe(orig.fontName);
  expect(nuevo.sizePt).toBeCloseTo(orig.sizePt, 3);
  expect(nuevo.color).toEqual(orig.color);
});

test('informa del progreso por página y cede el hilo entre páginas', async () => {
  const s = await sesion();
  const progreso: number[] = [];
  let cesiones = 0;
  const cmd = new ReemplazarTextoCmd(cambios(s, 'casa', 'piso'), 'Reemplazar todo', {
    onProgress: (hechas) => progreso.push(hechas),
    ceder: async () => { cesiones++; },
    paginasPorTanda: 1
  });
  await cmd.execute(s);
  expect(progreso.at(-1)).toBe(3);
  expect(cesiones).toBe(2);
});

test('si a la fuente le faltan glifos, usa fuente estándar y undo restaura todo el documento', async () => {
  const s = await sesion(true);
  const zapf = s.engine.getPageText(s.doc, 1).find((r) => r.text === '✁✂✃✄')!;
  const antes = textos(s);
  const bus = new CommandBus(s);
  const cs = [...cambios(s, 'casa', 'piso'), { pageIndex: 1, runId: zapf.runId, oldText: zapf.text, newText: 'Mañana €' }];
  const cmd = new ReemplazarTextoCmd(cs, 'Reemplazar todo');
  await bus.execute(cmd);
  expect(cmd.resumen.sustituidos).toBe(1);
  expect(cmd.resumen.fuentes).toContain('Helvetica');
  expect(cmd.resumen.fallidos).toBe(0);
  expect(textos(s)).toContain('Mañana €');
  expect(textos(s).some((t) => t.includes('casa'))).toBe(false);

  await bus.undo();
  expect(textos(s)).toEqual(antes);
});

test('si ni la fuente estándar cubre el texto, el run queda intacto y se cuenta como fallido', async () => {
  const s = await sesion(true);
  const zapf = s.engine.getPageText(s.doc, 1).find((r) => r.text === '✁✂✃✄')!;
  const cmd = new ReemplazarTextoCmd([{ pageIndex: 1, runId: zapf.runId, oldText: zapf.text, newText: '日本語' }], 'Reemplazar');
  await new CommandBus(s).execute(cmd);
  expect(cmd.resumen.fallidos).toBe(1);
  expect(s.engine.getPageText(s.doc, 1).some((r) => r.text === '✁✂✃✄')).toBe(true);
});
