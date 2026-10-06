import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { ReemplazarTextoCmd, type CambioTexto } from '../../src/commands/ReemplazarTexto';
import { agruparLineasEditables, type LineaEditable } from '../../src/texto/lineasEditables';
import { buscarEnRuns, aplicarReemplazos } from '../../src/texto/buscarReemplazar';
import { fixture } from './_util/fixtures';

/**
 * N1 F4 (1): «Reemplazar» trabaja por LÍNEA EDITABLE. En un PDF por glifo (un objeto por carácter) casi ninguna
 * coincidencia cae dentro de un solo objeto; sobre la línea entera sí. Una coincidencia que cruza dos líneas sigue sin
 * reemplazarse (se cuenta).
 */
async function sesion(): Promise<EditSession> {
  return EditSession.open(await PdfiumEngine.create(), fixture('por-glifo.pdf'));
}

function lineas(s: EditSession, p = 0): LineaEditable[] {
  return agruparLineasEditables(s.ensureText(p), p);
}

/** Cambios por línea para `de` → `a` en la página `p`. */
function cambiosLinea(s: EditSession, de: string, a: string, p = 0): CambioTexto[] {
  const ls = lineas(s, p);
  const r = buscarEnRuns(ls.map((l) => ({ runId: l.runIds[0]!, text: l.text })), de, { mayusculas: true, palabraCompleta: false });
  const out: CambioTexto[] = [];
  for (const l of ls) {
    const cs = r.dentro.filter((c) => c.runId === l.runIds[0]);
    if (cs.length) out.push({ pageIndex: p, runId: l.runIds[0]!, oldText: l.text, newText: aplicarReemplazos(l.text, cs, a), linea: l });
  }
  return out;
}

const textosLineas = (s: EditSession, p = 0): string[] => lineas(s, p).map((l) => l.text).sort();

test('una coincidencia que cruza objetos de la MISMA línea se encuentra y se reemplaza', async () => {
  const s = await sesion();
  const ls = lineas(s);
  const r = buscarEnRuns(ls.map((l) => ({ runId: l.runIds[0]!, text: l.text })), 'tres cuatro', { mayusculas: true, palabraCompleta: false });
  expect(r.dentro).toHaveLength(1);
  expect(r.cruzan).toBe(0);
  // Por objeto no habría nada: la coincidencia no cabe en un solo `TextRun`.
  const porObjeto = buscarEnRuns(s.ensureText(0).map((x) => ({ runId: x.runId, text: x.text })), 'tres cuatro', { mayusculas: true, palabraCompleta: false });
  expect(porObjeto.dentro).toHaveLength(0);

  const cs = cambiosLinea(s, 'tres cuatro', 'TRES-4');
  const bus = new CommandBus(s);
  const cmd = new ReemplazarTextoCmd(cs, 'Reemplazar');
  await bus.execute(cmd);
  expect(cmd.resumen.fallidos).toBe(0);
  expect(textosLineas(s)).toContain('uno dos TRES-4 cinco seis');
});

test('reemplazar todo en varias líneas por glifo, un solo paso de deshacer y rehacer', async () => {
  const s = await sesion();
  const antes = textosLineas(s);
  const render0 = s.engine.renderPage(s.doc, 0, 1).data;
  const cs = cambiosLinea(s, 'Columna', 'Col');
  expect(cs).toHaveLength(4);
  const bus = new CommandBus(s);
  await bus.execute(new ReemplazarTextoCmd(cs, 'Reemplazar todo'));
  const despues = textosLineas(s);
  expect(despues).toContain('Col izquierda uno');
  expect(despues).toContain('Col derecha dos');
  expect(despues.some((t) => t.includes('Columna'))).toBe(false);
  // Las demás líneas, intactas.
  expect(despues).toContain('Celda A1');
  expect(despues).toContain('Estilo mixto: normal NEGRITA y fin.');

  await bus.undo();
  expect(textosLineas(s)).toEqual(antes);
  expect(Buffer.compare(Buffer.from(s.engine.renderPage(s.doc, 0, 1).data), Buffer.from(render0))).toBe(0);
  expect(bus.canUndo()).toBe(false);

  await bus.redo();
  expect(textosLineas(s)).toEqual(despues);
});

test('una línea multiestilo conserva negrita y color si el reemplazo cae fuera de la negrita', async () => {
  const s = await sesion();
  const antes = lineas(s).find((l) => l.text.startsWith('Estilo mixto'))!;
  await new CommandBus(s).execute(new ReemplazarTextoCmd(cambiosLinea(s, 'normal', 'plano'), 'Reemplazar'));
  const l = lineas(s).find((x) => x.text === 'Estilo mixto: plano NEGRITA y fin.')!;
  expect(l).toBeTruthy();
  expect(l.estilos.length).toBe(antes.estilos.length);
  const neg = l.estilos.find((e) => l.text.slice(e.inicio, e.fin).includes('NEGRITA'))!;
  expect(neg.fontName).toMatch(/Bold/);
  expect(neg.color[0]).toBe(255);
});

test('varias coincidencias en la MISMA línea compuesta se reemplazan juntas', async () => {
  const s = await sesion();
  const cs = cambiosLinea(s, 'o', '0');
  const linea = cs.find((c) => c.oldText === 'uno dos tres cuatro cinco seis')!;
  expect(linea.newText).toBe('un0 d0s tres cuatr0 cinc0 seis');
  await new CommandBus(s).execute(new ReemplazarTextoCmd([linea], 'Reemplazar'));
  expect(textosLineas(s)).toContain('un0 d0s tres cuatr0 cinc0 seis');
});

test('una coincidencia que cruza dos líneas NO se reemplaza (se cuenta)', async () => {
  const s = await sesion();
  const ls = lineas(s);
  const r = buscarEnRuns(ls.map((l) => ({ runId: l.runIds[0]!, text: l.text })), 'izquierda uno Columna', { mayusculas: true, palabraCompleta: false });
  expect(r.dentro).toHaveLength(0);
  expect(r.cruzan).toBe(1);
});

test('varias líneas de la misma página se reescriben sin que los objetos eliminados descoloquen a las demás', async () => {
  const s = await sesion();
  const cs = cambiosLinea(s, 'Celda', 'Cel');
  expect(cs).toHaveLength(6);
  const bus = new CommandBus(s);
  const cmd = new ReemplazarTextoCmd(cs, 'Reemplazar todo');
  await bus.execute(cmd);
  expect(cmd.resumen.fallidos).toBe(0);
  const t = textosLineas(s);
  for (const x of ['Cel A1', 'Cel B1', 'Cel C1', 'Cel A2', 'Cel B2', 'Cel C2']) expect(t).toContain(x);
});
