import { test, expect } from 'vitest';
import { tesseractDataToLines } from '../../src/ocr/tesseractLines';
import type { TesseractData } from '../../src/ocr/tesseractLines';

test('tesseractDataToLines recorre blocks -> paragraphs -> lines y descarta vacías', () => {
  const data: TesseractData = {
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              { text: ' Hola ', bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } },
              { text: '   ', bbox: { x0: 5, y0: 6, x1: 7, y1: 8 } }
            ]
          }
        ]
      }
    ]
  };

  const lines = tesseractDataToLines(data);

  expect(lines).toEqual([{ text: 'Hola', bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } }]);
});

test('tesseractDataToLines usa data.lines como respaldo cuando no hay blocks', () => {
  const data: TesseractData = {
    lines: [
      { text: ' Adiós ', bbox: { x0: 10, y0: 20, x1: 30, y1: 40 } },
      { text: '', bbox: { x0: 0, y0: 0, x1: 0, y1: 0 } }
    ]
  };

  const lines = tesseractDataToLines(data);

  expect(lines).toEqual([{ text: 'Adiós', bbox: { x0: 10, y0: 20, x1: 30, y1: 40 } }]);
});

test('tesseractDataToLines descarta líneas sin bbox', () => {
  const data: TesseractData = {
    lines: [{ text: 'Sin caja' }]
  };

  const lines = tesseractDataToLines(data);

  expect(lines).toEqual([]);
});
