import { test, expect } from 'vitest';
import { parseMarkdown } from '../../src/convert/markdown/parse';
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

test('entrada hostil: 100000 asteriscos termina rápido y sin excepción', () => {
  const md = '*'.repeat(100000);
  const inicio = Date.now();
  expect(() => parseMarkdown(md)).not.toThrow();
  expect(Date.now() - inicio).toBeLessThan(1000);
});

test('entrada hostil: 10000 ">" anidados termina rápido y sin excepción', () => {
  const md = '>'.repeat(10000) + ' texto';
  const inicio = Date.now();
  expect(() => parseMarkdown(md)).not.toThrow();
  expect(Date.now() - inicio).toBeLessThan(1000);
});

test('entrada hostil: una línea gigante no cuelga el parser', () => {
  const md = 'palabra '.repeat(200000);
  const inicio = Date.now();
  expect(() => parseMarkdown(md)).not.toThrow();
  expect(Date.now() - inicio).toBeLessThan(1000);
});
