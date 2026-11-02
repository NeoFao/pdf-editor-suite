import { test, expect } from 'vitest';
import { paginar, parrafoFlex, type Atom, type ColumnasFlujo, type FlowItem, type FlowLine, type FlowSectionStart, type FlowTableRow, type NotaFlujo, type PageGeometry, type Seg, type Medir } from '../../src/convert/flujo/layout';

/**
 * E-118: columnas de sección de Word en el maquetador. Página de 200 x 200 pt con márgenes de 20: área de texto 160 x 160
 * (el borde superior en y = 180 y el inferior en y = 20, pt PDF con Y hacia arriba). Cada línea mide 10 pt: caben 16 por columna.
 * La base de cada línea cae al 80 % de su alto (`BASE`), es decir 2 pt sobre su borde inferior.
 */
const GEO: PageGeometry = { widthPt: 200, heightPt: 200, marginTopPt: 20, marginBottomPt: 20, marginLeftPt: 20, marginRightPt: 20 };
const BASE = 0.8;
const medir: Medir = (_f, _s, t) => t.length * 5;
const seg = (text: string, xPt = 20): Seg => ({ xPt, text, font: 'Helvetica', sizePt: 10, color: [0, 0, 0], wPt: text.length * 5 });
const linea = (text: string, extra: Partial<Seg> = {}): FlowLine => ({ kind: 'line', height: 10, segs: [{ ...seg(text), ...extra }], bars: [] });
const lineas = (n: number, prefijo = 'L'): FlowItem[] => Array.from({ length: n }, (_, i) => linea(`${prefijo}${i + 1}`));
const seccion = (columnas: ColumnasFlujo | undefined, continua = false, n = 0): FlowSectionStart => ({ kind: 'section', geo: GEO, continua, seccion: n, ...(columnas ? { columnas } : {}) });
/** Dos columnas iguales de 75 pt separadas 10 pt: la 2.ª empieza en x = 20 + 85 = 105. */
const DOS: ColumnasFlujo = { anchosPt: [75, 75], espaciosPt: [10], separador: false };
const y = (n: number) => 180 - 10 * n + 8; // línea base de la línea n-ésima (1-based) desde el borde superior de la columna
const texto = (r: ReturnType<typeof paginar>, prefijo: string) => r.trazos.filter((t) => t.text.startsWith(prefijo));

/** Palabras de 4 letras (20 pt) separadas por espacios de 5 pt, como un párrafo `flex` de la anchura de la columna más estrecha. */
function parrafo(palabras: number, anchoBasePt: number, prefijo = 'aa'): FlowItem {
  const atoms: Atom[] = Array.from({ length: palabras }, (_, i) => ({ text: `${prefijo}${String(i + 1).padStart(2, '0')}`, font: 'Helvetica', sizePt: 10, color: [0, 0, 0] }));
  return parrafoFlex({ atoms, xNormalPt: 20, xPrimeraPt: 20, wPt: anchoBasePt, align: 'left', alturaLinea: () => 10, tabs: null, medir });
}

test('dos columnas iguales: la 1 se llena de arriba abajo, el resto va a la 2 (x = 105) y, agotada la 2, a la página siguiente', () => {
  const r = paginar([seccion(DOS), ...lineas(40)], GEO, BASE);
  expect(r.totalPaginas).toBe(2);
  const t = (n: number) => r.trazos.find((x) => x.text === `L${n}`)!;
  expect([t(1).page, t(1).xPt, t(1).yPt]).toEqual([0, 20, y(1)]);
  expect([t(16).page, t(16).xPt, t(16).yPt]).toEqual([0, 20, y(16)]);
  expect([t(17).page, t(17).xPt, t(17).yPt]).toEqual([0, 105, y(1)]);
  expect([t(32).page, t(32).xPt, t(32).yPt]).toEqual([0, 105, y(16)]);
  expect([t(33).page, t(33).xPt, t(33).yPt]).toEqual([1, 20, y(1)]);
  expect(t(40).page).toBe(1);
  // Orden de lectura: toda la columna 1 antes que la 2.
  expect(Math.max(...r.trazos.filter((x) => x.xPt === 20 && x.page === 0).map((x) => Number(x.text.slice(1))))).toBeLessThan(17);
});

test('tres columnas desiguales (40, 60, 40 con huecos de 10): x de inicio 20, 70 y 140 y los párrafos se ajustan al ancho de CADA columna', () => {
  const cols: ColumnasFlujo = { anchosPt: [40, 60, 40], espaciosPt: [10, 10], separador: false };
  // Palabras de 20 pt: 1 por línea en 40 pt, 2 por línea en 60 pt (20 + 5 + 20 = 45; tres serían 70).
  const r = paginar([seccion(cols), parrafo(60, 40)], GEO, BASE);
  expect(r.totalPaginas).toBe(1);
  // Un trazo = una línea (las palabras de una línea se funden en un solo trazo).
  const porX = (x: number) => r.trazos.filter((t) => t.xPt === x);
  const palabras = (ts: typeof r.trazos) => ts.flatMap((t) => t.text.split(' '));
  expect(porX(20)).toHaveLength(16); // 16 líneas de 1 palabra
  const col2 = r.trazos.filter((t) => t.xPt >= 70 && t.xPt < 140);
  expect(col2).toHaveLength(16); // 16 líneas...
  expect(palabras(col2)).toHaveLength(32); // ...de 2 palabras
  expect(new Set(col2.map((t) => t.yPt)).size).toBe(16);
  expect(col2.every((t) => t.xPt === 70)).toBe(true);
  expect(palabras(porX(140))).toHaveLength(12); // el resto, 1 palabra por línea
  // Lectura: la palabra 17 (la primera de la columna 2) va arriba de la columna 2.
  const p17 = r.trazos.find((t) => t.text.startsWith('aa17'))!;
  expect([p17.xPt, p17.yPt]).toEqual([70, y(1)]);
});

test('salto de columna: lo que sigue empieza arriba de la columna siguiente; en la última columna salta de página', () => {
  const r = paginar([seccion(DOS), ...lineas(3), { kind: 'columnbreak' }, linea('B1'), { kind: 'columnbreak' }, linea('C1')], GEO, BASE);
  const b1 = texto(r, 'B1')[0]!, c1 = texto(r, 'C1')[0]!;
  expect([b1.page, b1.xPt, b1.yPt]).toEqual([0, 105, y(1)]);
  expect([c1.page, c1.xPt, c1.yPt]).toEqual([1, 20, y(1)]);
  expect(r.totalPaginas).toBe(2);
});

test('sección continua 1 -> 2 -> 1 columnas: la de 2 columnas se EQUILIBRA y la siguiente empieza bajo la columna más alta', () => {
  const r = paginar([
    seccion(undefined), ...lineas(4, 'A'),
    seccion(DOS, true, 1), ...lineas(9, 'B'),
    seccion(undefined, true, 2), ...lineas(2, 'C')
  ], GEO, BASE);
  expect(r.totalPaginas).toBe(1);
  // Arriba: 4 líneas de una columna a todo el ancho (x = 20).
  expect(texto(r, 'A').map((t) => t.yPt)).toEqual([y(1), y(2), y(3), y(4)]);
  // La región de 2 columnas empieza bajo ellas (borde superior en 140) y reparte 9 líneas en 5 + 4, no 9 + 0.
  const b = texto(r, 'B');
  const c1 = b.filter((t) => t.xPt === 20), c2 = b.filter((t) => t.xPt === 105);
  expect(c1).toHaveLength(5);
  expect(c2).toHaveLength(4);
  expect(Math.max(...b.map((t) => t.yPt))).toBeCloseTo(140 - 10 + 8, 6);
  // Orden de lectura: B1..B5 en la columna 1, B6..B9 en la 2.
  expect(c1.map((t) => t.text)).toEqual(['B1', 'B2', 'B3', 'B4', 'B5']);
  expect(c2.map((t) => t.text)).toEqual(['B6', 'B7', 'B8', 'B9']);
  // Las alturas de columna difieren como mucho en una línea (10 pt).
  expect(Math.abs(c1.length - c2.length) * 10).toBeLessThanOrEqual(10);
  // La sección final continúa bajo la columna más alta (5 líneas): 140 - 50 = 90.
  expect(texto(r, 'C').map((t) => t.yPt)).toEqual([90 - 10 + 8, 90 - 20 + 8]);
  expect(texto(r, 'C').every((t) => t.xPt === 20)).toBe(true);
});

test('una sección continua de columnas al FINAL del documento también se equilibra; una de página nueva no', () => {
  const continua = paginar([seccion(undefined), ...lineas(2, 'A'), seccion(DOS, true, 1), ...lineas(7, 'B')], GEO, BASE);
  const b = texto(continua, 'B');
  expect([b.filter((t) => t.xPt === 20).length, b.filter((t) => t.xPt === 105).length]).toEqual([4, 3]);
  // La primera sección del documento (nextPage) con 2 columnas: el texto rellena la columna 1 entera antes que la 2.
  const normal = paginar([seccion(DOS), ...lineas(20)], GEO, BASE);
  expect(normal.trazos.filter((t) => t.xPt === 20)).toHaveLength(16);
  expect(normal.trazos.filter((t) => t.xPt === 105)).toHaveLength(4);
});

test('el equilibrado reparte por LÍNEAS: un párrafo de 11 líneas se parte entre las dos columnas, ninguna línea queda cortada', () => {
  const r = paginar([seccion(undefined), linea('A1'), seccion(DOS, true, 1), parrafo(22, 75), seccion(undefined, true, 2), linea('Z1')], GEO, BASE);
  // 22 palabras de 20 pt, 3 por línea en 75 pt (20+5+20+5+20 = 70) => 8 líneas (7 de 3 palabras + 1 de 1): 4 + 4.
  const col1 = r.trazos.filter((t) => t.xPt >= 20 && t.xPt < 105 && t.text.startsWith('aa'));
  const col2 = r.trazos.filter((t) => t.xPt >= 105 && t.text.startsWith('aa'));
  const lin = (ts: typeof col1) => new Set(ts.map((t) => t.yPt)).size;
  expect(lin(col1)).toBe(4);
  expect(lin(col2)).toBe(4);
  // Todas las palabras están, en orden y sin repetir.
  const todas = [...col1, ...col2].flatMap((t) => t.text.split(' '));
  expect(todas).toHaveLength(22);
  expect(new Set(todas).size).toBe(22);
});

test('separador (w:sep): una línea vertical fina centrada en el hueco entre columnas, de la parte alta de la región al final de la columna más alta', () => {
  const r = paginar([seccion({ ...DOS, separador: true }), ...lineas(20)], GEO, BASE);
  const seps = r.barras.filter((b) => b.wPt < 1 && b.hPt > 10);
  expect(seps).toHaveLength(1);
  const s = seps[0]!;
  // Hueco entre x = 95 (fin de la col. 1) y 105 (inicio de la 2.ª): centro 100.
  expect(s.xPt + s.wPt / 2).toBeCloseTo(100, 6);
  expect(s.page).toBe(0);
  expect(s.yPt + s.hPt).toBeCloseTo(180, 6); // arriba de la columna
  expect(s.yPt).toBeCloseTo(20, 6); // la columna 1 llega al margen inferior
  // Sin separador no hay barra fina.
  expect(paginar([seccion(DOS), ...lineas(20)], GEO, BASE).barras.filter((b) => b.wPt < 1)).toHaveLength(0);
});

test('con 3 columnas y separador hay un trazo en cada hueco y uno por página', () => {
  const cols: ColumnasFlujo = { anchosPt: [40, 60, 40], espaciosPt: [10, 10], separador: true };
  const r = paginar([seccion(cols), ...lineas(100)], GEO, BASE);
  const seps = r.barras.filter((b) => b.wPt < 1 && b.hPt > 10);
  expect(r.totalPaginas).toBe(3);
  expect(seps.filter((s) => s.page === 0).map((s) => s.xPt + s.wPt / 2)).toEqual([65, 135]);
  expect(seps.filter((s) => s.page === 1)).toHaveLength(2);
});

test('una tabla dentro de la columna 2 se desplaza a la x de esa columna', () => {
  const fila: FlowTableRow = {
    kind: 'tableRow', height: 14, esEncabezado: false,
    lineas: [{ relYPt: 11, segs: [seg('celda', 25)] }],
    fondos: [{ relYPt: 0, hPt: 14, xPt: 20, wPt: 75, color: [0.9, 0.9, 0.9] }],
    bordes: [{ relYPt: 0, hPt: 0.5, xPt: 20, wPt: 75, color: [0, 0, 0] }]
  };
  const r = paginar([seccion(DOS), ...lineas(16), fila], GEO, BASE);
  const celda = r.trazos.find((t) => t.text === 'celda')!;
  expect(celda.xPt).toBe(25 + 85);
  expect(r.barras.find((b) => b.hPt === 14)!.xPt).toBe(105);
});

test('las notas al pie siguen yendo al pie de la PÁGINA (x = margen izquierdo) aunque la referencia esté en la columna 2', () => {
  const nota: NotaFlujo = { items: [linea('NOTA')], altoPt: 10 };
  const r = paginar([seccion(DOS), ...lineas(16), linea('R', { nota: 0 })], GEO, BASE, undefined, new Map([[0, nota]]));
  const ref = r.trazos.find((t) => t.text === 'R')!;
  const n = r.trazos.find((t) => t.text === 'NOTA')!;
  expect(ref.xPt).toBe(105);
  expect(n.xPt).toBe(20);
  expect(n.yPt).toBeCloseTo(20 + 8, 6); // apilada desde el margen inferior
  expect(n.yPt).toBeLessThan(ref.yPt);
});

test('un solo salto de columna en una sección de UNA columna actúa como un salto de página (como Word)', () => {
  const r = paginar([seccion(undefined), ...lineas(2), { kind: 'columnbreak' }, linea('Z')], GEO, BASE);
  expect(r.totalPaginas).toBe(2);
  expect(texto(r, 'Z')[0]!.page).toBe(1);
});
