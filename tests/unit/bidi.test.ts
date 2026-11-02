import { test, expect, describe } from 'vitest';
import {
  claseBidi, tieneRtl, tieneArabe, aVisual, ordenLogicoDeVisual, baseDeVisual, type ClaseBidi
} from '../../src/texto/bidi';

const cp = (s: string): number => s.codePointAt(0)!;

describe('claseBidi: clase de cada carácter (UAX #9, subconjunto)', () => {
  test('letras latinas L, hebreas R, árabes AL, cifras EN, cifras árabes AN, blancos WS', () => {
    expect(claseBidi(cp('a'))).toBe('L');
    expect(claseBidi(cp('ñ'))).toBe('L');
    expect(claseBidi(cp('ש'))).toBe('R');
    expect(claseBidi(cp('م'))).toBe('AL');
    expect(claseBidi(cp('7'))).toBe('EN');
    expect(claseBidi(0x0667)).toBe('AN');
    expect(claseBidi(cp(' '))).toBe('WS');
    expect(claseBidi(cp('.'))).toBe('CS');
    expect(claseBidi(cp('-'))).toBe('ES');
    expect(claseBidi(cp('%'))).toBe('ET');
  });

  test('tieneRtl y tieneArabe', () => {
    expect(tieneRtl('Hola mundo 123')).toBe(false);
    expect(tieneRtl('Hola שלום')).toBe(true);
    expect(tieneRtl('مرحبا')).toBe(true);
    expect(tieneArabe('Hola שלום')).toBe(false);
    expect(tieneArabe('Hola مرحبا')).toBe(true);
  });
});

describe('aVisual: de texto lógico a orden de pintado (izquierda a derecha)', () => {
  test('hebreo puro con base RTL: se invierte entero', () => {
    expect(aVisual('שלום עולם', 'rtl')).toBe('םלוע םולש');
  });

  test('latín puro no cambia', () => {
    expect(aVisual('Hola mundo 123', 'ltr')).toBe('Hola mundo 123');
  });

  test('mixto en base LTR: el número tras una palabra hebrea queda a su izquierda', () => {
    expect(aVisual('Hola שלום 123 fin', 'ltr')).toBe('Hola 123 םולש fin');
  });

  test('mixto en base RTL: la palabra latina y su número conservan su orden interno', () => {
    expect(aVisual('שלום Hello 456 עולם', 'rtl')).toBe('םלוע Hello 456 םולש');
  });
});

describe('ordenLogicoDeVisual: de elementos en orden visual a orden lógico', () => {
  const clasesDe = (...c: ClaseBidi[]) => c;

  test('hebreo puro (base RTL): el orden lógico es el inverso del visual', () => {
    const base = baseDeVisual(clasesDe('R', 'R', 'R'));
    expect(base).toBe(1);
    expect(ordenLogicoDeVisual(clasesDe('R', 'R', 'R'), base)).toEqual([2, 1, 0]);
  });

  test('latín puro: sin cambios', () => {
    expect(ordenLogicoDeVisual(clasesDe('L', 'WS', 'L'), 0)).toEqual([0, 1, 2]);
  });

  test('Hola | 123 | שלום | fin (visual) → Hola, שלום, 123, fin (lógico)', () => {
    // elementos visuales: 0 Hola, 1 123, 2 שלום, 3 fin
    const orden = ordenLogicoDeVisual(clasesDe('L', 'EN', 'R', 'L'), 0);
    expect(orden).toEqual([0, 2, 1, 3]);
  });

  test('RTL con un tramo latino en medio: עולם | Hello 456 | שלום (visual) → שלום, Hello 456, עולם', () => {
    expect(ordenLogicoDeVisual(clasesDe('R', 'L', 'R'), 1)).toEqual([2, 1, 0]);
  });

  test('baseDeVisual: extremos latinos → LTR; extremos hebreos → RTL; mezcla → mayoría de elementos', () => {
    expect(baseDeVisual(clasesDe('L', 'R', 'L'))).toBe(0);
    expect(baseDeVisual(clasesDe('R', 'L', 'R'))).toBe(1);
    expect(baseDeVisual(clasesDe('L', 'R', 'R'))).toBe(1);
    expect(baseDeVisual(clasesDe('L', 'L', 'R'))).toBe(0);
  });
});
