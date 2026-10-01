import { test, expect } from 'vitest';
import { validarUrlEnlace } from '../../src/engine/validarUrlEnlace';

test('acepta http:, https: y mailto:', () => {
  expect(validarUrlEnlace('https://example.com')).toBe('https://example.com');
  expect(validarUrlEnlace('http://example.com/pagina')).toBe('http://example.com/pagina');
  expect(validarUrlEnlace('mailto:alguien@example.com')).toBe('mailto:alguien@example.com');
});

test('rechaza javascript:, file: y data:', () => {
  expect(validarUrlEnlace('javascript:alert(1)')).toBeNull();
  expect(validarUrlEnlace('file:///etc/passwd')).toBeNull();
  expect(validarUrlEnlace('data:text/html,<script>alert(1)</script>')).toBeNull();
});

test('rechaza una URL relativa (sin esquema resoluble) y una cadena que no es una URL', () => {
  expect(validarUrlEnlace('pagina.html')).toBeNull();
  expect(validarUrlEnlace('no es una url')).toBeNull();
  expect(validarUrlEnlace('')).toBeNull();
});

test('rechaza un esquema inventado', () => {
  expect(validarUrlEnlace('miapp://accion')).toBeNull();
});
