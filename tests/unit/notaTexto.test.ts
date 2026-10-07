import { test, expect } from 'vitest';
import { normalizarTextoNota } from '../../src/texto/notaTexto';

test('B4: la nota conserva sus saltos de línea y se normaliza CRLF/CR a LF', () => {
  expect(normalizarTextoNota('uno\r\ndos\rtres\ncuatro')).toBe('uno\ndos\ntres\ncuatro');
});

test('B4: se recortan los extremos pero no las líneas del medio; solo blancos = vacío (no se crea nota)', () => {
  expect(normalizarTextoNota('  \n hola\n\n mundo \n ')).toBe('hola\n\n mundo');
  expect(normalizarTextoNota(' \n\t \r\n')).toBe('');
  expect(normalizarTextoNota('')).toBe('');
});
