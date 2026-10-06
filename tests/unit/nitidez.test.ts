import { test, expect } from 'vitest';
import { factorNitidez, MAX_DPR_PAGINA, MAX_PIXELES_PAGINA } from '../../src/ui/nitidez';

test('DPR 1 pinta a 1 px de bitmap por px CSS (como antes)', () => {
  expect(factorNitidez(1, 800, 1100)).toBe(1);
});

test('DPR 2 pinta al doble cuando la página cabe en el límite de píxeles', () => {
  expect(factorNitidez(2, 800, 1100)).toBe(2);
});

test('el DPR se acota a MAX_DPR_PAGINA', () => {
  expect(factorNitidez(4, 400, 500)).toBe(MAX_DPR_PAGINA);
});

test('el límite de píxeles por página reduce el factor, sin bajar de 1', () => {
  const f = factorNitidez(2.5, 1800, 2500);
  expect(f).toBeGreaterThanOrEqual(1);
  expect(f).toBeLessThan(2.5);
  expect(1800 * 2500 * f * f).toBeLessThanOrEqual(MAX_PIXELES_PAGINA * 1.0001);
  // Una página ya mayor que el límite en CSS no se pinta a menos de 1:1.
  expect(factorNitidez(2, 4000, 4000)).toBe(1);
});

test('DPR no válido (0, NaN, negativo) cae a 1', () => {
  expect(factorNitidez(0, 800, 1100)).toBe(1);
  expect(factorNitidez(NaN, 800, 1100)).toBe(1);
  expect(factorNitidez(-2, 800, 1100)).toBe(1);
});
