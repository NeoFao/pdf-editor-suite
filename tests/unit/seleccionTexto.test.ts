import { test, expect } from 'vitest';
import { PageGeometry } from '../../src/coords/PageGeometry';
import { indiceCaracterMasCercano, quadsDeRango, textoDeRango } from '../../src/texto/seleccionTexto';
import type { CharBox } from '../../src/engine/PdfEngine';

/** Una línea de `texto` con caracteres de 10 pt de ancho y 12 de alto, desde (x0, y0 base) en pt PDF. */
function linea(texto: string, x0: number, y0: number): CharBox[] {
  return [...texto].map((ch, i) => ({ ch, boxPt: { xPt: x0 + i * 10, yPt: y0, wPt: 10, hPt: 12 } }));
}
const sinCaja = (ch: string): CharBox => ({ ch, boxPt: { xPt: 0, yPt: 0, wPt: 0, hPt: 0 } });

// Tres líneas: "ABC" (y 180), "DEF" (y 150), "GHI" (y 120), con \r\n sin caja entre ellas.
const chars: CharBox[] = [
  ...linea('ABC', 40, 180), sinCaja('\r'), sinCaja('\n'),
  ...linea('DEF', 40, 150), sinCaja('\r'), sinCaja('\n'),
  ...linea('GHI', 40, 120)
];
const g0 = PageGeometry.desdeTamanoVisual(300, 200, 1, 0);

test('índice de carácter más cercano: dentro de una caja', () => {
  expect(indiceCaracterMasCercano(chars, 45, 185)).toBe(0); // A
  expect(indiceCaracterMasCercano(chars, 65, 155)).toBe(7); // F
});

test('índice de carácter más cercano: fuera de la línea elige el extremo de esa línea y salta los \r\n', () => {
  expect(indiceCaracterMasCercano(chars, 200, 185)).toBe(2); // a la derecha de "ABC" -> C
  expect(indiceCaracterMasCercano(chars, 0, 155)).toBe(5);   // a la izquierda de "DEF" -> D
  expect(indiceCaracterMasCercano(chars, 45, 100)).toBe(10); // debajo de "GHI" -> G
});

test('índice de carácter más cercano: sin caracteres con caja devuelve -1', () => {
  expect(indiceCaracterMasCercano([], 1, 1)).toBe(-1);
  expect(indiceCaracterMasCercano([sinCaja('\n')], 1, 1)).toBe(-1);
});

test('quads de un rango de una sola línea: recortados al tramo', () => {
  const q = quadsDeRango(chars, 1, 2, g0); // "BC"
  expect(q).toHaveLength(1);
  expect(q[0]![0]).toBeCloseTo(50); // x sup-izq: empieza en B
  expect(q[0]![2]).toBeCloseTo(70); // x sup-der: acaba en C
});

test('quads de un rango multilínea: uno por línea, primero y último recortados', () => {
  // desde la "B" de ABC hasta la "H" de GHI
  const q = quadsDeRango(chars, 1, 11, g0);
  expect(q).toHaveLength(3);
  expect(q[0]![0]).toBeCloseTo(50); expect(q[0]![2]).toBeCloseTo(70);  // "BC"
  expect(q[1]![0]).toBeCloseTo(40); expect(q[1]![2]).toBeCloseTo(70);  // "DEF" entera
  expect(q[2]![0]).toBeCloseTo(40); expect(q[2]![2]).toBeCloseTo(60);  // "GH"
  expect(q[0]![1]).toBeGreaterThan(q[1]![1]); // de arriba abajo
});

test('la altura del quad es la de la LÍNEA, no la del glifo: marcar solo una "a" baja cubre toda la línea', () => {
  // Misma línea: "l" alta (12 pt), "a" baja (7 pt, apoyada en la misma base) y "." diminuto.
  const cs: CharBox[] = [
    { ch: 'l', boxPt: { xPt: 40, yPt: 100, wPt: 5, hPt: 12 } },
    { ch: 'a', boxPt: { xPt: 46, yPt: 100, wPt: 8, hPt: 7 } },
    { ch: '.', boxPt: { xPt: 55, yPt: 100, wPt: 3, hPt: 2 } }
  ];
  const q = quadsDeRango(cs, 1, 1, g0);
  expect(q).toHaveLength(1);
  expect(q[0]![1] - q[0]![5]).toBeCloseTo(12); // alto de la línea (la "l")
  expect(q[0]![0]).toBeCloseTo(46); expect(q[0]![2]).toBeCloseTo(54); // horizontal: solo la "a"
});

test('el rango se normaliza si el foco precede al ancla', () => {
  expect(quadsDeRango(chars, 11, 1, g0)).toEqual(quadsDeRango(chars, 1, 11, g0));
});

test('con /Rotate 270 una línea visual sigue siendo UNA línea y recorta al tramo', () => {
  const g = PageGeometry.desdeTamanoVisual(842, 595, 1, 270); // visual 842x595; usuario 595x842
  // Texto visualmente horizontal: en espacio de usuario avanza hacia -Y... usamos la propia geometría
  // para construir las cajas: 6 caracteres de 10x12 pt visuales desde (100, 100) css.
  const cs: CharBox[] = [...'ABCDEF'].map((ch, i) => {
    const a = g.cssToPt(100 + i * 10, 100), b = g.cssToPt(110 + i * 10, 112);
    return { ch, boxPt: { xPt: Math.min(a.xPt, b.xPt), yPt: Math.min(a.yPt, b.yPt), wPt: Math.abs(b.xPt - a.xPt), hPt: Math.abs(b.yPt - a.yPt) } };
  });
  const q = quadsDeRango(cs, 1, 3, g); // "BCD"
  expect(q).toHaveLength(1);
  // Las esquinas, vistas en CSS, cubren x 110..140 e y 100..112.
  const pts = [0, 2, 4, 6].map((k) => g.ptToCss(q[0]![k]!, q[0]![k + 1]!));
  expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(110);
  expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(140);
  expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(100);
  expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(112);
});

test('texto de un rango: incluye los saltos de línea normalizados a \n', () => {
  expect(textoDeRango(chars, 1, 11)).toBe('BC\nDEF\nGH');
  expect(textoDeRango(chars, 11, 1)).toBe('BC\nDEF\nGH');
  expect(textoDeRango(chars, 0, 0)).toBe('A');
});
