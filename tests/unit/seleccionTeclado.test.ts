import { test, expect } from 'vitest';
import { PageGeometry } from '../../src/coords/PageGeometry';
import { ordenLecturaMarcados, type MarcadoHit } from '../../src/coords/quads';
import {
  caretLinea, caretSiguiente, caretsARango, caretInicioDe, rangoACarets, textoDeMarcado, textoDeRango
} from '../../src/texto/seleccionTexto';
import type { CharBox } from '../../src/engine/PdfEngine';

/** Una línea de `texto` con caracteres de 10 pt de ancho y 12 de alto, desde (x0, y0 base) en pt PDF. */
function linea(texto: string, x0: number, y0: number): CharBox[] {
  return [...texto].map((ch, i) => ({ ch, boxPt: { xPt: x0 + i * 10, yPt: y0, wPt: 10, hPt: 12 } }));
}
const sinCaja = (ch: string): CharBox => ({ ch, boxPt: { xPt: 0, yPt: 0, wPt: 0, hPt: 0 } });

// "ABC" (idx 0-2), \r\n (3-4), "DEF" (5-7), \r\n (8-9), "GHI" (10-12). Longitud 13.
const chars: CharBox[] = [
  ...linea('ABC', 40, 180), sinCaja('\r'), sinCaja('\n'),
  ...linea('DEF', 40, 150), sinCaja('\r'), sinCaja('\n'),
  ...linea('GHI', 40, 120)
];
const g0 = PageGeometry.desdeTamanoVisual(300, 200, 1, 0);

test('caret: → avanza de carácter en carácter y salta los \r\n sin caja', () => {
  expect(caretSiguiente(chars, 0, 1)).toBe(1);
  expect(caretSiguiente(chars, 2, 1)).toBe(3);
  expect(caretSiguiente(chars, 3, 1)).toBe(6);  // pasa por \r\n y D: el caret queda tras la D
  expect(caretSiguiente(chars, 13, 1)).toBe(13); // fin del texto: no avanza
});

test('caret: ← retrocede de carácter en carácter y salta los \r\n', () => {
  expect(caretSiguiente(chars, 2, -1)).toBe(1);
  expect(caretSiguiente(chars, 5, -1)).toBe(3);  // antes de la D: salta \r\n y queda justo DESPUÉS de la C
  expect(caretSiguiente(chars, 0, -1)).toBe(0);  // inicio: no retrocede
});

test('rango <-> carets: ancla y foco son posiciones ENTRE caracteres; iguales = selección vacía', () => {
  expect(caretsARango(0, 3)).toEqual({ ancla: 0, foco: 2 });   // ABC
  expect(caretsARango(3, 0)).toEqual({ ancla: 2, foco: 0 });   // hacia atrás: mismos caracteres
  expect(caretsARango(4, 4)).toBeNull();
  expect(rangoACarets({ ancla: 0, foco: 2 })).toEqual({ ancla: 0, foco: 3 });
  expect(rangoACarets({ ancla: 2, foco: 0 })).toEqual({ ancla: 3, foco: 0 }); // ratón hacia atrás
});

test('Mayús+→ cinco veces desde el inicio de una línea selecciona 5 caracteres, y Mayús+← los reduce', () => {
  let foco = 5;                       // inicio de "DEF"
  const ancla = 5;
  for (let i = 0; i < 3; i++) foco = caretSiguiente(chars, foco, 1);
  const r = caretsARango(ancla, foco)!;
  expect(textoDeRango(chars, r.ancla, r.foco)).toBe('DEF');
  foco = caretSiguiente(chars, foco, 1); // salta \r\n y toma G
  const r2 = caretsARango(ancla, foco)!;
  expect(textoDeRango(chars, r2.ancla, r2.foco)).toBe('DEF\nG');
  foco = caretSiguiente(chars, caretSiguiente(chars, foco, -1), -1); // 11 -> 10 -> 8 (justo tras la F)
  const r3 = caretsARango(ancla, foco)!;
  expect(textoDeRango(chars, r3.ancla, r3.foco)).toBe('DEF');
  foco = caretSiguiente(chars, foco, -1);
  const r4 = caretsARango(ancla, foco)!;
  expect(textoDeRango(chars, r4.ancla, r4.foco)).toBe('DE');
});

test('Mayús+↓ lleva el foco a la línea siguiente conservando la columna; ↑ a la anterior', () => {
  // Caret 1 (entre A y B, x=50): en la línea siguiente la posición equivalente es entre D y E (caret 6).
  expect(caretLinea(chars, 1, 1, g0)).toBe(6);
  expect(caretLinea(chars, 6, 1, g0)).toBe(11);
  expect(caretLinea(chars, 11, -1, g0)).toBe(6);
  expect(caretLinea(chars, 6, -1, g0)).toBe(1);
});

test('Mayús+↓ en la última línea va al final del texto; Mayús+↑ en la primera, al inicio', () => {
  expect(caretLinea(chars, 11, 1, g0)).toBe(13);
  expect(caretLinea(chars, 1, -1, g0)).toBe(0);
});

test('Mayús+↓ con una columna más a la derecha que la línea siguiente cae al final de ésta', () => {
  const cs: CharBox[] = [...linea('ABCDEFG', 40, 180), sinCaja('\n'), ...linea('XY', 40, 150)];
  expect(caretLinea(cs, 6, 1, g0)).toBe(10); // tras la Y
});

test('caretInicioDe: primer carácter con caja dentro de la caja de la línea (o su final)', () => {
  const caja = { xPt: 40, yPt: 150, wPt: 30, hPt: 12 }; // "DEF"
  expect(caretInicioDe(chars, caja, 'inicio')).toBe(5);
  expect(caretInicioDe(chars, caja, 'final')).toBe(8);
  expect(caretInicioDe(chars, { xPt: 400, yPt: 400, wPt: 5, hPt: 5 }, 'inicio')).toBe(-1);
});

test('texto de una anotación: los caracteres cuyo centro cae dentro de sus quads', () => {
  const hit: MarcadoHit = {
    index: 0, kind: 'highlight', rectPt: { xPt: 50, yPt: 150, wPt: 20, hPt: 12 },
    quads: [[50, 162, 70, 162, 50, 150, 70, 150]] // "EF"
  };
  expect(textoDeMarcado(chars, hit)).toBe('EF');
});

test('orden de lectura de anotaciones: de arriba abajo y, en la misma línea, de izquierda a derecha', () => {
  const mk = (index: number, x: number, y: number): MarcadoHit => ({
    index, kind: 'highlight', rectPt: { xPt: x, yPt: y, wPt: 20, hPt: 12 },
    quads: [[x, y + 12, x + 20, y + 12, x, y, x + 20, y]]
  });
  // índices de creación desordenados respecto a la lectura
  const hits = [mk(0, 40, 120), mk(1, 100, 180), mk(2, 40, 180), mk(3, 40, 150)];
  expect(ordenLecturaMarcados(hits, g0).map((h) => h.index)).toEqual([2, 1, 3, 0]);
});
