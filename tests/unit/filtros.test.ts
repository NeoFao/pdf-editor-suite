import { test, expect } from 'vitest';
import { escalaDeGrises, otsuThreshold, blancoYNegro, colorMagico } from '../../src/image/filtros';

test('escalaDeGrises: un píxel gris medio se queda gris (mismo valor)', () => {
  const rgba = new Uint8ClampedArray([128, 128, 128, 200]);
  const out = escalaDeGrises(rgba);
  expect(out[0]).toBe(128);
  expect(out[1]).toBe(128);
  expect(out[2]).toBe(128);
  expect(out[3]).toBe(200); // alfa intacto
});

test('escalaDeGrises: un píxel de color se convierte con la luminancia BT.601', () => {
  const rgba = new Uint8ClampedArray([100, 150, 200, 255]);
  const out = escalaDeGrises(rgba);
  const esperado = Math.round(0.299 * 100 + 0.587 * 150 + 0.114 * 200);
  expect(out[0]).toBe(esperado);
  expect(out[1]).toBe(esperado);
  expect(out[2]).toBe(esperado);
});

test('escalaDeGrises no muta el array de entrada', () => {
  const rgba = new Uint8ClampedArray([100, 150, 200, 255]);
  const copia = Uint8ClampedArray.from(rgba);
  escalaDeGrises(rgba);
  expect(rgba).toEqual(copia);
});

function histogramaBimodal(): Uint8ClampedArray {
  // 100 píxeles alrededor de 50 (oscuros) + 100 píxeles alrededor de 200 (claros).
  const pixeles: number[] = [];
  for (let i = 0; i < 100; i++) {
    const v = 45 + (i % 10); // 45..54
    pixeles.push(v, v, v, 255);
  }
  for (let i = 0; i < 100; i++) {
    const v = 195 + (i % 10); // 195..204
    pixeles.push(v, v, v, 255);
  }
  return new Uint8ClampedArray(pixeles);
}

test('otsuThreshold: en un histograma bimodal, el umbral cae entre las dos modas', () => {
  const t = otsuThreshold(histogramaBimodal());
  // 54 es el nivel más alto de la moda oscura (45..54): el separador correcto
  // cae AL MENOS ahí (blancoYNegro usa `> t`, así que t=54 ya separa bien las
  // dos modas) y por debajo de la moda clara (195..204).
  expect(t).toBeGreaterThanOrEqual(54);
  expect(t).toBeLessThan(195);
});

test('blancoYNegro con umbral "otsu" (por defecto) separa el bimodal en negro/blanco puros', () => {
  const out = blancoYNegro(histogramaBimodal());
  // Los primeros 100 píxeles (oscuros) → negro puro.
  expect(out[0]).toBe(0);
  expect(out[1]).toBe(0);
  expect(out[2]).toBe(0);
  // Los últimos 100 píxeles (claros) → blanco puro.
  const ultimo = out.length - 4;
  expect(out[ultimo]).toBe(255);
  expect(out[ultimo + 1]).toBe(255);
  expect(out[ultimo + 2]).toBe(255);
});

test('blancoYNegro con umbral numérico explícito no calcula Otsu', () => {
  const rgba = new Uint8ClampedArray([100, 100, 100, 255, 200, 200, 200, 255]);
  const out = blancoYNegro(rgba, 150);
  expect(out[0]).toBe(0); // 100 < 150 → negro
  expect(out[4]).toBe(255); // 200 > 150 → blanco
});

test('blancoYNegro conserva el alfa', () => {
  const rgba = new Uint8ClampedArray([10, 10, 10, 77]);
  const out = blancoYNegro(rgba, 128);
  expect(out[3]).toBe(77);
});

test('colorMagico estira un rango 50..200 a ~0..255 y conserva el alfa', () => {
  const pixeles: number[] = [];
  for (let v = 50; v <= 200; v++) pixeles.push(v, v, v, 222);
  const rgba = new Uint8ClampedArray(pixeles);
  const out = colorMagico(rgba);

  let min = 255, max = 0;
  for (let i = 0; i < out.length; i += 4) {
    min = Math.min(min, out[i]!);
    max = Math.max(max, out[i]!);
    expect(out[i + 3]).toBe(222); // alfa conservado en todos los píxeles
  }
  expect(min).toBeLessThanOrEqual(5);
  expect(max).toBeGreaterThanOrEqual(250);
});

test('colorMagico no muta el array de entrada', () => {
  const rgba = new Uint8ClampedArray([50, 60, 70, 255, 200, 190, 180, 255]);
  const copia = Uint8ClampedArray.from(rgba);
  colorMagico(rgba);
  expect(rgba).toEqual(copia);
});
