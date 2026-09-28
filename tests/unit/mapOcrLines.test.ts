import { test, expect } from 'vitest';
import { mapOcrLines } from '../../src/ocr/mapOcrLines';

test('mapOcrLines convierte bbox de píxeles (Y hacia abajo) a puntos PDF (Y hacia arriba)', () => {
  const specs = mapOcrLines(
    [{ text: ' Hola ', bbox: { x0: 40, y0: 100, x1: 140, y1: 120 } }],
    2,
    200
  );
  expect(specs).toEqual([{ xPt: 20, yPt: 140, sizePt: 8, text: 'Hola', invisible: true }]);
});

test('mapOcrLines descarta líneas con texto vacío o solo espacios', () => {
  const specs = mapOcrLines(
    [
      { text: '   ', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
      { text: '', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }
    ],
    2,
    200
  );
  expect(specs).toEqual([]);
});
