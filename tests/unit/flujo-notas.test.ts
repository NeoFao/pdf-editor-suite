import { test, expect } from 'vitest';
import { paginar, type FlowItem, type FlowLine, type NotaFlujo, type PageGeometry, type Seg } from '../../src/convert/flujo/layout';

/**
 * E-109: notas al pie en el maquetador. Página de 200x200 pt con márgenes de 20: área de texto 160 pt (y = 180 arriba, y = 20 abajo,
 * pt PDF con Y hacia arriba). Cada línea mide 10 pt y su base cae al 80 %. El separador de nota mide 12 pt (regla de 144 pt de ancho,
 * 1 pt de grosor, a media altura) y cada línea de nota 10 pt.
 */
const GEO: PageGeometry = { widthPt: 200, heightPt: 200, marginTopPt: 20, marginBottomPt: 20, marginLeftPt: 20, marginRightPt: 20 };
const BASE = 0.8;
const seg = (text: string, extra: Partial<Seg> = {}): Seg => ({ xPt: 20, text, font: 'Helvetica', sizePt: 10, color: [0, 0, 0], wPt: 30, ...extra });
const linea = (text: string, nota?: number): FlowLine => ({ kind: 'line', height: 10, segs: [seg(text, nota === undefined ? {} : { nota })], bars: [] });
const nota = (...textos: string[]): NotaFlujo => ({ items: textos.map((t) => linea(t)), altoPt: textos.length * 10 });
const relleno = (n: number, prefijo = 'L'): FlowItem[] => Array.from({ length: n }, (_, i) => linea(`${prefijo}${i + 1}`));
const SEP = { altoPt: 12, anchoPt: 144 };

test('reserva el espacio de la nota: la página admite 16 líneas sin nota y 12 con una nota de 2 líneas (12 + 20 pt reservados)', () => {
  const sin = paginar(relleno(30), GEO, BASE);
  expect(sin.trazos.filter((t) => t.page === 0 && t.text.startsWith('L'))).toHaveLength(16);

  const items = [linea('L0', 0), ...relleno(30)];
  const con = paginar(items, GEO, BASE, undefined, new Map([[0, nota('N1', 'N2')]]));
  // (160 - 32) / 10 = 12,8 -> 12 líneas de cuerpo en la página 0 (la de la referencia incluida)
  expect(con.trazos.filter((t) => t.page === 0 && /^L/.test(t.text))).toHaveLength(12);
});

test('el texto de la nota queda en la MISMA página, por debajo del último renglón del cuerpo y por encima del margen inferior', () => {
  const r = paginar([linea('L0', 0), ...relleno(5)], GEO, BASE, undefined, new Map([[0, nota('N1', 'N2')]]));
  expect(r.totalPaginas).toBe(1);
  const cuerpo = r.trazos.filter((t) => /^L/.test(t.text));
  const notas = r.trazos.filter((t) => /^N/.test(t.text));
  expect(notas).toHaveLength(2);
  const ultimoCuerpo = Math.min(...cuerpo.map((t) => t.yPt));
  for (const n of notas) { expect(n.page).toBe(0); expect(n.yPt).toBeLessThan(ultimoCuerpo); expect(n.yPt).toBeGreaterThanOrEqual(20); }
  // Las líneas de nota apilan desde el margen inferior: la última con su base a 20 + 10 x 0,8 y la primera 10 pt más arriba.
  expect(notas.find((t) => t.text === 'N2')!.yPt).toBeCloseTo(28, 6);
  expect(notas.find((t) => t.text === 'N1')!.yPt).toBeCloseTo(38, 6);
});

test('separador: una regla corta (144 pt, 1 pt de grosor) justo encima de la primera nota, a la izquierda del margen', () => {
  const r = paginar([linea('L0', 0), ...relleno(3)], GEO, BASE, undefined, new Map([[0, nota('N1', 'N2')]]));
  const reglas = r.barras.filter((b) => b.wPt === SEP.anchoPt);
  expect(reglas).toHaveLength(1);
  const g = reglas[0]!;
  // Zona de notas: 32 pt desde y = 20 -> el separador ocupa [40, 52]; la regla va a media altura.
  expect(g.page).toBe(0); expect(g.xPt).toBe(20); expect(g.hPt).toBe(1);
  expect(g.yPt).toBeCloseTo(40 + (SEP.altoPt - 1) / 2, 6);
});

test('una línea con referencia que no cabe junto a su nota pasa a la página siguiente (con su nota)', () => {
  // 14 líneas dejan el cursor en y = 40. La línea de la referencia sola cabría (40 - 10 >= 20), con 12 + 20 pt de nota no.
  const items = [...relleno(14), linea('REF', 0), ...relleno(2, 'Z')];
  const r = paginar(items, GEO, BASE, undefined, new Map([[0, nota('N1', 'N2')]]));
  expect(r.totalPaginas).toBe(2);
  expect(r.trazos.find((t) => t.text === 'REF')!.page).toBe(1);
  expect(r.trazos.filter((t) => /^N/.test(t.text)).every((t) => t.page === 1)).toBe(true);
  expect(r.barras.filter((b) => b.wPt === SEP.anchoPt).map((b) => b.page)).toEqual([1]); // ni separador ni nota en la página 0

  // Sin nota (mapa vacío) esa misma línea se queda en la página 0: el empuje se debe a la nota.
  const sinNota = paginar(items, GEO, BASE);
  expect(sinNota.trazos.find((t) => t.text === 'REF')!.page).toBe(0);
});

test('dos notas de la misma página comparten un solo separador y se apilan en el orden de sus referencias', () => {
  const r = paginar([linea('A', 0), linea('B', 1), ...relleno(2)], GEO, BASE, undefined, new Map([[0, nota('N1')], [1, nota('M1')]]));
  expect(r.barras.filter((b) => b.wPt === SEP.anchoPt)).toHaveLength(1);
  const y = (t: string): number => r.trazos.find((x) => x.text === t)!.yPt;
  expect(y('N1')).toBeGreaterThan(y('M1'));
  expect(y('M1')).toBeCloseTo(28, 6); // última nota pegada al margen inferior
});

test('una nota más alta que la página no se pierde: continúa en la página siguiente tras un separador de continuación a todo el ancho', () => {
  const larga = nota(...Array.from({ length: 30 }, (_, i) => `N${i + 1}`));
  const r = paginar([linea('R', 0), ...relleno(2)], GEO, BASE, undefined, new Map([[0, larga]]));
  const lineasNota = r.trazos.filter((t) => /^N\d+$/.test(t.text));
  expect(lineasNota).toHaveLength(30);
  expect(r.totalPaginas).toBeGreaterThanOrEqual(2);
  for (const t of r.trazos) { expect(t.yPt).toBeGreaterThanOrEqual(20); expect(t.yPt).toBeLessThanOrEqual(180); }
  // La referencia queda en la página 0, con su nota que empieza ahí y sigue en la 1.
  expect(r.trazos.find((t) => t.text === 'R')!.page).toBe(0);
  expect(lineasNota.some((t) => t.page === 0)).toBe(true);
  expect(lineasNota.some((t) => t.page === 1)).toBe(true);
  // El orden de lectura se conserva: N1 antes de N30 (página menor, o la misma página y más arriba).
  const orden = (t: { page: number; yPt: number }): number => t.page * 1000 - t.yPt;
  const ord = lineasNota.sort((a, b) => Number(a.text.slice(1)) - Number(b.text.slice(1)));
  for (let i = 1; i < ord.length; i++) expect(orden(ord[i]!)).toBeGreaterThan(orden(ord[i - 1]!));
  // Separador de continuación: regla a todo el ancho del texto (160 pt) en la página 1.
  expect(r.barras.some((b) => b.page === 1 && b.wPt === 160 && b.hPt === 1)).toBe(true);
});

test('sin mapa de notas la referencia no reserva nada (comportamiento de siempre)', () => {
  const r = paginar([linea('L0', 0), ...relleno(30)], GEO, BASE);
  expect(r.trazos.filter((t) => t.page === 0 && /^L/.test(t.text))).toHaveLength(16);
  expect(r.barras).toHaveLength(0);
});
