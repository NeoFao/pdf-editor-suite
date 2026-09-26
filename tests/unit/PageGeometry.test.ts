import { test, expect } from 'vitest';
import { PageGeometry } from '../../src/coords/PageGeometry';

const g0 = new PageGeometry(200, 100, 2, 0); // 200x100 pt, escala 2

test('sin rotación: origen PDF abajo-izq → CSS arriba-izq (Y invertida)', () => {
  expect(g0.ptToCss(0, 100)).toEqual({ x: 0, y: 0 });     // arriba-izq
  expect(g0.ptToCss(0, 0)).toEqual({ x: 0, y: 200 });     // abajo-izq
  expect(g0.ptToCss(200, 100)).toEqual({ x: 400, y: 0 }); // arriba-der
});

test('sin rotación: ida y vuelta es identidad', () => {
  const c = g0.ptToCss(37, 88);
  const p = g0.cssToPt(c.x, c.y);
  expect(p.xPt).toBeCloseTo(37, 5);
  expect(p.yPt).toBeCloseTo(88, 5);
});

test('rectPtToCss coloca la caja con Y arriba', () => {
  const r = g0.rectPtToCss({ xPt: 10, yPt: 20, wPt: 30, hPt: 40 });
  expect(r).toEqual({ left: 20, top: (100 - 60) * 2, width: 60, height: 80 });
});

test('rotación 90 CW: (0,0)→(0,0); (0,100)→arriba-der (ancho display = H*s)', () => {
  const g90 = new PageGeometry(200, 100, 2, 90);
  expect(g90.ptToCss(0, 0)).toEqual({ x: 0, y: 0 });
  expect(g90.ptToCss(0, 100)).toEqual({ x: 200, y: 0 });
  // ida y vuelta también bajo rotación
  const c = g90.ptToCss(50, 30); const p = g90.cssToPt(c.x, c.y);
  expect(p.xPt).toBeCloseTo(50, 5); expect(p.yPt).toBeCloseTo(30, 5);
});
