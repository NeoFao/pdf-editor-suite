import { test, expect } from 'vitest';
import { PageGeometry } from '../../src/coords/PageGeometry';
import { quadsPorLinea, rectToQuad } from '../../src/coords/quads';

const g0 = PageGeometry.desdeTamanoVisual(300, 200, 1, 0);

test('rectToQuad: sup-izq, sup-der, inf-izq, inf-der en pt PDF', () => {
  expect(rectToQuad({ xPt: 10, yPt: 20, wPt: 30, hPt: 5 })).toEqual([10, 25, 40, 25, 10, 20, 40, 20]);
});

test('una caja de una línea da un quad', () => {
  const q = quadsPorLinea([{ boxPt: { xPt: 40, yPt: 146, wPt: 120, hPt: 24 }, sizePt: 20 }], g0);
  expect(q).toEqual([rectToQuad({ xPt: 40, yPt: 146, wPt: 120, hPt: 24 })]);
});

test('varios runs de la misma línea se funden en un solo quad', () => {
  const q = quadsPorLinea([
    { boxPt: { xPt: 40, yPt: 146, wPt: 50, hPt: 20 }, sizePt: 18 },
    { boxPt: { xPt: 100, yPt: 148, wPt: 60, hPt: 20 }, sizePt: 18 }
  ], g0);
  expect(q).toHaveLength(1);
  expect(q[0]![0]).toBeCloseTo(40); // x sup-izq
  expect(q[0]![2]).toBeCloseTo(160); // x sup-der
});

test('runs en líneas distintas dan un quad por línea, de arriba abajo', () => {
  const q = quadsPorLinea([
    { boxPt: { xPt: 40, yPt: 100, wPt: 80, hPt: 14 }, sizePt: 12 },
    { boxPt: { xPt: 40, yPt: 140, wPt: 120, hPt: 14 }, sizePt: 12 }
  ], g0);
  expect(q).toHaveLength(2);
  expect(q[0]![1]).toBeGreaterThan(q[1]![1]); // la primera es la de más arriba (y PDF mayor)
});

test('un run multilínea (caja alta) se parte en una banda por línea', () => {
  // 3 líneas de cuerpo 10 → alto ≈ 36.
  const q = quadsPorLinea([{ boxPt: { xPt: 20, yPt: 100, wPt: 150, hPt: 36 }, sizePt: 10 }], g0);
  expect(q).toHaveLength(3);
  for (const quad of q) expect(quad[1] - quad[5]).toBeCloseTo(12, 5); // alto de cada banda
});

test('con /Rotate 270 el texto girado (caja alta en usuario) sigue siendo UNA línea visual', () => {
  const g = PageGeometry.desdeTamanoVisual(842, 595, 1, 270); // visual 842×595; usuario 595×842
  // Texto visualmente horizontal: en usuario es alto y estrecho.
  const caja = { xPt: 500, yPt: 600, wPt: 24, hPt: 180 };
  const q = quadsPorLinea([{ boxPt: caja, sizePt: 24 }], g);
  expect(q).toHaveLength(1);
  // Las 4 esquinas cubren exactamente la caja en usuario.
  const xs = [q[0]![0], q[0]![2], q[0]![4], q[0]![6]];
  const ys = [q[0]![1], q[0]![3], q[0]![5], q[0]![7]];
  expect(Math.min(...xs)).toBeCloseTo(500, 3); expect(Math.max(...xs)).toBeCloseTo(524, 3);
  expect(Math.min(...ys)).toBeCloseTo(600, 3); expect(Math.max(...ys)).toBeCloseTo(780, 3);
});
