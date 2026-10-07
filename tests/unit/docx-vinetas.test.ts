import { test, expect } from 'vitest';
import { resolverVineta } from '../../src/convert/docx/vinetas';

/** E-102: el carácter de una viñeta (`w:lvlText` + `w:rPr/w:rFonts` del nivel) se traduce a Unicode y a una fuente estándar PDF que tenga el glifo. */
const pua = (n: number): string => String.fromCodePoint(0xf000 + n);

test('Symbol F0B7 es la viñeta redonda de siempre, sin aproximación', () => {
  expect(resolverVineta(pua(0xb7), 'Symbol')).toEqual({ texto: '•', font: 'Helvetica', escala: 1, aproximada: false });
});

test('Wingdings: F0FC -> ✓, F0D8 -> ➢ y F076 -> ❖ se dibujan con ZapfDingbats (que SÍ tiene esos glifos)', () => {
  expect(resolverVineta(pua(0xfc), 'Wingdings')).toEqual({ texto: '✓', font: 'ZapfDingbats', escala: 1, aproximada: false });
  expect(resolverVineta(pua(0xd8), 'Wingdings')).toEqual({ texto: '➢', font: 'ZapfDingbats', escala: 1, aproximada: false });
  expect(resolverVineta(pua(0x76), 'Wingdings')).toEqual({ texto: '❖', font: 'ZapfDingbats', escala: 1, aproximada: false });
});

test('Wingdings F0A7 (cuadradito ▪): ninguna fuente estándar lo tiene; se dibuja el cuadrado de ZapfDingbats a escala reducida, sin aviso', () => {
  const v = resolverVineta(pua(0xa7), 'Wingdings');
  expect(v.texto).toBe('■');
  expect(v.font).toBe('ZapfDingbats');
  expect(v.escala).toBeGreaterThan(0.4);
  expect(v.escala).toBeLessThan(0.8);
  expect(v.aproximada).toBe(false);
});

test('el mismo carácter guardado como Latin-1 ("§", "Ø", "ü") con Wingdings equivale al de la zona privada', () => {
  expect(resolverVineta('Ø', 'Wingdings').texto).toBe('➢');
  expect(resolverVineta('ü', 'Wingdings').texto).toBe('✓');
  expect(resolverVineta('§', 'Wingdings').texto).toBe('■');
});

test('Courier New "o" (viñeta de segundo nivel de Word) se dibuja como el propio glifo de Courier, sin aviso', () => {
  expect(resolverVineta('o', 'Courier New')).toEqual({ texto: 'o', font: 'Courier', escala: 1, aproximada: false });
});

test('F0A8 (□) existe en la tabla pero ninguna fuente estándar tiene el glifo: "•" aproximado', () => {
  expect(resolverVineta(pua(0xa8), 'Wingdings')).toEqual({ texto: '•', font: 'Helvetica', escala: 1, aproximada: true });
});

test('un carácter de uso privado desconocido, o una fuente de símbolos desconocida, cae a "•" aproximado', () => {
  expect(resolverVineta(pua(0x01), 'Wingdings').aproximada).toBe(true);
  expect(resolverVineta(pua(0xb7), 'MiFuenteRara').texto).toBe('•');
  expect(resolverVineta(pua(0xb7), 'MiFuenteRara').aproximada).toBe(true);
});

test('un carácter normal que Helvetica dibuja (•, -, –) se conserva; uno que no (★) cae a "•" aproximado; sin lvlText: "•" sin aviso', () => {
  expect(resolverVineta('•', 'Arial')).toEqual({ texto: '•', font: 'Helvetica', escala: 1, aproximada: false });
  expect(resolverVineta('-', null).texto).toBe('-');
  expect(resolverVineta('–', null).texto).toBe('–');
  expect(resolverVineta('★', 'Arial').aproximada).toBe(true);
  expect(resolverVineta('', null)).toEqual({ texto: '•', font: 'Helvetica', escala: 1, aproximada: false });
  expect(resolverVineta(null, null).aproximada).toBe(false);
});
