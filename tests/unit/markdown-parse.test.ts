import { test, expect } from 'vitest';
import { parseMarkdown, parseInline, MAX_BLOCKQUOTE_DEPTH, MAX_INLINE_STEPS } from '../../src/convert/markdown/parse';
import type { Block, Inline } from '../../src/convert/markdown/ast';

function text(t: string): Inline { return { type: 'text', text: t }; }

test('encabezados: niveles 1 a 6 con su contenido en línea', () => {
  const ast = parseMarkdown('# Uno\n\n###### Seis\n\n### Tres con **negrita**');
  expect(ast).toHaveLength(3);
  expect(ast[0]).toEqual({ type: 'heading', level: 1, children: [text('Uno')] });
  expect(ast[1]).toEqual({ type: 'heading', level: 6, children: [text('Seis')] });
  const h3 = ast[2] as Extract<Block, { type: 'heading' }>;
  expect(h3.level).toBe(3);
  expect(h3.children[0]).toEqual(text('Tres con '));
  expect(h3.children[1]).toEqual({ type: 'strong', children: [text('negrita')] });
});

test('párrafo multilínea se une en un solo bloque', () => {
  const ast = parseMarkdown('Esta es la primera línea\ny esta la segunda\ny la tercera.');
  expect(ast).toHaveLength(1);
  const p = ast[0] as Extract<Block, { type: 'paragraph' }>;
  expect(p.type).toBe('paragraph');
  expect(p.children).toEqual([text('Esta es la primera línea y esta la segunda y la tercera.')]);
});

test('dos párrafos separados por línea en blanco', () => {
  const ast = parseMarkdown('Primero.\n\nSegundo.');
  expect(ast).toHaveLength(2);
  expect(ast[0]!.type).toBe('paragraph');
  expect(ast[1]!.type).toBe('paragraph');
});

test('lista no ordenada anidada (hasta 3 niveles)', () => {
  const md = [
    '- uno',
    '  - uno.uno',
    '    - uno.uno.uno',
    '- dos'
  ].join('\n');
  const ast = parseMarkdown(md);
  expect(ast).toHaveLength(1);
  const l = ast[0] as Extract<Block, { type: 'list' }>;
  expect(l.type).toBe('list');
  expect(l.ordered).toBe(false);
  expect(l.items).toHaveLength(2);
  expect(l.items[0]!.children).toEqual([text('uno')]);
  const sub = l.items[0]!.sublist!;
  expect(sub.items).toHaveLength(1);
  expect(sub.items[0]!.children).toEqual([text('uno.uno')]);
  const subsub = sub.items[0]!.sublist!;
  expect(subsub.items[0]!.children).toEqual([text('uno.uno.uno')]);
  expect(l.items[1]!.children).toEqual([text('dos')]);
});

test('lista ordenada conserva el número inicial', () => {
  const ast = parseMarkdown('5. cinco\n6. seis');
  const l = ast[0] as Extract<Block, { type: 'list' }>;
  expect(l.ordered).toBe(true);
  expect(l.start).toBe(5);
  expect(l.items).toHaveLength(2);
});

test('cita simple y anidada', () => {
  const ast = parseMarkdown('> hola\n> mundo');
  expect(ast).toHaveLength(1);
  const q = ast[0] as Extract<Block, { type: 'blockquote' }>;
  expect(q.type).toBe('blockquote');
  expect(q.children).toHaveLength(1);
  expect(q.children[0]!.type).toBe('paragraph');
});

test('cita anidada (> >)', () => {
  const ast = parseMarkdown('> externa\n> > interna');
  const q = ast[0] as Extract<Block, { type: 'blockquote' }>;
  expect(q.children.some((b) => b.type === 'blockquote')).toBe(true);
});

test('bloque de código: el contenido NO se interpreta como Markdown', () => {
  const ast = parseMarkdown('```\n**esto no es negrita**\n# ni esto un título\n```');
  expect(ast).toHaveLength(1);
  expect(ast[0]).toEqual({ type: 'code', text: '**esto no es negrita**\n# ni esto un título', lang: undefined });
});

test('bloque de código con lenguaje', () => {
  const ast = parseMarkdown('```js\nconst x = 1;\n```');
  const c = ast[0] as Extract<Block, { type: 'code' }>;
  expect(c.lang).toBe('js');
  expect(c.text).toBe('const x = 1;');
});

test('regla horizontal', () => {
  const ast = parseMarkdown('---');
  expect(ast).toEqual([{ type: 'hr' }]);
  expect(parseMarkdown('***')).toEqual([{ type: 'hr' }]);
});

test('inlines combinados: negrita con cursiva anidada', () => {
  const ast = parseMarkdown('**negrita _y cursiva_**');
  const p = ast[0] as Extract<Block, { type: 'paragraph' }>;
  expect(p.children).toEqual([
    {
      type: 'strong',
      children: [text('negrita '), { type: 'em', children: [text('y cursiva')] }]
    }
  ]);
});

test('enlace: texto + url', () => {
  const ast = parseMarkdown('mira [este enlace](https://ejemplo.com/x) aquí');
  const p = ast[0] as Extract<Block, { type: 'paragraph' }>;
  expect(p.children).toEqual([
    text('mira '),
    { type: 'link', text: 'este enlace', url: 'https://ejemplo.com/x' },
    text(' aquí')
  ]);
});

test('código en línea no interpreta su contenido', () => {
  const ast = parseMarkdown('usa `**no negrita**` aquí');
  const p = ast[0] as Extract<Block, { type: 'paragraph' }>;
  expect(p.children).toEqual([text('usa '), { type: 'code', text: '**no negrita**' }, text(' aquí')]);
});

test('HTML embebido se trata como texto literal, nunca se interpreta', () => {
  const ast = parseMarkdown('antes <script>alert(1)</script> después');
  const p = ast[0] as Extract<Block, { type: 'paragraph' }>;
  const joined = p.children.map((n) => (n.type === 'text' ? n.text : '')).join('');
  expect(joined).toContain('<script>alert(1)</script>');
});

// ---------------------------------------------------------------------------
// Entrada hostil: no se aserta sobre tiempo de reloj (docs/TESTING.md — un
// umbral en milisegundos es frágil bajo carga y no prueba lo que dice
// proteger). Se aserta sobre el TRABAJO realizado: la forma acotada del
// resultado, o el presupuesto de pasos del analizador (MAX_INLINE_STEPS),
// que es el mecanismo real que impide que una entrada adversaria cuelgue el
// parser. Un hang genuino ya lo detiene el timeout por test de Vitest (red
// anti-cuelgue del propio runner, no hace falta una manual aquí).
// ---------------------------------------------------------------------------

test('entrada hostil: 100000 asteriscos consecutivos colapsan en UNA sola regla horizontal', () => {
  // RE_HR reconoce un run homogéneo de "*" como una única regla horizontal
  // en una pasada; no abre 100000 intentos de énfasis carácter a carácter.
  // Si una regresión rompiera esa clasificación y el run cayera en el
  // analizador inline, esta forma cambiaría (más de un bloque, u otro tipo).
  const ast = parseMarkdown('*'.repeat(100000));
  expect(ast).toEqual([{ type: 'hr' }]);
});

test('entrada hostil: 10000 ">" anidados se acotan a MAX_BLOCKQUOTE_DEPTH niveles de cita, no a 10000', () => {
  const ast = parseMarkdown('>'.repeat(10000) + ' texto');
  function profundidadDeCitas(blocks: Block[]): number {
    let max = 0;
    for (const b of blocks) {
      if (b.type === 'blockquote') max = Math.max(max, 1 + profundidadDeCitas(b.children));
    }
    return max;
  }
  // La recursión de parseBlocks() para citas está acotada por la constante,
  // no por el nº de ">" de la entrada: el trabajo es O(MAX_BLOCKQUOTE_DEPTH),
  // constante, nunca O(nº de ">").
  expect(profundidadDeCitas(ast)).toBe(MAX_BLOCKQUOTE_DEPTH);
});

test('entrada hostil: una línea de 1.6M caracteres se analiza con el presupuesto de pasos acotado (MAX_INLINE_STEPS), sin perder texto', () => {
  const md = 'palabra '.repeat(200000);
  const stats = { steps: 0 };
  const nodes = parseInline(md, stats);
  // El presupuesto de pasos del analizador NO crece con el tamaño de la
  // entrada: se agota en MAX_INLINE_STEPS y el resto del texto se copia de
  // un tirón (un solo slice), no carácter a carácter.
  expect(stats.steps).toBeLessThanOrEqual(MAX_INLINE_STEPS + 2);
  const total = nodes.map((n) => (n.type === 'text' ? n.text : '')).join('');
  expect(total).toBe(md); // ni un carácter se pierde al cortar por presupuesto
});

test('entrada hostil: "[" sin cerrar, repetido, no reescanea el resto de la cadena en cada posición (el patrón O(n²) real que acota MAX_INLINE_STEPS)', () => {
  // El patrón que SÍ sería O(n²) sin cota compartida: cada "[" sin "]" que
  // lo cierre fuerza a matchLink() a escanear hasta el final de la cadena
  // buscando el cierre, y un intento fallido solo avanza el cursor una
  // posición — n aperturas fallidas cuestan O(n) cada una. Medido sin el
  // presupuesto: 200 "[" cuestan ~20 100 pasos y 400 "[" (2×) cuestan
  // ~80 200 pasos (~4×, cuadrático). Con el presupuesto compartido, el
  // trabajo se satura en MAX_INLINE_STEPS y deja de crecer del todo, sin
  // importar cuánto crezca la entrada.
  const statsChico = { steps: 0 };
  parseInline('['.repeat(50000), statsChico);
  const statsGrande = { steps: 0 };
  parseInline('['.repeat(200000), statsGrande); // 4× el tamaño del anterior
  // +2 de margen: el presupuesto se comprueba tras incrementar (puede
  // agotarse un paso después de superar la cota exacta).
  expect(statsChico.steps).toBeLessThanOrEqual(MAX_INLINE_STEPS + 2);
  // Coste marginal ~0 al crecer la entrada 4×, no ~4× (que es lo que daría
  // la versión sin presupuesto compartido).
  expect(statsGrande.steps).toBe(statsChico.steps);
});
