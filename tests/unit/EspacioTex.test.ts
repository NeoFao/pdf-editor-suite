import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { agruparLineasEditables, type LineaEditable } from '../../src/texto/lineasEditables';
import { fixture } from './_util/fixtures';

/**
 * E-086: pdfTeX no escribe el espacio como glifo (TeX separa las palabras con desplazamientos de `TJ`), así que la fuente
 * subconjunto no trae glifo de espacio. Al teclear un espacio, la verificación de E-079 (releer lo escrito) lo tomaba por
 * glifo ausente y pasaba TODA la línea a Helvetica. `sin-espacio-tex.pdf`: TrueType simple sin glifo de espacio, una línea
 * por objeto con `[(HOLA)-333(MUNDO)] TJ`. Unidades: pt de página; el render va a `ESCALA` px por pt.
 */
const ESCALA = 2;
const FUENTE = 'TeXSinEspacio';

async function abrir() {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(fixture('sin-espacio-tex.pdf'));
  return { eng, doc };
}

function lineas(eng: PdfiumEngine, doc: number): LineaEditable[] {
  return agruparLineasEditables(eng.getPageText(doc, 0), 0);
}

function linea(eng: PdfiumEngine, doc: number, texto: string): LineaEditable {
  const l = lineas(eng, doc).find((x) => x.text === texto);
  if (!l) throw new Error(`No hay línea «${texto}»: ${lineas(eng, doc).map((x) => x.text).join(' | ')}`);
  return l;
}

/** Fuentes de los objetos de una línea, tal como las lee el motor al reabrir. */
function fuentesDe(eng: PdfiumEngine, doc: number, l: LineaEditable): string[] {
  const runs = eng.getPageText(doc, 0);
  return l.runIds.map((id) => runs.find((r) => r.runId === id)!.fontName);
}

test('las palabras de una línea de TeX se extraen separadas por espacio', async () => {
  const { eng, doc } = await abrir();
  expect(lineas(eng, doc).map((l) => l.text).sort()).toEqual(['AMO HOLA UNA DAMA', 'HOLA MUNDO', 'UNA MANO']);
  eng.close(doc);
});

for (const [original, nuevo] of [
  ['HOLA MUNDO', 'HOLA DUMNO'], // palabra editada, con la separación intacta
  ['HOLA MUNDO', 'HOLA AMO MUNDO'], // espacio tecleado: palabra nueva en medio
  ['AMO HOLA UNA DAMA', 'AMO HOLA UNA MADA'], // última palabra de una línea de cuatro
  ['AMO HOLA UNA DAMA', 'NAD HOLA UNA DAMA'] // primera palabra
] as const) {
  test(`«${original}» → «${nuevo}» conserva la fuente original y no pasa a Helvetica`, async () => {
    const { eng, doc } = await abrir();
    const l = linea(eng, doc, original);
    const res = eng.editLine(doc, 0, l, nuevo);
    expect(res.ok).toBe(true);
    if (res.ok && !('sinCambios' in res)) expect(res.fuenteEstandar).toBeUndefined();

    const despues = linea(eng, doc, nuevo);
    expect(fuentesDe(eng, doc, despues).every((f) => f.endsWith(FUENTE))).toBe(true);
    expect(despues.text).not.toMatch(/[\u0000-\u001f\ufffd]/); // ni `.notdef` ni controles

    // Guardado y reabierto: las palabras siguen separadas por espacio y se encuentran.
    const guardado = await eng.open(eng.save(doc));
    const l2 = linea(eng, guardado, nuevo);
    expect(fuentesDe(eng, guardado, l2).every((f) => f.endsWith(FUENTE))).toBe(true);
    expect(eng.findText(guardado, 0, nuevo).length).toBe(1);
    eng.close(guardado);
    eng.close(doc);
  });
}

test('una línea ya partida en palabras admite otra edición con un espacio nuevo', async () => {
  const { eng, doc } = await abrir();
  expect(eng.editLine(doc, 0, linea(eng, doc, 'HOLA MUNDO'), 'HOLA DUMNO').ok).toBe(true);
  const res = eng.editLine(doc, 0, linea(eng, doc, 'HOLA DUMNO'), 'HOLA DUM NO');
  expect(res.ok).toBe(true);
  const l = linea(eng, doc, 'HOLA DUM NO');
  expect(fuentesDe(eng, doc, l).every((f) => f.endsWith(FUENTE))).toBe(true);
  eng.close(doc);
});

test('el espacio nuevo mide lo que el original (≈ 0,333 em = 8 pt) y las otras líneas no se mueven', async () => {
  const { eng, doc } = await abrir();
  const alto = eng.pageSize(doc, 0).heightPt;
  const l = linea(eng, doc, 'HOLA MUNDO');
  const antes = eng.renderPage(doc, 0, ESCALA);
  expect(eng.editLine(doc, 0, l, 'HOLA DUMNO').ok).toBe(true);
  const despues = eng.renderPage(doc, 0, ESCALA);

  // Criterio (2): 0 px distintos fuera de la franja de la línea editada.
  const y0 = Math.floor((alto - (l.boxPt.yPt + l.boxPt.hPt)) * ESCALA) - 1;
  const y1 = Math.ceil((alto - l.boxPt.yPt) * ESCALA) + 1;
  let fuera = 0;
  for (let y = 0; y < antes.height; y++) {
    if (y >= y0 && y < y1) continue;
    for (let x = 0; x < antes.width; x++) {
      const i = (y * antes.width + x) * 4;
      if (antes.data[i] !== despues.data[i] || antes.data[i + 1] !== despues.data[i + 1] || antes.data[i + 2] !== despues.data[i + 2]) fuera++;
    }
  }
  expect(fuera).toBe(0);

  const runs = eng.getPageText(doc, 0);
  const nl = linea(eng, doc, 'HOLA DUMNO');
  const cajas = nl.runIds.map((id) => runs.find((r) => r.runId === id)!.boxPt).sort((a, b) => a.xPt - b.xPt);
  expect(cajas.length).toBe(2);
  const hueco = cajas[1]!.xPt - (cajas[0]!.xPt + cajas[0]!.wPt);
  expect(hueco).toBeGreaterThan(6); // 8 pt de espacio menos el margen lateral de los glifos
  expect(hueco).toBeLessThan(10);
  eng.close(doc);
});

test('un glifo VISIBLE ausente sigue yendo a la fuente estándar (E-047), no el espacio', async () => {
  const { eng, doc } = await abrir();
  const l = linea(eng, doc, 'HOLA MUNDO');
  const sinEstandar = eng.editLine(doc, 0, l, 'HOLA ZETA');
  expect(sinEstandar).toMatchObject({ ok: false, reason: 'glyph-missing' });
  const conEstandar = eng.editLine(doc, 0, l, 'HOLA ZETA', { fuenteEstandar: true });
  expect(conEstandar).toMatchObject({ ok: true, fuenteEstandar: 'Helvetica' });
  eng.close(doc);
});
