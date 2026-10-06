import { test, expect } from 'vitest';
import { PageGeometry } from '../../src/coords/PageGeometry';
import { puntoEnQuad, marcadoBajoPunto, quadsPorLinea, rectToQuad, type QuadPt } from '../../src/coords/quads';

// T14: detección de clic sobre una anotación de marcado con sus QuadPoints (pt PDF de usuario).

test('puntoEnQuad: dentro, fuera y en el borde de un quad alineado', () => {
  const q = rectToQuad({ xPt: 10, yPt: 20, wPt: 30, hPt: 10 }); // x 10..40, y 20..30
  expect(puntoEnQuad(25, 25, q)).toBe(true);
  expect(puntoEnQuad(10, 20, q)).toBe(true); // esquina
  expect(puntoEnQuad(9.9, 25, q)).toBe(false);
  expect(puntoEnQuad(25, 30.1, q)).toBe(false);
});

test('puntoEnQuad: no depende del orden de los vértices (Acrobat, antihorario o cíclico)', () => {
  const [tlx, tly, trx, try_, blx, bly, brx, bry] = rectToQuad({ xPt: 0, yPt: 0, wPt: 10, hPt: 4 });
  const acrobat: QuadPt = [tlx!, tly!, trx!, try_!, blx!, bly!, brx!, bry!];
  const cclico: QuadPt = [blx!, bly!, brx!, bry!, trx!, try_!, tlx!, tly!]; // BL, BR, TR, TL
  for (const q of [acrobat, cclico]) {
    expect(puntoEnQuad(5, 2, q)).toBe(true);
    expect(puntoEnQuad(11, 2, q)).toBe(false);
  }
});

test('puntoEnQuad: un quad girado 30 grados contiene su centro y NO la esquina de su rectángulo envolvente', () => {
  const a = Math.PI / 6;
  const rot = (x: number, y: number): [number, number] => [100 + x * Math.cos(a) - y * Math.sin(a), 100 + x * Math.sin(a) + y * Math.cos(a)];
  // Rectángulo 60x10 centrado en (100,100), girado 30 grados (TL, TR, BL, BR).
  const [tl, tr, bl, br] = [rot(-30, 5), rot(30, 5), rot(-30, -5), rot(30, -5)];
  const q: QuadPt = [...tl, ...tr, ...bl, ...br];
  expect(puntoEnQuad(100, 100, q)).toBe(true);
  expect(puntoEnQuad(...rot(25, 4), q)).toBe(true);
  expect(puntoEnQuad(...rot(25, 8), q)).toBe(false);          // fuera por arriba del quad girado
  const maxX = Math.max(tl[0], tr[0], bl[0], br[0]), minY = Math.min(tl[1], tr[1], bl[1], br[1]);
  expect(puntoEnQuad(maxX - 0.5, minY + 0.5, q)).toBe(false); // esquina del envolvente, fuera del quad
});

test('puntoEnQuad: un quad degenerado (área cero) no contiene nada', () => {
  expect(puntoEnQuad(5, 5, [0, 0, 10, 10, 0, 0, 10, 10])).toBe(false);
});

test('marcadoBajoPunto: gana la última anotación (la de encima) y respeta el tipo; las notas usan su rect', () => {
  const a = rectToQuad({ xPt: 0, yPt: 0, wPt: 100, hPt: 20 });
  const items = [
    { index: 2, kind: 'highlight' as const, quads: [a], rectPt: { xPt: 0, yPt: 0, wPt: 100, hPt: 20 } },
    { index: 5, kind: 'underline' as const, quads: [a], rectPt: { xPt: 0, yPt: 0, wPt: 100, hPt: 20 } },
    { index: 7, kind: 'note' as const, quads: [], rectPt: { xPt: 200, yPt: 200, wPt: 20, hPt: 20 } }
  ];
  expect(marcadoBajoPunto(items, 50, 10)?.index).toBe(5);
  expect(marcadoBajoPunto(items, 210, 210)?.index).toBe(7);
  expect(marcadoBajoPunto(items, 150, 10)).toBeNull();
});

test('con /Rotate 270, un punto sobre el texto (px CSS → pt con la geometría común) cae dentro del quad de su línea (E-053)', () => {
  // Página de usuario 200x300 girada 270: el visor la ve de 300x200.
  const geo = PageGeometry.desdeTamanoVisual(300, 200, 1, 270);
  const p1 = geo.cssToPt(40, 60), p2 = geo.cssToPt(160, 74);
  const caja = { xPt: Math.min(p1.xPt, p2.xPt), yPt: Math.min(p1.yPt, p2.yPt), wPt: Math.abs(p2.xPt - p1.xPt), hPt: Math.abs(p2.yPt - p1.yPt) };
  const quads = quadsPorLinea([{ boxPt: caja, sizePt: 12 }], geo);
  expect(quads).toHaveLength(1);
  const centro = geo.cssToPt(100, 67);
  expect(puntoEnQuad(centro.xPt, centro.yPt, quads[0]!)).toBe(true);
  const fuera = geo.cssToPt(100, 90);
  expect(puntoEnQuad(fuera.xPt, fuera.yPt, quads[0]!)).toBe(false);
});
