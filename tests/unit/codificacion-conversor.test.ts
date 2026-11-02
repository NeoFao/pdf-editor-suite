import { test, expect } from 'vitest';
import {
  repertorioDe, prepararTexto, CodificadorTexto, advertenciasCodificacion, MARCADOR_SIN_GLIFO,
  FUENTE_SIMBOLOS, FUENTE_DINGBATS
} from '../../src/convert/codificacion';

/** Mapeo carácter → repertorio de las fuentes estándar de PDF (E-120). Sin motor: función pura. */

test('repertorioDe: WinAnsi (ASCII, Latin-1 y los extras 0x80-0x9F) se dibuja con la fuente normal', () => {
  for (const ch of ['a', 'Z', '~', 'ñ', 'é', 'ÿ', '¿', '€', '•', '“', '–', '…', '™', 'Š', 'ž', 'Œ']) {
    expect(repertorioDe(ch.codePointAt(0)!), ch).toBe('winansi');
  }
});

test('repertorioDe: griego, flechas y símbolos matemáticos van a Symbol', () => {
  for (const ch of ['α', 'β', 'ω', 'Σ', 'Ω', 'μ', '→', '←', '↔', '≤', '≠', '∞', '∑', '√', '∈']) {
    expect(repertorioDe(ch.codePointAt(0)!), ch).toBe('symbol');
  }
});

test('repertorioDe: marcas y adornos (check, cruz, estrella) van a ZapfDingbats', () => {
  for (const ch of ['✓', '✔', '✗', '★', '❤', '✂']) {
    expect(repertorioDe(ch.codePointAt(0)!), ch).toBe('dingbats');
  }
});

test('repertorioDe: lo que ninguna fuente estándar tiene es sin-glifo (Latin Ext-A, cirílico, CJK, emoji, hebreo)', () => {
  for (const ch of ['Ł', 'ą', 'č', 'ő', 'ř', 'ş', 'Привет', 'ж', '日', '本', '😀', 'א', 'ά', '₹', '₽']) {
    expect(repertorioDe(ch.codePointAt(0)!), ch).toBe('sin-glifo');
  }
});

test('prepararTexto: ASCII y Latin-1 pasan intactos, sin segmentos extra ni avisos', () => {
  const p = prepararTexto('Año nuevo, señor: ¿qué tal?');
  expect(p.segmentos).toEqual([{ repertorio: 'winansi', visible: 'Año nuevo, señor: ¿qué tal?', original: 'Año nuevo, señor: ¿qué tal?', sinGlifo: false }]);
  expect(p.sinGlifo.size).toBe(0);
  expect(p.controles.size).toBe(0);
});

test('prepararTexto: un carácter sin glifo se sustituye por "?" y se cuenta; el original se conserva en el segmento', () => {
  const p = prepararTexto('Zażółć gęślą');
  const visible = p.segmentos.map((s) => s.visible).join('');
  expect(visible).toBe('Za?ó?? g??l?');
  expect(p.segmentos.map((s) => s.original).join('')).toBe('Zażółć gęślą');
  expect(p.segmentos.some((s) => s.sinGlifo)).toBe(true);
  expect(visible).not.toContain('ÿ');
  expect(p.sinGlifo.get('ż'.codePointAt(0)!)).toBe(1);
  expect(p.sinGlifo.get('ł'.codePointAt(0)!)).toBe(1);
  expect(p.sinGlifo.has('ó'.codePointAt(0)!)).toBe(false); // ó sí es WinAnsi
  expect(p.sinGlifo.get('ć'.codePointAt(0)!)).toBe(1);
});

test('prepararTexto: el griego se parte en un segmento Symbol (con sus espacios internos) y el resto queda en WinAnsi', () => {
  const p = prepararTexto('Valor αβγ δεζ final');
  expect(p.segmentos.map((s) => [s.repertorio, s.visible])).toEqual([
    ['winansi', 'Valor '], ['symbol', 'αβγ δεζ'], ['winansi', ' final']
  ]);
  expect(p.sinGlifo.size).toBe(0);
});

test('prepararTexto: Ω (U+03A9) y μ (U+03BC) se codifican con los puntos de código que Symbol sí tiene', () => {
  const p = prepararTexto('Ω μ');
  expect(p.segmentos).toHaveLength(1);
  expect(p.segmentos[0]!.repertorio).toBe('symbol');
  expect(p.segmentos[0]!.visible).toBe('Ω µ');
  expect(p.sinGlifo.size).toBe(0);
});

test('prepararTexto: emoji (par sustituto) cuenta como UN carácter con su código U+1F600', () => {
  const p = prepararTexto('hola 😀');
  expect(p.segmentos.map((s) => s.visible).join('')).toBe('hola ?');
  expect([...p.sinGlifo.entries()]).toEqual([[0x1f600, 1]]);
});

test('prepararTexto: NUL y controles C0 (salvo tab y salto de línea) se eliminan y se cuentan; tab y \\n se conservan', () => {
  const p = prepararTexto('A\u0000B\u0007C\tD\nE\u007fF');
  expect(p.segmentos.map((s) => s.visible).join('')).toBe('ABC\tD\nEF');
  expect(p.controles.get(0)).toBe(1);
  expect(p.controles.get(7)).toBe(1);
  expect(p.controles.get(0x7f)).toBe(1);
  expect(p.controles.has(9)).toBe(false);
  expect(p.controles.has(10)).toBe(false);
});

test('prepararTexto: un texto que es solo NUL queda sin segmentos (no hay nada que escribir)', () => {
  const p = prepararTexto('\u0000');
  expect(p.segmentos).toEqual([]);
  expect(p.controles.get(0)).toBe(1);
});

test('prepararTexto: espacios Unicode y sin anchura no se pierden ni salen como ÿ (nbsp/em-space -> espacio; ZWSP/guion blando -> nada)', () => {
  const p = prepararTexto('a b c​d­e');
  expect(p.segmentos.map((s) => s.visible).join('')).toBe('a b cde');
  expect(p.sinGlifo.size).toBe(0);
});

test('prepararTexto: las ligaduras tipográficas se expanden a letras y la descomposición NFD se recompone', () => {
  expect(prepararTexto('ﬁn ﬂor').segmentos.map((s) => s.visible).join('')).toBe('fin flor');
  const p = prepararTexto('é');
  expect(p.segmentos.map((s) => s.visible).join('')).toBe('é');
  expect(p.sinGlifo.size).toBe(0);
});

test('advertenciasCodificacion: lista únicos con U+XXXX y veces, máximo 20, tipo omitido y código caracteresSinFuente', () => {
  const sinGlifo = new Map<number, number>();
  for (let i = 0; i < 25; i++) sinGlifo.set(0x4e00 + i, i + 1);
  const [a] = advertenciasCodificacion(sinGlifo, new Map());
  expect(a!.tipo).toBe('omitido');
  expect(a!.codigo).toBe('caracteresSinFuente');
  expect(a!.caracteres).toHaveLength(20);
  expect(a!.caracteres![0]).toEqual({ caracter: '一', codigo: 'U+4E00', veces: 1 });
  expect(a!.mensaje).toContain('U+4E00');
  expect(a!.mensaje).toContain('5 más');
  expect(a!.mensaje).toContain('325'); // total de apariciones: 1+2+...+25
});

test('advertenciasCodificacion: sin nada que avisar no devuelve nada; los controles tienen su propio aviso', () => {
  expect(advertenciasCodificacion(new Map(), new Map())).toEqual([]);
  const [c] = advertenciasCodificacion(new Map(), new Map([[0, 2]]));
  expect(c!.tipo).toBe('omitido');
  expect(c!.codigo).toBe('caracteresControl');
  expect(c!.mensaje).toContain('U+0000');
});

test('CodificadorTexto.prepararTrazos: parte el trazo por fuente, avanza X con la anchura de cada tramo y marca ActualText solo donde hay sustitución', () => {
  const medidas: string[] = [];
  const cod = new CodificadorTexto((font, size, t) => { medidas.push(`${font}|${t}`); return t.length * 10; });
  const salida = cod.prepararTrazos([
    { page: 0, xPt: 100, yPt: 700, text: 'ab αβ cЖ', font: 'Helvetica', sizePt: 12, color: [0, 0, 0] as [number, number, number] }
  ]);
  expect(salida.map((t) => [t.font, t.text, t.xPt])).toEqual([
    ['Helvetica', 'ab ', 100],
    [FUENTE_SIMBOLOS, 'αβ', 130],
    ['Helvetica', ' c?', 150]
  ]);
  expect(salida.map((t) => t.actualText)).toEqual([undefined, undefined, ' cЖ']);
  expect(MARCADOR_SIN_GLIFO).toBe('?');
  expect(cod.advertencias().map((a) => a.codigo)).toEqual(['caracteresSinFuente']);
});

test('CodificadorTexto.prepararTrazos: descarta los trazos que quedan vacíos (solo NUL) y los avisa', () => {
  const cod = new CodificadorTexto(() => 5);
  const salida = cod.prepararTrazos([{ page: 0, xPt: 1, yPt: 1, text: '\u0000\u0000', font: 'Helvetica', sizePt: 10, color: [0, 0, 0] as [number, number, number] }]);
  expect(salida).toEqual([]);
  expect(cod.advertencias().map((a) => a.codigo)).toEqual(['caracteresControl']);
});

test('CodificadorTexto.medir: mide cada tramo con su fuente y coincide con la suma de prepararTrazos', () => {
  const cod = new CodificadorTexto((font, _s, t) => (font === FUENTE_SIMBOLOS ? 7 : font === FUENTE_DINGBATS ? 9 : 3) * t.length);
  expect(cod.medir('Helvetica', 12, 'ab')).toBe(6);
  expect(cod.medir('Helvetica', 12, 'aαb')).toBe(3 + 7 + 3);
  expect(cod.medir('Helvetica', 12, 'a✓')).toBe(3 + 9);
  expect(cod.medir('Helvetica', 12, '\u0000')).toBe(0);
});
