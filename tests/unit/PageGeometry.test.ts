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

// E-063: la capa de texto se dibuja sin girar y UNA matriz CSS la lleva al espacio visual. La matriz debe
// coincidir con `ptToCss` para cualquier punto: (u,v) de la capa sin girar -> (x,y) visual.
for (const rot of [90, 180, 270] as const) {
  test(`E-063 rotación ${rot}: transformCapaSinGirar coincide con ptToCss en cada esquina y el centro`, () => {
    const vis = rot === 180 ? [200, 100] as const : [100, 200] as const; // tamaño visual pt
    const g = PageGeometry.desdeTamanoVisual(vis[0], vis[1], 2, rot);
    const plana = g.sinGirar();
    const m = /matrix\(([^)]*)\)/.exec(g.transformCapaSinGirar()!)![1]!.split(',').map(Number) as [number, number, number, number, number, number];
    for (const [xPt, yPt] of [[0, 0], [200, 100], [30, 70], [100, 50]] as const) {
      const uv = plana.ptToCss(xPt, yPt);        // px CSS en la capa sin girar
      const esperado = g.ptToCss(xPt, yPt);      // px CSS visuales
      expect(m[0] * uv.x + m[2] * uv.y + m[4]).toBeCloseTo(esperado.x, 6);
      expect(m[1] * uv.x + m[3] * uv.y + m[5]).toBeCloseTo(esperado.y, 6);
    }
  });

  test(`E-063 rotación ${rot}: deltaVisualACapaSinGirar es la inversa lineal de la matriz`, () => {
    const vis = rot === 180 ? [200, 100] as const : [100, 200] as const;
    const g = PageGeometry.desdeTamanoVisual(vis[0], vis[1], 2, rot);
    const m = /matrix\(([^)]*)\)/.exec(g.transformCapaSinGirar()!)![1]!.split(',').map(Number) as [number, number, number, number, number, number];
    const d = g.deltaVisualACapaSinGirar(10, 4); // arrastre visual de (10,4) px CSS
    expect(m[0] * d.dx + m[2] * d.dy).toBeCloseTo(10, 6);
    expect(m[1] * d.dx + m[3] * d.dy).toBeCloseTo(4, 6);
  });
}

test('E-063: sin rotación no hay transformación y el tamaño de la capa es el de la página', () => {
  expect(g0.transformCapaSinGirar()).toBeNull();
  expect(g0.tamanoCapaSinGirarCss()).toEqual({ width: 400, height: 200 });
  expect(g0.deltaVisualACapaSinGirar(7, 3)).toEqual({ dx: 7, dy: 3 });
});

// E-084: la caja visible puede empezar en (ox, oy) ≠ (0,0) del espacio de usuario (CropBox/MediaBox desplazados).
// Caja de 200x100 pt con origen (36, 20) pt de usuario; escala 2.
const ORIGEN = { xPt: 36, yPt: 20 };
test('E-084 sin rotación: la esquina inferior-izq de la caja visible es el (0, alto) CSS y la superior-der el (ancho, 0)', () => {
  const g = PageGeometry.desdeTamanoVisual(200, 100, 2, 0, ORIGEN);
  expect(g.ptToCss(36, 20)).toEqual({ x: 0, y: 200 });      // inferior-izq de la caja (pt de usuario 36,20)
  expect(g.ptToCss(236, 120)).toEqual({ x: 400, y: 0 });    // superior-der (pt de usuario 236,120)
  expect(g.ptToCss(0, 0).x).toBe(-72);                      // el (0,0) de usuario queda FUERA de la caja visible
});
for (const rot of [0, 90, 180, 270] as const) {
  test(`E-084 rotación ${rot}: ida y vuelta con origen desplazado es identidad y desplazar la caja desplaza el punto`, () => {
    const vis = rot === 90 || rot === 270 ? [100, 200] as const : [200, 100] as const; // tamaño visual pt
    const g = PageGeometry.desdeTamanoVisual(vis[0], vis[1], 2, rot, ORIGEN);
    const g0 = PageGeometry.desdeTamanoVisual(vis[0], vis[1], 2, rot);
    for (const [x, y] of [[40, 30], [100, 60], [230, 110]] as const) { // pt de usuario
      const c = g.ptToCss(x, y);
      const p = g.cssToPt(c.x, c.y);
      expect(p.xPt).toBeCloseTo(x, 6);
      expect(p.yPt).toBeCloseTo(y, 6);
      // Un punto con origen = el mismo punto relativo a la caja sin origen.
      const c0 = g0.ptToCss(x - ORIGEN.xPt, y - ORIGEN.yPt);
      expect(c.x).toBeCloseTo(c0.x, 6);
      expect(c.y).toBeCloseTo(c0.y, 6);
    }
    // sinGirar conserva el origen.
    expect(g.sinGirar().origenPt).toEqual(ORIGEN);
  });
}
