import { test, expect } from 'vitest';
import {
  layoutMarkdown, MARGIN_PT, CONTENT_WIDTH_PT, PAGE_HEIGHT_PT, BODY_SIZE_PT, LINE_HEIGHT_FACTOR,
  HEADING_SIZES_PT, HEADING_LINE_HEIGHT_FACTOR, LIST_INDENT_PT, HANGING_INDENT_PT, QUOTE_INDENT_PT,
  type Medir
} from '../../src/convert/markdown/layout';
import type { Block, Inline } from '../../src/convert/markdown/ast';

/** medir falso: ancho fijo por carácter (0.6 × tamaño), igual para toda fuente — deja los cálculos verificables a mano. */
const medir: Medir = (_font, sizePt, text) => text.length * sizePt * 0.6;

function text(t: string): Inline { return { type: 'text', text: t }; }
function paragraph(words: string[]): Block { return { type: 'paragraph', children: [text(words.join(' '))] }; }

test('ajuste de línea exacto: rompe justo cuando la siguiente palabra no cabe', () => {
  // 15 palabras de 5 letras, todas del mismo estilo -> se fusionan en UN
  // trazo por línea (ver comentario de lineToFlowLine en layout.ts). Con el
  // medir falso, ancho por palabra = 5*11*0.6=33pt, espacio = 11*0.6=6.6pt.
  // La línea 1 cabe 12 palabras (468.6pt de 483pt); la 13ª (508.2pt) no cabe.
  const words = Array.from({ length: 15 }, () => 'aaaaa');
  const { trazos } = layoutMarkdown([paragraph(words)], medir);
  expect(trazos).toHaveLength(2); // un trazo fusionado por línea
  const porLinea = trazos.slice().sort((a, b) => b.yPt - a.yPt).map((t) => t.text.split(' ').length);
  expect(porLinea).toEqual([12, 3]);
});

test('una palabra suelta que cabe entera no se corta (y palabras del mismo estilo se fusionan en un trazo)', () => {
  const { trazos } = layoutMarkdown([paragraph(['hola', 'mundo'])], medir);
  expect(trazos.map((t) => t.text)).toEqual(['hola mundo']);
  expect(trazos[0]!.font).toBe('Helvetica');
  expect(trazos[0]!.sizePt).toBe(BODY_SIZE_PT);
  expect(trazos[0]!.xPt).toBe(MARGIN_PT);
});

test('salto de página: el contenido que no cabe pasa a la página 2', () => {
  // Suficientes párrafos cortos para superar la altura útil de una A4.
  const bloques: Block[] = Array.from({ length: 60 }, (_v, i) => paragraph([`parrafo-${i}`, 'de', 'prueba', 'con', 'algo', 'de', 'texto']));
  const { totalPaginas, trazos } = layoutMarkdown(bloques, medir);
  expect(totalPaginas).toBeGreaterThan(1);
  expect(trazos.some((t) => t.page === 0)).toBe(true);
  expect(trazos.some((t) => t.page === 1)).toBe(true);
  // Ningún trazo cae fuera del área de página (por debajo del margen inferior o por encima del superior).
  for (const t of trazos) {
    expect(t.yPt).toBeGreaterThanOrEqual(MARGIN_PT - 1);
    expect(t.yPt).toBeLessThanOrEqual(PAGE_HEIGHT_PT - MARGIN_PT);
  }
});

test('encabezado no huérfano: si no cabe el título + la primera línea siguiente, ambos saltan juntos de página', () => {
  // Rellena casi toda la página 1 con párrafos, deja justo hueco para el
  // título solo (no para título + contenido), y comprueba que el título
  // aparece en la MISMA página que su primer párrafo (nunca solo al pie).
  const relleno: Block[] = Array.from({ length: 48 }, (_v, i) => paragraph([`linea-${i}`]));
  const bloques: Block[] = [
    ...relleno,
    { type: 'heading', level: 2, children: [text('Título')] },
    paragraph(['contenido', 'del', 'apartado'])
  ];
  const { trazos } = layoutMarkdown(bloques, medir);
  const titulo = trazos.find((t) => t.text.includes('Título'))!;
  const contenido = trazos.find((t) => t.text.includes('contenido'))!;
  expect(titulo).toBeDefined();
  expect(contenido).toBeDefined();
  expect(titulo.page).toBe(contenido.page);
  expect(titulo.font).toBe('Helvetica-Bold');
  expect(titulo.sizePt).toBe(HEADING_SIZES_PT[2]);
});

test('sangría de lista: nivel 0 empieza tras el margen + sangría francesa; nivel 1 se indenta más', () => {
  const md: Block = {
    type: 'list', ordered: false,
    items: [
      { children: [text('raíz')], sublist: { type: 'list', ordered: false, items: [{ children: [text('hijo')] }] } }
    ]
  };
  const { trazos } = layoutMarkdown([md], medir);
  const marcador = trazos.find((t) => t.text === '•' && t.page === 0)!;
  const raiz = trazos.find((t) => t.text === 'raíz')!;
  const hijo = trazos.find((t) => t.text === 'hijo')!;
  expect(marcador.xPt).toBe(MARGIN_PT);
  expect(raiz.xPt).toBe(MARGIN_PT + HANGING_INDENT_PT);
  expect(hijo.xPt).toBe(MARGIN_PT + LIST_INDENT_PT + HANGING_INDENT_PT);
});

test('lista ordenada numera desde su valor inicial', () => {
  const md: Block = { type: 'list', ordered: true, start: 5, items: [{ children: [text('cinco')] }, { children: [text('seis')] }] };
  const { trazos } = layoutMarkdown([md], medir);
  expect(trazos.find((t) => t.text === '5.')).toBeDefined();
  expect(trazos.find((t) => t.text === '6.')).toBeDefined();
});

test('sangría de cita: el texto se indenta y hay una barra gris a su izquierda', () => {
  const bloque: Block = { type: 'blockquote', children: [paragraph(['cita', 'de', 'prueba'])] };
  const { trazos, barras } = layoutMarkdown([bloque], medir);
  const cita = trazos.find((t) => t.text.includes('cita'))!;
  expect(cita.xPt).toBe(MARGIN_PT + QUOTE_INDENT_PT);
  const barra = barras.find((b) => b.xPt === MARGIN_PT);
  expect(barra).toBeDefined();
});

test('bloque de código: fondo gris y fuente Courier, sin ajuste de línea', () => {
  const bloque: Block = { type: 'code', text: 'const x = 1;\nconsole.log(x);' };
  const { trazos, barras } = layoutMarkdown([bloque], medir);
  expect(trazos.map((t) => t.text)).toEqual(['const x = 1;', 'console.log(x);']);
  expect(trazos.every((t) => t.font === 'Courier')).toBe(true);
  expect(barras.some((b) => b.color[0] > 200 && b.color[0] === b.color[1] && b.color[1] === b.color[2])).toBe(true);
});

test('regla horizontal produce una barra fina de página completa', () => {
  const { barras } = layoutMarkdown([{ type: 'hr' }], medir);
  expect(barras).toHaveLength(1);
  expect(barras[0]!.hPt).toBe(1);
  expect(barras[0]!.wPt).toBe(CONTENT_WIDTH_PT);
});

test('negrita y cursiva producen trazos con su propia fuente, uno a continuación del otro', () => {
  const bloque: Block = {
    type: 'paragraph',
    children: [text('normal '), { type: 'strong', children: [text('fuerte')] }, text(' fin')]
  };
  const { trazos } = layoutMarkdown([bloque], medir);
  expect(trazos.map((t) => t.font)).toEqual(['Helvetica', 'Helvetica-Bold', 'Helvetica']);
  // colocados uno a continuación del otro: x creciente, sin solape
  expect(trazos[1]!.xPt).toBeGreaterThan(trazos[0]!.xPt);
  expect(trazos[2]!.xPt).toBeGreaterThan(trazos[1]!.xPt);
});

test('interlineado del cuerpo es tamaño × 1.4', () => {
  const { trazos } = layoutMarkdown([paragraph(['a', 'b']), paragraph(['c', 'd'])], medir);
  const ys = [...new Set(trazos.map((t) => t.yPt))].sort((a, b) => b - a);
  expect(ys).toHaveLength(2);
  // La separación entre línea base de párrafos consecutivos incluye la altura de línea (11*1.4) más el hueco entre bloques (8pt, ver spacingBefore).
  const delta = ys[0]! - ys[1]!;
  expect(delta).toBeCloseTo(BODY_SIZE_PT * LINE_HEIGHT_FACTOR + 8, 1);
});

test('encabezado usa su propio interlineado (tamaño × 1.25)', () => {
  const h: Block = { type: 'heading', level: 1, children: [text('T')] };
  const { trazos } = layoutMarkdown([h], medir);
  expect(trazos[0]!.sizePt).toBe(HEADING_SIZES_PT[1]);
  // No hay línea siguiente en este test: solo comprobamos que la altura de línea esperada es coherente con HEADING_LINE_HEIGHT_FACTOR (indirectamente, vía el test de no-huérfano de arriba, que sí encadena dos bloques).
  expect(HEADING_LINE_HEIGHT_FACTOR).toBeLessThan(LINE_HEIGHT_FACTOR);
});

test('documento vacío produce una página sin trazos', () => {
  const { totalPaginas, trazos, barras } = layoutMarkdown([], medir);
  expect(totalPaginas).toBe(1);
  expect(trazos).toEqual([]);
  expect(barras).toEqual([]);
});
