import { test, expect } from 'vitest';
import { PageGeometry } from '../../src/coords/PageGeometry';

const g0 = PageGeometry.desdeTamanoVisual(200, 100, 2, 0); // 200x100 pt, escala 2

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


// Página de usuario 200x100 pt (sin girar). Con 90/270 la vista es 100x200 pt:
// el motor devuelve ese tamaño VISUAL y la fábrica lo convierte (E-053).
test('rotación 90 CW: (0,0)→(0,0); (0,100)→arriba-der (ancho visual = 100 pt × 2)', () => {
  const g90 = PageGeometry.desdeTamanoVisual(100, 200, 2, 90); // visual 100x200 pt
  expect(g90.widthPt).toBe(200);
  expect(g90.heightPt).toBe(100);
  expect(g90.ptToCss(0, 0)).toEqual({ x: 0, y: 0 });
  expect(g90.ptToCss(0, 100)).toEqual({ x: 200, y: 0 });
  const c = g90.ptToCss(50, 30); const p = g90.cssToPt(c.x, c.y);
  expect(p.xPt).toBeCloseTo(50, 5); expect(p.yPt).toBeCloseTo(30, 5);
});

test('rotación 270: la esquina de usuario (W,H) cae arriba-izq visual y todo queda dentro del lienzo', () => {
  const g270 = PageGeometry.desdeTamanoVisual(100, 200, 2, 270); // visual 100x200 pt -> lienzo 200x400 px CSS
  expect(g270.ptToCss(200, 100)).toEqual({ x: 0, y: 0 });
  expect(g270.ptToCss(0, 0)).toEqual({ x: 200, y: 400 });
  const c = g270.ptToCss(50, 30); const p = g270.cssToPt(c.x, c.y);
  expect(p.xPt).toBeCloseTo(50, 5); expect(p.yPt).toBeCloseTo(30, 5);
  for (const [x, y] of [[0, 0], [200, 0], [0, 100], [200, 100]] as const) {
    const q = g270.ptToCss(x, y);
    expect(q.x).toBeGreaterThanOrEqual(0); expect(q.x).toBeLessThanOrEqual(200);
    expect(q.y).toBeGreaterThanOrEqual(0); expect(q.y).toBeLessThanOrEqual(400);
  }
});

test('rotación 180: el tamaño visual es el de usuario', () => {
  const g = PageGeometry.desdeTamanoVisual(200, 100, 2, 180);
  expect(g.ptToCss(200, 0)).toEqual({ x: 0, y: 0 });
  expect(g.ptToCss(0, 100)).toEqual({ x: 400, y: 200 });
});
