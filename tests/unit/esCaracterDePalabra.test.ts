import { test, expect } from 'vitest';
import { esCaracterDePalabra } from '../../src/texto/esCaracterDePalabra';

test('letras (ASCII, tildes, ñ, ü, griego, cirílico), dígitos y _ son de palabra', () => {
  for (const c of ['a', 'Z', 'ñ', 'á', 'ü', 'Ω', 'ж', '7', '_']) expect(esCaracterDePalabra(c.codePointAt(0)!)).toBe(true);
});

test('espacios, puntuación, símbolos y fin de línea no lo son', () => {
  for (const c of [' ', '.', ',', '(', '-', '€', '\n', '\r', '\u00a0']) expect(esCaracterDePalabra(c.codePointAt(0)!)).toBe(false);
});

test('un código inválido o 0 (fuera de rango) no es de palabra', () => {
  expect(esCaracterDePalabra(0)).toBe(false);
  expect(esCaracterDePalabra(-1)).toBe(false);
  expect(esCaracterDePalabra(0xd800)).toBe(false);
});
