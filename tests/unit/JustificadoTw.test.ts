import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { agruparLineasEditables, type LineaEditable } from '../../src/texto/lineasEditables';
import { fixture } from './_util/fixtures';

/**
 * E-085: en una línea justificada (InDesign, Word) la palabra se partía en dos líneas editables porque el hueco entre objetos
 * se medía contra el avance NATURAL de los glifos, que ignora `Tw` y los ajustes de `TJ`. Editar una mitad dejaba la otra
 * donde estaba: «cooperativa» pasaba a «coop erativa» (una palabra que el usuario NO tocó, AGENTS.md §2.3).
 * `justificado-tw.pdf`: dos líneas, cada una en DOS objetos que parten «cooperativa»; la 1 con `Tw` de 9 pt (el hueco real
 * es 36 pt menor que el natural) y la 2 con `TJ` de +250 (el real es 9 pt mayor).
 * Unidades: pt de página (origen abajo-izquierda).
 */
const ESPERADAS = [
  'Los clientes de la cooperativa trabajan bien',
  'Nuestros clientes acuerdan que la cooperativa decide hoy'
];

async function abrir() {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(fixture('justificado-tw.pdf'));
  return { eng, doc };
}

function lineas(eng: PdfiumEngine, doc: number): LineaEditable[] {
  return agruparLineasEditables(eng.getPageText(doc, 0), 0);
}

test('una palabra partida entre dos objetos con Tw o TJ queda en UNA línea editable', async () => {
  const { eng, doc } = await abrir();
  const textos = lineas(eng, doc).map((l) => l.text).sort();
  expect(textos).toEqual([...ESPERADAS].sort());
  for (const l of lineas(eng, doc)) expect(l.runIds.length).toBe(2);
  eng.close(doc);
});

for (const [i, origen, nuevo] of [
  [0, 'clientes', 'usuarios'],
  [1, 'Nuestros', 'Mis']
] as const) {
  test(`reemplazar en la primera mitad (línea ${i + 1}) deja intacta «cooperativa» y no abre hueco en la palabra`, async () => {
    const { eng, doc } = await abrir();
    const l = lineas(eng, doc).find((x) => x.text === ESPERADAS[i])!;
    const [o1, o2] = l.runIds.map((id) => eng.getPageText(doc, 0).find((r) => r.runId === id)!);
    // Hueco REAL entre las cajas de los dos objetos antes de editar (pt).
    const huecoAntes = o2!.boxPt.xPt - (o1!.boxPt.xPt + o1!.boxPt.wPt);

    const res = eng.editLine(doc, 0, l, ESPERADAS[i]!.replace(origen, nuevo));
    expect(res.ok).toBe(true);

    const despues = lineas(eng, doc).find((x) => x.text === ESPERADAS[i]!.replace(origen, nuevo));
    expect(despues, 'la línea editada sigue siendo una sola').toBeDefined();
    expect(despues!.text).toContain('cooperativa');
    // El hueco entre «coop» y «erativa» es el mismo que había (la mitad derecha viajó exactamente Δ).
    const runs = eng.getPageText(doc, 0);
    const a = runs.find((r) => r.runId === despues!.runIds[0])!;
    const b = runs.find((r) => r.runId === despues!.runIds[despues!.runIds.length - 1])!;
    expect(b.boxPt.xPt - (a.boxPt.xPt + a.boxPt.wPt)).toBeCloseTo(huecoAntes, 1);

    // Tras guardar y reabrir, la palabra vecina se sigue encontrando entera.
    const guardado = await eng.open(eng.save(doc));
    expect(eng.findText(guardado, 0, 'cooperativa').length).toBe(2); // las dos líneas la contienen
    expect(eng.findText(guardado, 0, 'coop erativa').length).toBe(0);
    eng.close(guardado);
    eng.close(doc);
  });
}
