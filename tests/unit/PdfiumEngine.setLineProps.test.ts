import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { agruparLineasEditables, type LineaEditable } from '../../src/texto/lineasEditables';
import { fixture } from './_util/fixtures';

/**
 * N1 F4 (4): `setLineProps` cambia color, tamaño (factor) y fuente estándar de TODOS los objetos de una línea editable en
 * una sola carga de página y un solo `GenerateContent`. Unidades: pt de página sin girar; el tamaño es el EFECTIVO (E-080).
 */
const ESCALA = 2;

async function abrir() {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(fixture('por-glifo.pdf'));
  return { eng, doc };
}
const lineas = (eng: PdfiumEngine, doc: number): LineaEditable[] => agruparLineasEditables(eng.getPageText(doc, 0), 0);
const linea = (eng: PdfiumEngine, doc: number, t: string): LineaEditable => lineas(eng, doc).find((l) => l.text === t)!;
const runsDe = (eng: PdfiumEngine, doc: number, l: LineaEditable) => {
  const todos = eng.getPageText(doc, 0);
  return l.runIds.map((id) => todos.find((r) => r.runId === id)!);
};

function distintosFuera(a: { width: number; height: number; data: Uint8ClampedArray }, b: { width: number; height: number; data: Uint8ClampedArray }, y0: number, y1: number): number {
  let n = 0;
  for (let y = 0; y < a.height; y++) {
    if (y >= y0 && y < y1) continue;
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) n++;
    }
  }
  return n;
}

test('color: todos los objetos de la línea cambian; el resto de la página queda idéntico', async () => {
  const { eng, doc } = await abrir();
  const l = linea(eng, doc, 'Estilo mixto: normal NEGRITA y fin.');
  const alto = eng.pageSize(doc, 0).heightPt;
  const antes = eng.renderPage(doc, 0, ESCALA);
  const res = eng.setLineProps(doc, 0, l, { color: [0, 0, 255] });
  expect(res).toMatchObject({ ok: true });
  for (const r of runsDe(eng, doc, l)) expect(r.color.slice(0, 3)).toEqual([0, 0, 255]);
  const b = l.boxPt;
  expect(distintosFuera(antes, eng.renderPage(doc, 0, ESCALA), Math.floor((alto - b.yPt - b.hPt) * ESCALA) - 1, Math.ceil((alto - b.yPt) * ESCALA) + 1)).toBe(0);
  eng.close(doc);
});

test('tamaño: factor k sobre todos los objetos respecto al origen del primero; texto y proporciones intactos', async () => {
  const { eng, doc } = await abrir();
  const l = linea(eng, doc, 'E=mc2 fin.'); // multi-tamaño: el superíndice conserva su proporción
  const antes = runsDe(eng, doc, l);
  const alto = eng.pageSize(doc, 0).heightPt;
  const render0 = eng.renderPage(doc, 0, ESCALA);
  const res = eng.setLineProps(doc, 0, l, { escala: 0.8 });
  expect(res).toMatchObject({ ok: true });
  const despues = runsDe(eng, doc, l);
  despues.forEach((r, i) => expect(r.sizeEfectivoPt).toBeCloseTo(antes[i]!.sizeEfectivoPt * 0.8, 2));
  // El origen del primer objeto no se mueve; los demás se acercan a él en proporción.
  expect(despues[0]!.originPt.xPt).toBeCloseTo(antes[0]!.originPt.xPt, 3);
  const x0 = antes[0]!.originPt.xPt;
  despues.forEach((r, i) => expect(r.originPt.xPt - x0).toBeCloseTo((antes[i]!.originPt.xPt - x0) * 0.8, 2));
  const nl = lineas(eng, doc).find((x) => x.text === 'E=mc2 fin.');
  expect(nl).toBeDefined(); // la línea sigue siendo UNA línea con el mismo texto
  // Al reducir, nada fuera de la franja original.
  const b = l.boxPt;
  expect(distintosFuera(render0, eng.renderPage(doc, 0, ESCALA), Math.floor((alto - b.yPt - b.hPt) * ESCALA) - 1, Math.ceil((alto - b.yPt) * ESCALA) + 1)).toBe(0);
  eng.close(doc);
});

test('fuente estándar: la línea se reescribe con un objeto por tramo de estilo, mismo texto y colores, y se lee igual', async () => {
  const { eng, doc } = await abrir();
  const l = linea(eng, doc, 'Estilo mixto: normal NEGRITA y fin.');
  const res = eng.setLineProps(doc, 0, l, { fuenteEstandar: 'Courier' });
  expect(res).toMatchObject({ ok: true });
  const despues = lineas(eng, doc).find((x) => x.text === 'Estilo mixto: normal NEGRITA y fin.');
  expect(despues, lineas(eng, doc).map((x) => x.text).join('|')).toBeDefined();
  // Tres tramos de estilo (normal, roja, normal) → tres objetos, todos en Courier; el rojo se conserva.
  expect(despues!.runIds).toHaveLength(3);
  for (const r of runsDe(eng, doc, despues!)) expect(r.fontName).toContain('Courier');
  const rojo = despues!.estilos.find((e) => despues!.text.slice(e.inicio, e.fin).includes('NEGRITA'))!;
  expect(rojo.color.slice(0, 3)).toEqual([255, 0, 0]);
  expect((res as { lineaRunIdInicial: number }).lineaRunIdInicial).toBe(despues!.runIds[0]);
  // Las demás líneas, intactas.
  for (const t of ['Celda A1', 'Columna izquierda uno', 'uno dos tres cuatro cinco seis']) expect(lineas(eng, doc).some((x) => x.text === t), t).toBe(true);
  eng.close(doc);
});

test('fuente estándar en una línea justificada pasa a espaciado natural y se relee igual', async () => {
  const { eng, doc } = await abrir();
  const l = linea(eng, doc, 'uno dos tres cuatro cinco seis');
  const res = eng.setLineProps(doc, 0, l, { fuenteEstandar: 'Times-Roman' });
  expect(res).toMatchObject({ ok: true });
  const despues = lineas(eng, doc).find((x) => x.text === 'uno dos tres cuatro cinco seis');
  expect(despues).toBeDefined();
  expect(despues!.runIds).toHaveLength(1);
  expect(despues!.boxPt.wPt).toBeLessThan(l.boxPt.wPt); // sin los 5 px de hueco extra por palabra
  eng.close(doc);
});

test('fuente estándar sin algún glifo: devuelve glyph-missing y NO modifica el documento', async () => {
  const { eng, doc } = await abrir();
  const l = linea(eng, doc, 'Celda A1');
  const antes = eng.save(doc);
  const rara: LineaEditable = { ...l, text: '日本語 A1', tramos: l.tramos.map((t, i) => (i === 0 ? { ...t, fin: t.inicio + 1 } : t)) };
  // El texto de la línea (que el motor escribe) no lo cubre ninguna fuente estándar.
  const res = eng.setLineProps(doc, 0, { ...rara, text: '日本語 A1'.padEnd(l.text.length, ' ') }, { fuenteEstandar: 'Courier' });
  expect(res).toEqual({ ok: false, reason: 'glyph-missing' });
  expect(Buffer.compare(Buffer.from(eng.save(doc)), Buffer.from(antes))).toBe(0);
  eng.close(doc);
});

test('rechaza un runId que no es texto y un factor fuera de rango sin tocar nada', async () => {
  const { eng, doc } = await abrir();
  const l = linea(eng, doc, 'Celda A1');
  const antes = eng.save(doc);
  expect(eng.setLineProps(doc, 0, { ...l, runIds: [99999], tramos: [{ runId: 99999, inicio: 0, fin: 1 }] }, { color: [1, 2, 3] })).toEqual({ ok: false, reason: 'not-a-text-run' });
  expect(eng.setLineProps(doc, 0, l, { escala: 0 })).toEqual({ ok: false, reason: 'invalid-size' });
  expect(eng.setLineProps(doc, 0, l, { escala: Number.NaN })).toEqual({ ok: false, reason: 'invalid-size' });
  expect(Buffer.compare(Buffer.from(eng.save(doc)), Buffer.from(antes))).toBe(0);
  eng.close(doc);
});

test('texto girado: el factor de tamaño escala a lo largo de su eje (vertical)', async () => {
  const { eng, doc } = await abrir();
  const l = linea(eng, doc, 'Texto girado');
  const antes = runsDe(eng, doc, l);
  const res = eng.setLineProps(doc, 0, l, { escala: 1.5 });
  expect(res).toMatchObject({ ok: true });
  const despues = runsDe(eng, doc, l);
  const y0 = antes[0]!.originPt.yPt;
  despues.forEach((r, i) => expect(r.originPt.yPt - y0).toBeCloseTo((antes[i]!.originPt.yPt - y0) * 1.5, 2));
  despues.forEach((r, i) => expect(r.sizeEfectivoPt).toBeCloseTo(antes[i]!.sizeEfectivoPt * 1.5, 2));
  eng.close(doc);
});
