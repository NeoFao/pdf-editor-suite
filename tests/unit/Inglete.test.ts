import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { EditTextRunCmd } from '../../src/commands/EditTextRun';
import { SetColorCmd } from '../../src/commands/SetColor';
import { MoveRunCmd } from '../../src/commands/MoveRun';

/**
 * E-090 (docs/ERRORES-CONOCIDOS.md): `inglete.pdf` lleva `4 M` (límite de inglete) y `1.5 i` (planitud) en su content
 * stream. PDFium NO los regenera en `GenerateContent`, así que re-editar "de vuelta" no devolvía la página idéntica.
 * Deshacer debe restaurar por snapshot.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../fixtures/generados/inglete.pdf');
const ESCALA = 1.4;

async function abrir(): Promise<{ session: EditSession; runId: number; texto: string }> {
  const engine = await PdfiumEngine.create();
  const session = await EditSession.open(engine, new Uint8Array(fs.readFileSync(FIXTURE)));
  const r = session.ensureText(0).find((x) => x.text.includes('INGLETE'))!;
  return { session, runId: r.runId, texto: r.text };
}

function pixeles(s: EditSession): Uint8ClampedArray {
  return s.engine.renderPage(s.doc, 0, ESCALA).data;
}

function contarDistintos(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  expect(a.length).toBe(b.length);
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) n++;
  }
  return n;
}

/** Content stream (descomprimido) de la página 0 de unos bytes guardados. */
async function contenidoPagina(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  const node = pdf.getPage(0).node;
  const c = node.lookup(PDFName.of('Contents'));
  const flujos = c instanceof PDFArray ? c.asArray().map((r) => pdf.context.lookup(r)) : [c];
  return flujos.map((f) => Buffer.from(decodePDFRawStream(f as PDFRawStream).decode()).toString('latin1')).join('\n');
}

test('E-090: editar el texto y deshacer devuelve la página idéntica (0 px) y los mismos bytes', async () => {
  const { session, runId, texto } = await abrir();
  const bytesOriginal = session.engine.save(session.doc);
  const pxOriginal = pixeles(session);
  const bus = new CommandBus(session);

  await bus.execute(new EditTextRunCmd(0, runId, 'OTRO TEXTO', texto));
  await bus.undo();

  expect(contarDistintos(pxOriginal, pixeles(session))).toBe(0);
  expect(Buffer.compare(Buffer.from(session.engine.save(session.doc)), Buffer.from(bytesOriginal))).toBe(0);
  expect(await contenidoPagina(session.engine.save(session.doc))).toContain('4 M');
});

test('E-090: la coalescencia de ediciones consecutivas deshace al estado ORIGINAL (snapshot del primero)', async () => {
  const { session, runId, texto } = await abrir();
  const pxOriginal = pixeles(session);
  const bus = new CommandBus(session);

  await bus.execute(new EditTextRunCmd(0, runId, 'AB', texto));
  await bus.execute(new EditTextRunCmd(0, runId, 'ABC', 'AB'));
  await bus.undo();

  expect(bus.canUndo()).toBe(false);
  expect(contarDistintos(pxOriginal, pixeles(session))).toBe(0);
  expect(session.ensureText(0).find((x) => x.text.includes('INGLETE'))).toBeTruthy();
});

test('E-090: la edición registrada con pushExecuted (camino de la UI) también deshace por snapshot', async () => {
  const { session, runId, texto } = await abrir();
  const pxOriginal = pixeles(session);
  const bus = new CommandBus(session);

  const antes = session.engine.save(session.doc);
  session.engine.editTextRun(session.doc, 0, runId, 'DESDE LA UI');
  session.model.updateRunText(0, runId, 'DESDE LA UI');
  bus.pushExecuted(new EditTextRunCmd(0, runId, 'DESDE LA UI', texto, antes));
  await bus.undo();

  expect(contarDistintos(pxOriginal, pixeles(session))).toBe(0);
});

test('E-090: cambiar el color y deshacer devuelve la página idéntica', async () => {
  const { session, runId } = await abrir();
  const run = session.ensureText(0).find((x) => x.runId === runId)!;
  const pxOriginal = pixeles(session);
  const bus = new CommandBus(session);

  await bus.execute(new SetColorCmd(0, runId, [255, 0, 0], [run.color[0], run.color[1], run.color[2]]));
  await bus.undo();

  expect(contarDistintos(pxOriginal, pixeles(session))).toBe(0);
});

test('E-090: mover el texto y deshacer devuelve la página idéntica', async () => {
  const { session, runId } = await abrir();
  const pxOriginal = pixeles(session);
  const bus = new CommandBus(session);

  await bus.execute(new MoveRunCmd(0, runId, 30, -20));
  await bus.undo();

  expect(contarDistintos(pxOriginal, pixeles(session))).toBe(0);
});

/**
 * LIMITACIÓN CONOCIDA (E-090), medida y sin API en PDFium: tras EDITAR (sin deshacer) la página se regenera con
 * `FPDFPage_GenerateContent`, que no escribe `M` ni `i`. Si este test falla, PDFium ya conserva M/i: actualizar E-090
 * y la tabla de limitaciones, y quitar la limitación (y este test).
 */
test('E-090 limitación conocida: tras editar, el content stream regenerado ya no contiene `4 M` ni `1.5 i`', async () => {
  const { session, runId, texto } = await abrir();
  expect(await contenidoPagina(session.engine.save(session.doc))).toContain('4 M');
  const bus = new CommandBus(session);
  await bus.execute(new EditTextRunCmd(0, runId, 'OTRO TEXTO', texto));
  const regenerado = await contenidoPagina(session.engine.save(session.doc));
  expect(regenerado).not.toMatch(/\b4 M\b/);
  expect(regenerado).not.toMatch(/\b1\.5 i\b/);
});
