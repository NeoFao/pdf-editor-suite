import { test, expect } from 'vitest';
import { planDeCompresion, tieneCanalAlfa } from '../../src/image/comprimir';

test('planDeCompresion: 3000px en 5 pulgadas (600 dpi) con dpiMax 150 se reduce a 750px', () => {
  const plan = planDeCompresion(
    [{ objIndex: 0, widthPx: 3000, heightPx: 3000, wPt: 5 * 72, hPt: 5 * 72, tieneAlfa: false }],
    { calidad: 0.7, dpiMax: 150 }
  );
  expect(plan).toHaveLength(1);
  expect(plan[0]!.dpiEfectivo).toBeCloseTo(600, 5);
  expect(plan[0]!.reescalar).toBe(true);
  expect(plan[0]!.targetWidthPx).toBe(750);
  expect(plan[0]!.targetHeightPx).toBe(750);
});

test('planDeCompresion: una imagen a 100 dpi con dpiMax 150 no se toca', () => {
  const plan = planDeCompresion(
    [{ objIndex: 0, widthPx: 100, heightPx: 100, wPt: 72, hPt: 72, tieneAlfa: false }], // 100px / 1in = 100dpi
    { calidad: 0.7, dpiMax: 150 }
  );
  expect(plan[0]!.dpiEfectivo).toBeCloseTo(100, 5);
  expect(plan[0]!.reescalar).toBe(false);
  expect(plan[0]!.targetWidthPx).toBe(100);
  expect(plan[0]!.targetHeightPx).toBe(100);
});

test('planDeCompresion: usa el dpi mayor de ancho/alto (imagen no proporcional)', () => {
  // 200pt de ancho = 200/72 in; 3000px / (200/72) ≈ 1080dpi (excede dpiMax con margen).
  const plan = planDeCompresion(
    [{ objIndex: 0, widthPx: 3000, heightPx: 300, wPt: 200, hPt: 200, tieneAlfa: false }],
    { calidad: 0.7, dpiMax: 150 }
  );
  expect(plan[0]!.reescalar).toBe(true);
});

test('planDeCompresion procesa varias imágenes de forma independiente, en el mismo orden', () => {
  const plan = planDeCompresion(
    [
      { objIndex: 5, widthPx: 3000, heightPx: 3000, wPt: 360, hPt: 360, tieneAlfa: false }, // 600dpi
      { objIndex: 2, widthPx: 100, heightPx: 100, wPt: 72, hPt: 72, tieneAlfa: true }        // 100dpi
    ],
    { calidad: 0.5, dpiMax: 150 }
  );
  expect(plan.map((p) => p.objIndex)).toEqual([5, 2]);
  expect(plan[0]!.reescalar).toBe(true);
  expect(plan[1]!.reescalar).toBe(false);
  expect(plan[1]!.tieneAlfa).toBe(true);
});

test('tieneCanalAlfa: true si algún píxel no es totalmente opaco', () => {
  const rgba = new Uint8Array([0, 0, 0, 255, 10, 10, 10, 200]);
  expect(tieneCanalAlfa(rgba)).toBe(true);
});

test('tieneCanalAlfa: false si todos los píxeles son opacos', () => {
  const rgba = new Uint8Array([0, 0, 0, 255, 10, 10, 10, 255]);
  expect(tieneCanalAlfa(rgba)).toBe(false);
});
