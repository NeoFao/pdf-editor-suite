import { test, expect } from 'vitest';
import { distanciaPuntoSegmento, pathMasCercano, normalizeRect } from '../../src/ui/toolGeometry';

test('distanciaPuntoSegmento: punto sobre el propio segmento da 0', () => {
  const seg = { ax: 0, ay: 0, bx: 10, by: 0 };
  expect(distanciaPuntoSegmento(5, 0, seg)).toBeCloseTo(0, 5);
  expect(distanciaPuntoSegmento(0, 0, seg)).toBeCloseTo(0, 5); // extremo A
  expect(distanciaPuntoSegmento(10, 0, seg)).toBeCloseTo(0, 5); // extremo B
});

test('distanciaPuntoSegmento: distancia perpendicular al segmento', () => {
  const seg = { ax: 0, ay: 0, bx: 10, by: 0 };
  expect(distanciaPuntoSegmento(5, 3, seg)).toBeCloseTo(3, 5);
  expect(distanciaPuntoSegmento(5, -4, seg)).toBeCloseTo(4, 5);
});

test('distanciaPuntoSegmento: punto más allá del extremo usa la distancia al extremo (clamp), no la recta infinita', () => {
  const seg = { ax: 0, ay: 0, bx: 10, by: 0 };
  expect(distanciaPuntoSegmento(15, 0, seg)).toBeCloseTo(5, 5); // pasado B
  expect(distanciaPuntoSegmento(-3, 4, seg)).toBeCloseTo(5, 5); // pasado A, en diagonal
});

test('distanciaPuntoSegmento: segmento degenerado (un punto) es la distancia al punto', () => {
  const seg = { ax: 2, ay: 2, bx: 2, by: 2 };
  expect(distanciaPuntoSegmento(2, 6, seg)).toBeCloseTo(4, 5);
});

test('pathMasCercano: elige el path cuyo segmento más cercano cae dentro del umbral', () => {
  const rectoA = { objIndex: 1, segments: [{ ax: 0, ay: 0, bx: 10, by: 0 }] };
  const rectoB = { objIndex: 2, segments: [{ ax: 0, ay: 100, bx: 10, by: 100 }] };
  expect(pathMasCercano(5, 1, [rectoA, rectoB], 3)).toBe(1);
  expect(pathMasCercano(5, 99, [rectoA, rectoB], 3)).toBe(2);
});

test('pathMasCercano: nada dentro del umbral devuelve null', () => {
  const recto = { objIndex: 1, segments: [{ ax: 0, ay: 0, bx: 10, by: 0 }] };
  expect(pathMasCercano(5, 50, [recto], 3)).toBeNull();
});

test('pathMasCercano: descarta el interior de un rectángulo grande (solo las aristas cuentan)', () => {
  // Rectángulo 0,0 a 200,150 pt como 4 aristas (contorno), no relleno.
  const aristas = [
    { ax: 0, ay: 0, bx: 200, by: 0 },
    { ax: 200, ay: 0, bx: 200, by: 150 },
    { ax: 200, ay: 150, bx: 0, by: 150 },
    { ax: 0, ay: 150, bx: 0, by: 0 }
  ];
  const rect = { objIndex: 7, segments: aristas };
  // Clic bien dentro del hueco interior: lejos de las 4 aristas.
  expect(pathMasCercano(100, 75, [rect], 6)).toBeNull();
  // Clic sobre el borde superior: sí lo encuentra.
  expect(pathMasCercano(100, 0, [rect], 6)).toBe(7);
});

test('normalizeRect: arrastrar en cualquier dirección da el mismo rectángulo normalizado', () => {
  const esperado = { xPt: 10, yPt: 20, wPt: 30, hPt: 40 };
  expect(normalizeRect(10, 20, 40, 60)).toEqual(esperado);   // abajo-izq → arriba-der
  expect(normalizeRect(40, 60, 10, 20)).toEqual(esperado);   // arriba-der → abajo-izq
  expect(normalizeRect(10, 60, 40, 20)).toEqual(esperado);   // arriba-izq → abajo-der
  expect(normalizeRect(40, 20, 10, 60)).toEqual(esperado);   // abajo-der → arriba-izq
});
