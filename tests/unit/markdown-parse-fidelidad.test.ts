import { test, expect } from 'vitest';
import { parseMarkdown, parseInline } from '../../src/convert/markdown/parse';
import type { Block, Inline } from '../../src/convert/markdown/ast';

/** E-119: fidelidad del parser frente a CommonMark/GFM. Cada test cubre un elemento que se perdía o salía mal. */

const txt = (t: string): Inline => ({ type: 'text', text: t });
const plano = (ins: Inline[]): string => ins.map((n) => (n.type === 'text' ? n.text : n.type === 'br' ? '\n' : n.type === 'strong' || n.type === 'em' || n.type === 'del' ? plano(n.children) : n.type === 'code' ? n.text : n.type === 'link' ? n.text : n.type === 'image' ? `![${n.alt}]` : `[^${n.id}]`)).join('');

test('encabezado setext: === es nivel 1 y --- es nivel 2 (no un párrafo ni una regla)', () => {
  const b = parseMarkdown('Titulo uno\n==========\n\nTitulo dos\n----------\n\ntexto');
  expect(b.map((x) => x.type)).toEqual(['heading', 'heading', 'paragraph']);
  expect((b[0] as Extract<Block, { type: 'heading' }>).level).toBe(1);
  expect((b[1] as Extract<Block, { type: 'heading' }>).level).toBe(2);
});

test('--- tras línea en blanco sigue siendo regla horizontal', () => {
  expect(parseMarkdown('texto\n\n---\n\notro').map((x) => x.type)).toEqual(['paragraph', 'hr', 'paragraph']);
});

test('salto duro: dos espacios o barra invertida al final de línea producen br; un salto simple es espacio', () => {
  const b = parseMarkdown('uno  \ndos\\\ntres\ncuatro');
  const p = b[0] as Extract<Block, { type: 'paragraph' }>;
  expect(p.children.filter((n) => n.type === 'br')).toHaveLength(2);
  expect(plano(p.children)).toBe('uno\ndos\ntres cuatro');
});

test('escapes: \\* \\_ \\# \\[ se vuelven el carácter literal', () => {
  expect(parseInline('\\*no cursiva\\* y \\[no enlace\\]')).toEqual([txt('*no cursiva* y [no enlace]')]);
});

test('entidades: nombradas y numéricas se decodifican; una desconocida queda literal; en código no se tocan', () => {
  expect(plano(parseInline('a &amp; b &lt;c&gt; &copy; &#233; &#x41; &noexiste; `&amp;`'))).toBe('a & b <c> © é A &noexiste; &amp;');
});

test('tachado ~~x~~ produce del', () => {
  expect(parseInline('a ~~b~~ c')).toEqual([txt('a '), { type: 'del', children: [txt('b')] }, txt(' c')]);
});

test('***x*** es negrita+cursiva sin asteriscos sueltos', () => {
  expect(plano(parseInline('***ambas***'))).toBe('ambas');
  const n = parseInline('***ambas***');
  expect(n).toEqual([{ type: 'strong', children: [{ type: 'em', children: [txt('ambas')] }] }]);
});

test('guion bajo dentro de una palabra y asteriscos con espacios no son énfasis', () => {
  expect(parseInline('snake_case_name y 2 * 3 * 4')).toEqual([txt('snake_case_name y 2 * 3 * 4')]);
});

test('enlace con paréntesis balanceados y título opcional', () => {
  const n = parseInline('[w](https://es.wikipedia.org/wiki/Foo_(bar) "titulo")');
  expect(n).toEqual([{ type: 'link', text: 'w', url: 'https://es.wikipedia.org/wiki/Foo_(bar)' }]);
});

test('enlace con formato dentro conserva los hijos', () => {
  const n = parseInline('[**fuerte** y `c`](https://e.com)')[0] as Extract<Inline, { type: 'link' }>;
  expect(n.type).toBe('link');
  expect(n.children).toBeDefined();
  expect(plano(n.children!)).toBe('fuerte y c');
});

test('enlaces de referencia completos, colapsados y atajo, con la definición fuera del texto', () => {
  const b = parseMarkdown('ver [uno][a], [b][] y [c]\n\n[a]: https://a.example/\n[B]: <https://b.example/x> "t"\n[c]: https://c.example/');
  expect(b).toHaveLength(1);
  const p = b[0] as Extract<Block, { type: 'paragraph' }>;
  const links = p.children.filter((n): n is Extract<Inline, { type: 'link' }> => n.type === 'link');
  expect(links.map((l) => l.url)).toEqual(['https://a.example/', 'https://b.example/x', 'https://c.example/']);
});

test('referencia sin definición queda como texto literal', () => {
  expect(parseInline('un [x][nada] y [y]')).toEqual([txt('un [x][nada] y [y]')]);
});

test('autoenlaces <url>, <correo> y URL desnuda (sin la puntuación final)', () => {
  const n = parseInline('<https://auto.example.org> <a@b.co> y https://bare.example.net/p.');
  const links = n.filter((x): x is Extract<Inline, { type: 'link' }> => x.type === 'link');
  expect(links.map((l) => l.url)).toEqual(['https://auto.example.org', 'mailto:a@b.co', 'https://bare.example.net/p']);
  expect(plano(n).endsWith('.')).toBe(true);
});

test('imagen ![alt](src) produce un nodo image (ya no "!" + enlace)', () => {
  expect(parseInline('![logo](./a.png "t")')).toEqual([{ type: 'image', alt: 'logo', src: './a.png' }]);
});

test('imagen dentro de un enlace (insignia) se conserva como hijo del enlace', () => {
  const n = parseInline('[![ci](https://x/y.svg)](https://x)')[0] as Extract<Inline, { type: 'link' }>;
  expect(n.type).toBe('link');
  expect(n.children?.[0]).toEqual({ type: 'image', alt: 'ci', src: 'https://x/y.svg' });
});

test('tabla GFM: cabecera, alineación y filas (con celdas faltantes rellenas y pipe escapado)', () => {
  const b = parseMarkdown('| A | B | C |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n| x \\| y |\n\nfin');
  expect(b.map((x) => x.type)).toEqual(['table', 'paragraph']);
  const t = b[0] as Extract<Block, { type: 'table' }>;
  expect(t.align).toEqual(['left', 'center', 'right']);
  expect(t.header.map(plano)).toEqual(['A', 'B', 'C']);
  expect(t.rows).toHaveLength(2);
  expect(t.rows[1]!.map(plano)).toEqual(['x | y', '', '']);
});

test('una sola línea con pipes sin fila delimitadora NO es tabla', () => {
  expect(parseMarkdown('a | b | c').map((x) => x.type)).toEqual(['paragraph']);
});

test('lista de tareas: [ ] y [x] marcan el ítem y no quedan en el texto', () => {
  const l = parseMarkdown('- [ ] pendiente\n- [x] hecha\n- normal')[0] as Extract<Block, { type: 'list' }>;
  expect(l.items.map((i) => i.task)).toEqual([false, true, undefined]);
  expect(plano(l.items[0]!.children)).toBe('pendiente');
});

test('lista suelta (líneas en blanco entre ítems) es UNA lista con loose; la compacta no', () => {
  const suelta = parseMarkdown('- a\n\n- b\n\n- c');
  expect(suelta).toHaveLength(1);
  const l = suelta[0] as Extract<Block, { type: 'list' }>;
  expect(l.items).toHaveLength(3);
  expect(l.loose).toBe(true);
  const compacta = parseMarkdown('- a\n- b')[0] as Extract<Block, { type: 'list' }>;
  expect(compacta.loose).toBeFalsy();
});

test('lista ordenada suelta conserva el start y no reinicia numeración', () => {
  const l = parseMarkdown('3. a\n\n4. b')[0] as Extract<Block, { type: 'list' }>;
  expect(l.start).toBe(3);
  expect(l.items).toHaveLength(2);
});

test('continuación de ítem: la línea sangrada o perezosa forma parte del ítem, no un párrafo aparte', () => {
  const b = parseMarkdown('- primero\n  sigue aqui\n- segundo');
  expect(b).toHaveLength(1);
  const l = b[0] as Extract<Block, { type: 'list' }>;
  expect(plano(l.items[0]!.children)).toBe('primero sigue aqui');
});

test('código indentado (4 espacios) es un bloque de código', () => {
  const b = parseMarkdown('texto\n\n    uno\n    dos\n\nfin');
  expect(b.map((x) => x.type)).toEqual(['paragraph', 'code', 'paragraph']);
  expect((b[1] as Extract<Block, { type: 'code' }>).text).toBe('uno\ndos');
});

test('continuación perezosa de cita: la línea sin > pertenece a la cita', () => {
  const b = parseMarkdown('> uno\ndos');
  expect(b).toHaveLength(1);
  expect(b[0]!.type).toBe('blockquote');
});

test('notas al pie: la referencia es un nodo footnote y la definición va al final numerada por primera referencia', () => {
  const b = parseMarkdown('Texto[^b] y otra[^a].\n\n[^a]: Nota A.\n[^b]: Nota B.');
  expect(b).toHaveLength(2);
  const p = b[0] as Extract<Block, { type: 'paragraph' }>;
  expect(p.children.filter((n) => n.type === 'footnote')).toHaveLength(2);
  const f = b[1] as Extract<Block, { type: 'footnotes' }>;
  expect(f.type).toBe('footnotes');
  expect(f.items.map((i) => i.id)).toEqual(['b', 'a']);
  expect(plano(f.items[0]!.children)).toBe('Nota B.');
});

test('referencia a nota inexistente queda literal', () => {
  expect(parseInline('x[^9]')).toEqual([txt('x[^9]')]);
});

test('una definición dentro de un bloque de código NO se interpreta', () => {
  const b = parseMarkdown('```\n[a]: https://x.example/\n```');
  expect(b).toHaveLength(1);
  expect((b[0] as Extract<Block, { type: 'code' }>).text).toBe('[a]: https://x.example/');
});

test('HTML en línea sigue siendo texto literal (nunca se interpreta)', () => {
  expect(plano(parseInline('a <b>negro</b> <script>x</script>'))).toBe('a <b>negro</b> <script>x</script>');
});
