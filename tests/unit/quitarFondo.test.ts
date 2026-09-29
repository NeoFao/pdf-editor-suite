import { test, expect } from 'vitest';
import { quitarFondo } from '../../src/ui/quitarFondo';

test('quitarFondo pone alfa 0 en píxeles casi blancos, deja el trazo oscuro intacto y suaviza el borde', () => {
  const rgba = new Uint8ClampedArray([
    255, 255, 255, 255, // blanco puro: fondo → transparente
    0, 0, 0, 255,       // negro puro: trazo → alfa intacto
    220, 220, 220, 255, // gris claro, dentro de la banda [umbral-20, umbral) con umbral=235 → alfa intermedio
    236, 240, 250, 255  // "casi blanco" pero no perfecto (ruido de escáner): también fondo, min canal 236 ≥ 235
  ]);
  const out = quitarFondo(rgba, 235);
  expect(out[3]).toBe(0);
  expect(out[7]).toBe(255);
  expect(out[11]).toBeGreaterThan(0);
  expect(out[11]).toBeLessThan(255);
  expect(out[15]).toBe(0);
});

test('quitarFondo no muta el array de entrada', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 10, 10, 10, 255]);
  const copia = Uint8ClampedArray.from(rgba);
  quitarFondo(rgba);
  expect(rgba).toEqual(copia);
});

test('quitarFondo con umbral por defecto (235) recorta el blanco típico de una firma escaneada', () => {
  const rgba = new Uint8ClampedArray([255, 254, 253, 255, 5, 5, 5, 255]);
  const out = quitarFondo(rgba);
  expect(out[3]).toBe(0);
  expect(out[7]).toBe(255);
});
