import { test, expect } from 'vitest';
import { paginar, type FlowItem, type PageGeometry, type Seg } from '../../src/convert/flujo/layout';

/**
 * E-105: efectos de carácter del maquetador (tachado, superíndice, fondo). Página de 612x792 con márgenes de 72; una línea de 20 pt de
 * alto cuya base cae al 80 % (`baselineFraction`): borde superior 720, borde inferior 700, línea base 700 + 20 × 0,8 = 716 (pt PDF, Y hacia arriba).
 */
const GEO: PageGeometry = { widthPt: 612, heightPt: 792, marginTopPt: 72, marginBottomPt: 72, marginLeftPt: 72, marginRightPt: 72 };
const BASE = 716;
const seg = (extra: Partial<Seg>): Seg => ({ xPt: 100, text: 'abc', font: 'Helvetica', sizePt: 10, color: [10, 20, 30], wPt: 18, ...extra });
const colocar = (s: Seg) => paginar([{ kind: 'line', height: 20, segs: [s], bars: [] } satisfies FlowItem], GEO, 0.8);

test('tachado simple: una barra de grosor max(0,6; 5 % del tamaño) centrada a 0,26 × tamaño sobre la línea base, del color del texto', () => {
  const r = colocar(seg({ strike: 1 }));
  const t = Math.max(0.6, 10 * 0.05);
  expect(r.barras).toHaveLength(1);
  const b = r.barras[0]!;
  expect(b.xPt).toBe(100); expect(b.wPt).toBe(18); expect(b.color).toEqual([10, 20, 30]);
  expect(b.hPt).toBeCloseTo(t, 6);
  expect(b.yPt + b.hPt / 2).toBeCloseTo(BASE + 0.26 * 10, 6);
});

test('tachado doble: dos barras a ± grosor del centro (separadas por un hueco igual al grosor)', () => {
  const r = colocar(seg({ sizePt: 20, strike: 2 }));
  const t = Math.max(0.6, 20 * 0.05), mid = BASE + 0.26 * 20;
  const centros = r.barras.map((b) => b.yPt + b.hPt / 2).sort((a, b) => a - b);
  expect(centros).toHaveLength(2);
  expect(centros[0]).toBeCloseTo(mid - t, 6);
  expect(centros[1]).toBeCloseTo(mid + t, 6);
});

test('desplazamiento de línea base (dyPt): el trazo, el tachado y el subrayado suben con él', () => {
  const r = colocar(seg({ dyPt: 3.3, strike: 1, underline: true }));
  expect(r.trazos[0]!.yPt).toBeCloseTo(BASE + 3.3, 6);
  const centros = r.barras.map((b) => b.yPt + b.hPt / 2).sort((a, b) => a - b);
  expect(centros).toHaveLength(2);
  expect(centros[1]).toBeCloseTo(BASE + 3.3 + 2.6, 6); // tachado
});

test('fondo (resaltado/sombreado): rectángulo del ancho del trazo, de 1,12 × tamaño de alto, desde 0,21 × tamaño bajo la base', () => {
  const r = colocar(seg({ fondo: [255, 255, 0] }));
  expect(r.barras).toHaveLength(1);
  const b = r.barras[0]!;
  expect(b).toMatchObject({ xPt: 100, wPt: 18, color: [255, 255, 0] });
  expect(b.yPt).toBeCloseTo(BASE - 0.21 * 10, 6);
  expect(b.hPt).toBeCloseTo(1.12 * 10, 6);
});

test('sin efectos no se dibuja ninguna barra', () => {
  expect(colocar(seg({})).barras).toEqual([]);
});
