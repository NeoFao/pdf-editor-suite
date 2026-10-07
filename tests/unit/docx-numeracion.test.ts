import { test, expect } from 'vitest';
import { formatoNumero, aplicarLvlText, FORMATOS_NUMERACION } from '../../src/convert/docx/numeracion';

/**
 * E-101: formatos de numeración de `w:numFmt` (funciones puras). Convenciones que se reproducen:
 * - lowerLetter/upperLetter: a..z, y luego aa, bb, cc... (la letra se REPITE; no es base 26: 28 es "bb", no "ab").
 * - lowerRoman/upperRoman: notación sustractiva estándar; sin cifra para 0.
 * - Más allá de 3999 los romanos repiten la M (4000 = MMMM) hasta 32767; por encima se cae a cifras arábigas.
 */
test('letras: a..z, luego aa, bb, cc... (Word repite la letra)', () => {
  expect(formatoNumero(1, 'lowerLetter')).toBe('a');
  expect(formatoNumero(26, 'lowerLetter')).toBe('z');
  expect(formatoNumero(27, 'lowerLetter')).toBe('aa');
  expect(formatoNumero(28, 'lowerLetter')).toBe('bb');
  expect(formatoNumero(52, 'lowerLetter')).toBe('zz');
  expect(formatoNumero(53, 'lowerLetter')).toBe('aaa');
  expect(formatoNumero(2, 'upperLetter')).toBe('B');
  expect(formatoNumero(27, 'upperLetter')).toBe('AA');
});

test('romanos: sustractivos, límites 1, 3999 y más allá', () => {
  expect(formatoNumero(1, 'lowerRoman')).toBe('i');
  expect(formatoNumero(4, 'lowerRoman')).toBe('iv');
  expect(formatoNumero(12, 'lowerRoman')).toBe('xii');
  expect(formatoNumero(26, 'upperRoman')).toBe('XXVI');
  expect(formatoNumero(27, 'upperRoman')).toBe('XXVII');
  expect(formatoNumero(1994, 'upperRoman')).toBe('MCMXCIV');
  expect(formatoNumero(3999, 'upperRoman')).toBe('MMMCMXCIX');
  expect(formatoNumero(4000, 'upperRoman')).toBe('MMMM');
  expect(formatoNumero(4001, 'lowerRoman')).toBe('mmmmi');
  expect(formatoNumero(32767, 'upperRoman')).toBe('M'.repeat(32) + 'DCCLXVII');
  expect(formatoNumero(32768, 'upperRoman')).toBe('32768'); // fuera de rango: cifras arábigas
});

test('cero: letras y romanos no tienen cifra (cadena vacía); decimal sí', () => {
  expect(formatoNumero(0, 'lowerLetter')).toBe('');
  expect(formatoNumero(0, 'upperRoman')).toBe('');
  expect(formatoNumero(0, 'decimal')).toBe('0');
});

test('decimal, decimalZero, none, bullet y formatos no soportados', () => {
  expect(formatoNumero(7, 'decimal')).toBe('7');
  expect(formatoNumero(7, 'decimalZero')).toBe('07');
  expect(formatoNumero(12, 'decimalZero')).toBe('12');
  expect(formatoNumero(3, 'none')).toBe('');
  expect(formatoNumero(3, 'bullet')).toBe('•');
  expect(formatoNumero(3, 'ordinalText')).toBeNull();
  expect(FORMATOS_NUMERACION.has('lowerRoman')).toBe(true);
  expect(FORMATOS_NUMERACION.has('ordinalText')).toBe(false);
});

test('lvlText: %1..%9 se sustituyen por el valor ya formateado de ese nivel; el resto es literal', () => {
  expect(aplicarLvlText('%1.', ['iv'])).toBe('iv.');
  expect(aplicarLvlText('%1)', ['B'])).toBe('B)');
  expect(aplicarLvlText('%1.%2.', ['2', 'b'])).toBe('2.b.');
  expect(aplicarLvlText('Artículo %1:', ['5'])).toBe('Artículo 5:');
  expect(aplicarLvlText('(%2)', ['1', 'c'])).toBe('(c)');
  expect(aplicarLvlText('%1.%3', ['1', '2'])).toBe('1.'); // nivel sin valor: se omite
  expect(aplicarLvlText('100%', ['1'])).toBe('100%'); // % sin dígito: literal
});
