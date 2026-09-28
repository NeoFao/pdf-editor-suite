import { test, expect } from 'vitest';
import { parseRange } from '../../src/ui/pageRange';

test('parseRange interpreta tramos, sueltos y normaliza', () => {
  expect(parseRange('1-3,5', 10)).toEqual([0, 1, 2, 4]);
  expect(parseRange('2', 10)).toEqual([1]);
  expect(parseRange('3-1', 10)).toEqual([0, 1, 2]);        // invertido → lo ordena asc dentro del tramo
  expect(parseRange('1,1,2', 10)).toEqual([0, 1]);          // sin duplicados
  expect(parseRange('5-99', 6)).toEqual([4, 5]);            // recorta al total
  expect(parseRange('  ', 5)).toEqual([]);                  // vacío
  expect(parseRange('0, 7', 3)).toEqual([]);                // fuera de rango
});
