import { test, expect } from 'vitest';
import { resolverVineta } from '../../src/convert/docx/vinetas';

/** E-102: el carácter de una viñeta (`w:lvlText` + `w:rPr/w:rFonts` del nivel) se traduce al Unicode OFICIAL y a una fuente estándar PDF; solo lo exacto va sin aviso. */
const pua = (n: number): string => String.fromCodePoint(0xf000 + n);

test('Symbol F0B7 es la viñeta redonda de siempre: exacta', () => {
  expect(resolverVineta(pua(0xb7), 'Symbol')).toEqual({ texto: '•', font: 'Helvetica', escala: 1, aproximada: false, oficial: '•' });
});

test('Wingdings F0FC (U+2714 ✔) y F076 (U+2756 ❖) existen en ZapfDingbats: exactos, sin aviso', () => {
  expect(resolverVineta(pua(0xfc), 'Wingdings')).toEqual({ texto: '✔', font: 'ZapfDingbats', escala: 1, aproximada: false, oficial: '✔' });
  expect(resolverVineta(pua(0x76), 'Wingdings')).toEqual({ texto: '❖', font: 'ZapfDingbats', escala: 1, aproximada: false, oficial: '❖' });
});

test('Wingdings F0D8 es U+2B9A: ninguna estándar lo tiene; se dibuja ➢ (U+27A2) y es APROXIMADO', () => {
  expect(resolverVineta(pua(0xd8), 'Wingdings')).toEqual({ texto: '➢', font: 'ZapfDingbats', escala: 1, aproximada: true, oficial: '⮚' });
});

test('Wingdings F0A7 (▪ U+25AA): se dibuja el cuadrado de ZapfDingbats a escala reducida y es APROXIMADO', () => {
  const v = resolverVineta(pua(0xa7), 'Wingdings');
  expect(v.texto).toBe('■');
  expect(v.font).toBe('ZapfDingbats');
  expect(v.escala).toBeGreaterThan(0.4);
  expect(v.escala).toBeLessThan(0.8);
  expect(v.aproximada).toBe(true);
  expect(v.oficial).toBe('▪');
});

test('Wingdings F0A8 es U+25FB: sin glifo en ninguna estándar, "•" aproximado', () => {
  expect(resolverVineta(pua(0xa8), 'Wingdings')).toEqual({ texto: '•', font: 'Helvetica', escala: 1, aproximada: true, oficial: '◻' });
});

test('el mismo carácter guardado como Latin-1 ("§", "Ø", "ü") con Wingdings equivale al de la zona privada', () => {
  expect(resolverVineta('Ø', 'Wingdings').oficial).toBe('⮚');
  expect(resolverVineta('ü', 'Wingdings').texto).toBe('✔');
  expect(resolverVineta('§', 'Wingdings').oficial).toBe('▪');
});

test('Courier New "o" (viñeta de segundo nivel de Word) es la propia "o" de Courier: exacta', () => {
  expect(resolverVineta('o', 'Courier New')).toEqual({ texto: 'o', font: 'Courier', escala: 1, aproximada: false, oficial: 'o' });
});

test('un carácter de uso privado desconocido, o una fuente de símbolos desconocida, cae a "•" aproximado', () => {
  expect(resolverVineta(pua(0x01), 'Wingdings').aproximada).toBe(true);
  expect(resolverVineta(pua(0xb7), 'MiFuenteRara').texto).toBe('•');
  expect(resolverVineta(pua(0xb7), 'MiFuenteRara').aproximada).toBe(true);
});

test('un carácter normal que Helvetica dibuja (•, -, –) se conserva; uno que no (★) cae a "•" aproximado; sin lvlText: "•" sin aviso', () => {
  expect(resolverVineta('•', 'Arial')).toEqual({ texto: '•', font: 'Helvetica', escala: 1, aproximada: false, oficial: '•' });
  expect(resolverVineta('-', null).texto).toBe('-');
  expect(resolverVineta('–', null).texto).toBe('–');
  expect(resolverVineta('★', 'Arial').aproximada).toBe(true);
  expect(resolverVineta('', null).aproximada).toBe(false);
  expect(resolverVineta(null, null).aproximada).toBe(false);
});
