import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { PropiedadesLineaCmd } from '../../src/commands/PropiedadesLinea';
import { agruparLineasEditables } from '../../src/texto/lineasEditables';
import { fixture } from './_util/fixtures';

/** N1 F4 (4): las propiedades de una línea compuesta son UN paso de deshacer que devuelve los bytes renderizados idénticos. */
async function sesion(): Promise<EditSession> {
  return EditSession.open(await PdfiumEngine.create(), fixture('por-glifo.pdf'));
}
const linea = (s: EditSession, texto: string) => agruparLineasEditables(s.ensureText(0), 0).find((l) => l.text === texto)!;

for (const [nombre, props] of [
  ['color', { color: [0, 0, 255] as [number, number, number] }],
  ['tamaño', { escala: 1.5 }],
  ['fuente', { fuenteEstandar: 'Times-Roman' }]
] as const) {
  test(`${nombre}: deshacer devuelve el render idéntico y rehacer lo vuelve a aplicar`, async () => {
    const s = await sesion();
    const render0 = Buffer.from(s.engine.renderPage(s.doc, 0, 1).data);
    const bus = new CommandBus(s);
    const cmd = new PropiedadesLineaCmd(0, linea(s, 'Columna derecha dos'), props);
    await bus.execute(cmd);
    expect(cmd.ok).toBe(true);
    const render1 = Buffer.from(s.engine.renderPage(s.doc, 0, 1).data);
    expect(Buffer.compare(render1, render0)).not.toBe(0);
    await bus.undo();
    expect(Buffer.compare(Buffer.from(s.engine.renderPage(s.doc, 0, 1).data), render0)).toBe(0);
    expect(bus.canUndo()).toBe(false);
    await bus.redo();
    expect(Buffer.compare(Buffer.from(s.engine.renderPage(s.doc, 0, 1).data), render1)).toBe(0);
  });
}

test('un cambio que falla no deja rastro: ok=false con razón y el documento no cambia', async () => {
  const s = await sesion();
  const antes = Buffer.from(s.engine.save(s.doc));
  const cmd = new PropiedadesLineaCmd(0, linea(s, 'Celda A1'), { escala: 1000 });
  cmd.execute(s);
  expect(cmd.ok).toBe(false);
  expect(cmd.razon).toBe('invalid-size');
  expect(Buffer.compare(Buffer.from(s.engine.save(s.doc)), antes)).toBe(0);
});
