import { test, expect } from 'vitest';
import { expandirMacros, formatoFecha, hexARgb, colocarCaja, colocarMarcaCentrada, visualAUsuario } from '../../src/pagina/encabezadoPie';

const fecha = new Date(2026, 0, 5); // 5 ene 2026, hora local

test('formatoFecha da dd/mm/aaaa con ceros', () => {
  expect(formatoFecha(fecha)).toBe('05/01/2026');
});

test('expandirMacros sustituye <<n>>, <<total>> y <<fecha>> (cualquier mayúscula/espacio)', () => {
  expect(expandirMacros('Página <<n>> de <<total>> - <<FECHA>>', { n: 3, total: 5, fecha })).toBe('Página 3 de 5 - 05/01/2026');
  expect(expandirMacros('<< n >>/<<total>>', { n: 12, total: 40, fecha })).toBe('12/40');
});

test('expandirMacros deja intacto lo que no es macro, también marcado HTML (es texto)', () => {
  expect(expandirMacros('<b>x</b> <<otra>> <n>', { n: 1, total: 1, fecha })).toBe('<b>x</b> <<otra>> <n>');
});

test('hexARgb', () => {
  expect(hexARgb('#ff8000')).toEqual([255, 128, 0]);
  expect(hexARgb('zzz')).toEqual([0, 0, 0]);
});

const P0 = { anchoPt: 200, altoPt: 100, rotation: 0 as const };

test('rotación 0: pie centrado queda abajo en el centro, sin giro', () => {
  const c = colocarCaja(P0, { zona: 'abajo', alineacion: 'centro' }, 40, 10, 36, 20);
  expect(c.giroGrados).toBe(0);
  expect(c.xPt).toBeCloseTo(80, 5);
  expect(c.yPt).toBeCloseTo(22, 5); // margen 20 + descendente 2
});

test('rotación 0: encabezado derecha arriba respeta el margen derecho visual', () => {
  const c = colocarCaja(P0, { zona: 'arriba', alineacion: 'der' }, 40, 10, 36, 20);
  expect(c.xPt).toBeCloseTo(200 - 36 - 40, 5);
  expect(c.yPt).toBeCloseTo(100 - 20 - 7.2, 5);
});

test('rotación 90: esquinas visuales caen donde pdfium las pone y el texto gira 90', () => {
  // Página visual 100 ancho x 200 alto (usuario 200x100, /Rotate 90 CW).
  const p = { anchoPt: 100, altoPt: 200, rotation: 90 as const };
  // Abajo-izq visual = usuario (200, 0)?? Con /Rotate 90 CW el origen de usuario (0,0) se ve arriba-izq.
  const arribaIzq = visualAUsuario(p, 0, 200);
  expect(arribaIzq.xPt).toBeCloseTo(0, 5);
  expect(arribaIzq.yPt).toBeCloseTo(0, 5);
  const abajoIzq = visualAUsuario(p, 0, 0);
  expect(abajoIzq.xPt).toBeCloseTo(200, 5);
  expect(abajoIzq.yPt).toBeCloseTo(0, 5);
  const c = colocarCaja(p, { zona: 'abajo', alineacion: 'izq' }, 30, 10, 10, 10);
  expect(c.giroGrados).toBe(90);
});

test('rotaciones 0/90/180/270: un punto visual interior cae dentro de la caja de usuario', () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    const p = { anchoPt: rotation % 180 === 0 ? 200 : 100, altoPt: rotation % 180 === 0 ? 100 : 200, rotation };
    const o = visualAUsuario(p, 30, 40);
    expect(o.xPt).toBeGreaterThanOrEqual(0); expect(o.xPt).toBeLessThanOrEqual(200);
    expect(o.yPt).toBeGreaterThanOrEqual(0); expect(o.yPt).toBeLessThanOrEqual(100);
  }
});

test('marca centrada a 45 grados: el centro del texto cae en el centro y el giro suma el /Rotate', () => {
  const m = colocarMarcaCentrada(P0, 100, 20, 45);
  expect(m.giroGrados).toBe(45);
  const t = Math.PI / 4;
  const cx = m.xPt + 50 * Math.cos(t) - 7.2 * Math.sin(t);
  const cy = m.yPt + 50 * Math.sin(t) + 7.2 * Math.cos(t);
  expect(cx).toBeCloseTo(100, 4);
  expect(cy).toBeCloseTo(50, 4);
  expect(colocarMarcaCentrada({ anchoPt: 100, altoPt: 200, rotation: 90 }, 100, 20, 45).giroGrados).toBe(135);
});
