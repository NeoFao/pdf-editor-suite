import { test, expect } from 'vitest';
import { resumirParaAnunciar } from '../../src/ui/anuncio';

test('colapsa espacios y saltos de línea en uno y recorta los extremos', () => {
  expect(resumirParaAnunciar('  La  segunda\nlinea \r\n ')).toBe('La segunda linea');
});

test('no toca las letras "s" (regresión: el colapso de blancos no debe comerse la s)', () => {
  expect(resumirParaAnunciar('Este documento')).toBe('Este documento');
});

test('trunca con puntos suspensivos sin pasar del máximo', () => {
  const largo = 'a'.repeat(200);
  const r = resumirParaAnunciar(largo, 80);
  expect(r).toHaveLength(80);
  expect(r.endsWith('…')).toBe(true);
  expect(resumirParaAnunciar('corto', 80)).toBe('corto');
});
