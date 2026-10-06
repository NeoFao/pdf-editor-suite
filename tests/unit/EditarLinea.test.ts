import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { EditarLineaCmd } from '../../src/commands/EditarLinea';
import { MoveRunCmd } from '../../src/commands/MoveRun';
import { DeleteRunCmd } from '../../src/commands/DeleteRun';
import { agruparLineasEditables } from '../../src/texto/lineasEditables';
import { fixture } from './_util/fixtures';

async function sesion(nombre = 'por-glifo.pdf') {
  const engine = await PdfiumEngine.create();
  const session = await EditSession.open(engine, fixture(nombre));
  return { session, engine };
}

const lineaDe = (s: EditSession, texto: string) => {
  const l = agruparLineasEditables(s.ensureText(0), 0).find((x) => x.text === texto);
  if (!l) throw new Error(`sin línea «${texto}»`);
  return l;
};

const render = (s: EditSession) => Buffer.from(s.engine.renderPage(s.doc, 0, 2).data.buffer);

test('execute edita la línea; undo (snapshot) devuelve la página idéntica en bytes renderizados; redo la vuelve a editar', async () => {
  const { session } = await sesion();
  const bus = new CommandBus(session);
  const original = render(session);
  const l = lineaDe(session, 'uno dos tres cuatro cinco seis');

  const cmd = new EditarLineaCmd(0, l, 'uno dos TRES cuatro cinco seis');
  await bus.execute(cmd);
  expect(cmd.ok).toBe(true);
  expect(cmd.fontName).toBeNull();
  expect(lineaDe(session, 'uno dos TRES cuatro cinco seis')).toBeDefined();
  const editado = render(session);
  expect(Buffer.compare(editado, original)).not.toBe(0);

  expect(await bus.undo()).toBe('Editar texto');
  expect(Buffer.compare(render(session), original)).toBe(0); // criterio (5): idéntica
  expect(lineaDe(session, 'uno dos tres cuatro cinco seis')).toBeDefined();

  expect(await bus.redo()).toBe('Editar texto');
  expect(Buffer.compare(render(session), editado)).toBe(0);
});

test('mismo texto: ok y sinCambios, sin tocar el documento ni cargar nada', async () => {
  const { session, engine } = await sesion();
  const l = lineaDe(session, 'Celda A1');
  const antes = engine.save(session.doc);
  const cmd = new EditarLineaCmd(0, l, 'Celda A1');
  await cmd.execute(session);
  expect(cmd.ok).toBe(true);
  expect(cmd.sinCambios).toBe(true);
  expect(Buffer.compare(Buffer.from(engine.save(session.doc)), Buffer.from(antes))).toBe(0);
});

test('línea vacía o carácter que ninguna fuente cubre: ok=false con su razón y el documento intacto', async () => {
  const { session, engine } = await sesion();
  const l = lineaDe(session, 'Celda A1');
  const antes = engine.save(session.doc);
  const vacio = new EditarLineaCmd(0, l, '');
  await vacio.execute(session);
  expect(vacio.ok).toBe(false);
  expect(vacio.razon).toBe('empty-text');
  const cjk = new EditarLineaCmd(0, l, 'Celda 漢字');
  await cjk.execute(session);
  expect(cjk.ok).toBe(false);
  expect(cjk.razon).toBe('glyph-missing');
  expect(Buffer.compare(Buffer.from(engine.save(session.doc)), Buffer.from(antes))).toBe(0);
});

test('a la fuente le falta un glifo: el comando reintenta con la fuente estándar y expone fontName; undo restaura', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.ZapfDingbats);
  const p = d.addPage([320, 200]);
  let x = 40;
  for (const t of ['✁✂', ' ', '✃✄']) { p.drawText(t, { x, y: 130, size: 18, font: f, color: rgb(0, 0, 0) }); x += f.widthOfTextAtSize(t, 18); }
  const engine = await PdfiumEngine.create();
  const session = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(session);
  const original = render(session);
  const l = agruparLineasEditables(session.ensureText(0), 0)[0]!;
  const cmd = new EditarLineaCmd(0, l, '✁✂ Mañana €✃✄');
  await bus.execute(cmd);
  expect(cmd.ok).toBe(true);
  expect(cmd.fontName).toBe('Helvetica');
  await bus.undo();
  expect(Buffer.compare(render(session), original)).toBe(0);
});

test('MoveRunCmd con runIds mueve TODOS los objetos de la línea; undo los devuelve', async () => {
  const { session } = await sesion();
  const bus = new CommandBus(session);
  const l = lineaDe(session, 'Columna izquierda uno');
  const antes = session.ensureText(0).filter((r) => l.runIds.includes(r.runId)).map((r) => [r.matriz[4], r.matriz[5]]);
  await bus.execute(new MoveRunCmd(0, l.runIds[0]!, 10, -6, l.runIds));
  const mov = session.ensureText(0).filter((r) => l.runIds.includes(r.runId));
  mov.forEach((r, i) => { expect(r.matriz[4]).toBeCloseTo(antes[i]![0]! + 10, 2); expect(r.matriz[5]).toBeCloseTo(antes[i]![1]! - 6, 2); });
  // Las otras líneas no se movieron.
  const otra = session.ensureText(0).find((r) => r.textoReal === 'C' && !l.runIds.includes(r.runId))!;
  expect(otra).toBeDefined();
  await bus.undo();
  const vuelta = session.ensureText(0).filter((r) => l.runIds.includes(r.runId));
  vuelta.forEach((r, i) => { expect(r.matriz[4]).toBeCloseTo(antes[i]![0]!, 2); expect(r.matriz[5]).toBeCloseTo(antes[i]![1]!, 2); });
});

test('DeleteRunCmd con runIds elimina la línea entera y undo la restaura', async () => {
  const { session } = await sesion();
  const bus = new CommandBus(session);
  const original = render(session);
  const l = lineaDe(session, 'Celda B1');
  await bus.execute(new DeleteRunCmd(0, l.runIds[0]!, l.runIds));
  const textos = agruparLineasEditables(session.ensureText(0), 0).map((x) => x.text);
  expect(textos).not.toContain('Celda B1');
  expect(textos).toContain('Celda A1');
  expect(textos).toContain('Celda C1');
  await bus.undo();
  expect(Buffer.compare(render(session), original)).toBe(0);
});
