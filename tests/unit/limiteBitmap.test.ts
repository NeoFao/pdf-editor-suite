import { test, expect } from 'vitest';
import { escalaAcotada, tamanoPaginaValido, MAX_PIXELES_BITMAP, MAX_LADO_BITMAP, MAX_LADO_PAGINA_PT } from '../../src/engine/limiteBitmap';

test('una página normal a escala 1 no se reduce', () => {
  expect(escalaAcotada(612, 792, 1)).toEqual({ escala: 1, reducida: false });
});

test('7200x7200 pt a escala 1 se reduce al tope de píxeles', () => {
  const r = escalaAcotada(7200, 7200, 1);
  expect(r.reducida).toBe(true);
  expect(7200 * r.escala * 7200 * r.escala).toBeLessThanOrEqual(MAX_PIXELES_BITMAP * 1.0001);
});

test('14400x14400 pt a escala 2 se reduce y respeta el lado máximo', () => {
  const r = escalaAcotada(14400, 14400, 2);
  expect(r.reducida).toBe(true);
  expect(14400 * r.escala).toBeLessThanOrEqual(MAX_LADO_BITMAP);
  expect(14400 * r.escala * 14400 * r.escala).toBeLessThanOrEqual(MAX_PIXELES_BITMAP * 1.0001);
});

test('una página muy alargada se acota por el lado máximo', () => {
  const r = escalaAcotada(10, 14400, 8);
  expect(14400 * r.escala).toBeLessThanOrEqual(MAX_LADO_BITMAP);
  expect(r.reducida).toBe(true);
});

test('dimensiones o escala no válidas dan siempre una escala finita > 0 (el tamaño se valida aparte)', () => {
  for (const [w, h, s] of [[NaN, 100, 1], [100, 0, 1], [1e9, 1e9, 1], [100, 100, NaN], [100, 100, 0], [-5, 10, 1]] as const) {
    const r = escalaAcotada(w, h, s);
    expect(Number.isFinite(r.escala)).toBe(true);
    expect(r.escala).toBeGreaterThan(0);
  }
});

test('tamanoPaginaValido: finito, > 0 y <= 14400 x UserUnit', () => {
  expect(tamanoPaginaValido(612, 792, 1)).toBe(true);
  expect(tamanoPaginaValido(7200, 7200, 1)).toBe(true);
  expect(tamanoPaginaValido(MAX_LADO_PAGINA_PT, MAX_LADO_PAGINA_PT, 1)).toBe(true);
  expect(tamanoPaginaValido(14401, 100, 1)).toBe(false);
  expect(tamanoPaginaValido(14401, 100, 2)).toBe(true);
  expect(tamanoPaginaValido(1e9, 1e9, 1)).toBe(false);
  expect(tamanoPaginaValido(NaN, 100, 1)).toBe(false);
  expect(tamanoPaginaValido(100, Infinity, 1)).toBe(false);
  expect(tamanoPaginaValido(0, 100, 1)).toBe(false);
  expect(tamanoPaginaValido(-1, 100, 1)).toBe(false);
});
