import { test, expect } from 'vitest';
import { layoutMarkdown, CONTENT_WIDTH_PT, MARGIN_PT, type Medir } from '../../src/convert/markdown/layout';
import { parseMarkdown } from '../../src/convert/markdown/parse';

/** E-119: maquetación de los elementos que antes se perdían o salían mal. `medir` falso: 0,6 × tamaño por carácter. */
const medir: Medir = (_f, sizePt, t) => t.length * sizePt * 0.6;
const lay = (md: string, imagenes?: Map<string, { width: number; height: number }>) => layoutMarkdown(parseMarkdown(md), medir, imagenes ? { imagenes } : undefined);
const textos = (r: ReturnType<typeof lay>): string => r.trazos.map((t) => t.text).join('|');

test('el maquetador conserva emoji y CJK tal cual y no avisa: la sustitución por "?" y el aviso caracteresSinFuente son de CodificadorTexto (E-120)', () => {
  const r = lay('Hola 😀 y 漢字 fin');
  expect(textos(r)).toContain('😀');
  expect(textos(r)).toContain('漢字');
  expect(r.advertencias.filter((a) => /caracter|carácter/i.test(a.mensaje))).toEqual([]);
});

test('texto europeo con acentos y comillas tipográficas no avisa', () => {
  const r = lay('áéíóú ñ ü “comillas” — € …');
  expect(r.advertencias).toEqual([]);
});

test('salto duro: cada br empieza una línea nueva', () => {
  const r = lay('uno  \ndos');
  const ys = new Set(r.trazos.map((t) => t.yPt));
  expect(ys.size).toBe(2);
  expect(textos(r)).toBe('uno|dos');
});

test('tachado: se dibuja una barra por el trazo tachado', () => {
  const sin = lay('a b c');
  const con = lay('a ~~b~~ c');
  expect(con.barras.length).toBeGreaterThan(sin.barras.length);
});

test('encabezados: se registran con id (slug), nivel y página; los repetidos llevan sufijo', () => {
  const r = lay('# Hola Mundo\n\n## Hola Mundo\n\n### ¿Qué tal?');
  expect(r.titulos.map((t) => [t.nivel, t.texto, t.id, t.page])).toEqual([
    [1, 'Hola Mundo', 'hola-mundo', 0], [2, 'Hola Mundo', 'hola-mundo-1', 0], [3, '¿Qué tal?', 'qué-tal', 0]
  ]);
});

test('enlace interno #id se resuelve a la página y altura del encabezado y no avisa', () => {
  const r = lay('# Uno\n\n[ir](#uno)');
  expect(r.enlacesInternos).toHaveLength(1);
  const e = r.enlacesInternos[0]!;
  expect(e.destPage).toBe(0);
  expect(e.destYPt).toBeGreaterThan(700);
  expect(r.advertencias).toEqual([]);
  expect(r.enlaces).toEqual([]);
});

test('enlace interno a un ancla inexistente avisa (aproximado) y conserva el texto', () => {
  const r = lay('[ir](#nada)');
  expect(r.enlacesInternos).toEqual([]);
  expect(r.advertencias.some((a) => a.tipo === 'aproximado' && a.mensaje.includes('#nada'))).toBe(true);
  expect(textos(r)).toContain('ir');
});

test('el enlace interno sigue la altura real si el encabezado cae en la página 2', () => {
  const relleno = Array.from({ length: 70 }, (_v, i) => `parrafo ${i}`).join('\n\n');
  const r = lay(`[ir](#final)\n\n${relleno}\n\n# Final`);
  expect(r.enlacesInternos[0]!.destPage).toBeGreaterThan(0);
});

test('HTML en línea: se muestra como texto y avisa una vez (aproximado)', () => {
  const r = lay('a <b>x</b> y <script>alert(1)</script>');
  expect(textos(r)).toContain('<b>');
  expect(r.advertencias.filter((a) => /HTML/.test(a.mensaje))).toHaveLength(1);
});

test('tabla: una fila de página por fila de tabla, celdas alineadas y cabecera repetible', () => {
  const r = lay('| A | B |\n|---|--:|\n| 1 | 2 |\n| 3 | 4 |');
  const t = r.trazos.map((x) => x.text);
  expect(t).toEqual(expect.arrayContaining(['A', 'B', '1', '2', '3', '4']));
  const a = r.trazos.find((x) => x.text === 'A')!;
  const b = r.trazos.find((x) => x.text === 'B')!;
  expect(b.xPt).toBeGreaterThan(a.xPt);
  expect(a.font).toBe('Helvetica-Bold');
  expect(a.xPt).toBeGreaterThanOrEqual(MARGIN_PT);
  // alineación derecha: el "2" termina en el borde derecho de su columna, más a la derecha que el "1"
  const dos = r.trazos.find((x) => x.text === '2')!;
  const uno = r.trazos.find((x) => x.text === '1')!;
  expect(dos.xPt).toBeGreaterThan(uno.xPt);
  expect(r.barras.length).toBeGreaterThan(0); // bordes
  expect(Math.max(...r.trazos.map((x) => x.xPt))).toBeLessThan(MARGIN_PT + CONTENT_WIDTH_PT);
});

test('tabla con muchas columnas y texto largo no se sale del margen', () => {
  const fila = Array.from({ length: 8 }, (_v, i) => `columna${i} con texto largo largo`).join(' | ');
  const r = lay(`| ${fila} |\n|${'---|'.repeat(8)}\n| ${fila} |`);
  const maxDer = Math.max(...r.trazos.map((t) => t.xPt + medir(t.font, t.sizePt, t.text)));
  expect(maxDer).toBeLessThanOrEqual(MARGIN_PT + CONTENT_WIDTH_PT + 1);
});

test('lista de tareas: el marcador es [ ] / [x] en vez de viñeta', () => {
  const r = lay('- [ ] a\n- [x] b');
  expect(r.trazos.map((t) => t.text)).toEqual(expect.arrayContaining(['[ ]', '[x]']));
  expect(r.trazos.some((t) => t.text === '•')).toBe(false);
});

test('lista suelta separa más los ítems que la compacta', () => {
  const alto = (r: ReturnType<typeof lay>): number => Math.max(...r.trazos.map((t) => t.yPt)) - Math.min(...r.trazos.map((t) => t.yPt));
  expect(alto(lay('- a\n\n- b\n\n- c'))).toBeGreaterThan(alto(lay('- a\n- b\n- c')));
});

test('línea de código más ancha que el margen se parte en vez de salirse', () => {
  const r = lay('```\n' + 'x'.repeat(300) + '\n```');
  const maxDer = Math.max(...r.trazos.map((t) => t.xPt + medir(t.font, t.sizePt, t.text)));
  expect(maxDer).toBeLessThanOrEqual(MARGIN_PT + CONTENT_WIDTH_PT + 1);
  expect(r.trazos.map((t) => t.text).join('')).toBe('x'.repeat(300));
});

test('imagen data: se coloca escalada al ancho útil; remota/relativa muestra su alt y avisa omitido', () => {
  const imgs = new Map([['data:image/png;base64,AAAA', { width: 2000, height: 1000 }]]);
  const r = lay('![uno](data:image/png;base64,AAAA)\n\n![dos](./x.png)', imgs);
  expect(r.imagenes).toHaveLength(1);
  const im = r.imagenes[0]!;
  expect(im.wPt).toBeLessThanOrEqual(CONTENT_WIDTH_PT);
  expect(im.hPt / im.wPt).toBeCloseTo(0.5, 2);
  expect(textos(r)).toContain('dos');
  expect(r.advertencias.some((a) => a.tipo === 'omitido' && a.mensaje.includes('./x.png'))).toBe(true);
});

test('notas al pie: referencia superíndice enlazada y lista de notas al final con su texto', () => {
  const r = lay('Texto[^1].\n\n[^1]: La nota.');
  expect(textos(r)).toContain('La nota.');
  expect(r.enlacesInternos.length).toBeGreaterThanOrEqual(1);
  const refTrazo = r.trazos.find((t) => t.text === '1' && t.sizePt < 11);
  expect(refTrazo).toBeDefined();
});

test('una palabra más ancha que la línea (URL larga) se parte en vez de salirse del margen', () => {
  const r = lay('x ' + 'a'.repeat(400) + ' y');
  const maxDer = Math.max(...r.trazos.map((t) => t.xPt + medir(t.font, t.sizePt, t.text)));
  expect(maxDer).toBeLessThanOrEqual(MARGIN_PT + CONTENT_WIDTH_PT + 1);
  expect(r.trazos.map((t) => t.text).join('').replace(/\s/g, '')).toBe('x' + 'a'.repeat(400) + 'y');
});

test('la coma tras una negrita va pegada (no "negrita ,")', () => {
  const r = lay('**negrita**, resto');
  expect(r.trazos.map((t) => t.text).join('|')).toBe('negrita|, resto');
  const neg = r.trazos[0]!;
  const coma = r.trazos[1]!;
  expect(coma.xPt).toBeCloseTo(neg.xPt + medir(neg.font, neg.sizePt, neg.text), 5);
});
