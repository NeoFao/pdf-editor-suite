import { test, expect } from 'vitest';
import { construirModeloDocx } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';
import { textosAdvertencias } from '../../src/convert/advertencia';

/**
 * E-110: imagen en línea (`wp:inline`) dentro de una celda de tabla. Medida falsa: cada carácter ocupa `0,5 × tamaño` pt.
 * Unidades: pt de página; `yPt` de las imágenes es el borde INFERIOR con origen ABAJO-izquierda. EMU → pt: 12700 EMU = 1 pt.
 * Celdas de 150 pt (3000 twips): x de celda 72, 222...; interior desde x + 5 hasta x + 145 (140 pt); relleno vertical 5 pt.
 */
const medir = (_f: string, sz: number, s: string): number => s.length * sz * 0.5;
const REL = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/></Relationships>';
const emu = (pt: number): number => pt * 12700;
const SIN_ESP = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>';
const dibujo = (wPt: number, hPt: number, tipo: 'inline' | 'anchor' = 'inline') =>
  `<w:drawing><wp:${tipo}><wp:extent cx="${emu(wPt)}" cy="${emu(hPt)}"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:${tipo}></w:drawing>`;
const pImg = (wPt: number, hPt: number, jc = 'left', tipo: 'inline' | 'anchor' = 'inline') =>
  `<w:p><w:pPr>${SIN_ESP}<w:jc w:val="${jc}"/></w:pPr><w:r>${dibujo(wPt, hPt, tipo)}</w:r></w:p>`;
const pTxt = (t: string) => `<w:p><w:pPr>${SIN_ESP}</w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${t}</w:t></w:r></w:p>`;
const BORDES = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right'].map((l) => `<w:${l} w:val="single" w:sz="8" w:color="000000"/>`).join('') + '</w:tblBorders>';
const tabla = (celdas: string[], fijo = false) =>
  `<w:document><w:body><w:tbl><w:tblPr>${BORDES}${fijo ? '<w:tblLayout w:type="fixed"/>' : ''}</w:tblPr><w:tblGrid>${celdas.map(() => '<w:gridCol w:w="3000"/>').join('')}</w:tblGrid><w:tr>${celdas.map((c) => `<w:tc>${c}</w:tc>`).join('')}</w:tr></w:tbl></w:body></w:document>`;
const modelo = (xml: string) => construirModeloDocx(xml, null, null, REL);
const render = (xml: string) => renderizarModeloDocx(modelo(xml), medir);
const arriba = (r: ReturnType<typeof render>): number => Math.max(...r.barras.map((b) => b.yPt + b.hPt));
const abajo = (r: ReturnType<typeof render>): number => Math.min(...r.barras.map((b) => b.yPt));

test('una imagen inline en celda se dibuja con su tamaño de wp:extent (EMU / 12700 = pt), pegada al relleno superior, sin avisos', () => {
  const r = render(tabla([pImg(40, 20)]));
  expect(r.imagenes).toHaveLength(1);
  const im = r.imagenes[0]!;
  expect(im.imgId).toBe('word/media/a.png');
  expect(im.wPt).toBeCloseTo(40, 6);
  expect(im.hPt).toBeCloseTo(20, 6);
  expect(im.xPt).toBeCloseTo(77, 6); // izquierda: borde interior (72 + 5)
  expect(im.yPt + im.hPt).toBeCloseTo(arriba(r) - 5, 6); // relleno superior de 5 pt
  expect(textosAdvertencias(r.advertencias)).toEqual([]);
});

test('la alineación del párrafo de la celda coloca la imagen: centro y derecha dentro del ancho interior (140 pt)', () => {
  const r = render(tabla([pImg(40, 20, 'center'), pImg(40, 20, 'right')]));
  const [c, d] = [...r.imagenes].sort((a, b) => a.xPt - b.xPt);
  expect(c!.xPt).toBeCloseTo(77 + (140 - 40) / 2, 6);
  expect(d!.xPt).toBeCloseTo(222 + 5 + 140 - 40, 6);
});

test('una imagen más ancha que el interior se escala proporcionalmente a 140 pt (sin aviso con ancho de columna automático)', () => {
  const r = render(tabla([pImg(420, 210)]));
  const im = r.imagenes[0]!;
  expect(im.wPt).toBeCloseTo(140, 6);
  expect(im.hPt).toBeCloseTo(70, 6);
  expect(im.xPt).toBeCloseTo(77, 6);
  expect(textosAdvertencias(r.advertencias)).toEqual([]);
});

test('con columnas de ancho FIJO (w:tblLayout fixed) la imagen escalada se avisa como aproximado', () => {
  const r = render(tabla([pImg(420, 210)], true));
  expect(r.imagenes[0]!.wPt).toBeCloseTo(140, 6);
  expect(r.advertencias.filter((a) => a.tipo === 'aproximado' && /imagen/i.test(a.mensaje))).toHaveLength(1);
  expect(r.advertencias.some((a) => a.tipo === 'omitido')).toBe(false);
  // Una imagen que cabe no avisa aunque la columna sea fija.
  expect(render(tabla([pImg(40, 20)], true)).advertencias).toEqual([]);
});

test('la altura de la fila crece con la imagen: max(contenido de las celdas) + 2 × 5 pt de relleno', () => {
  // Celda 1: imagen de 100 x 50 (cabe) => 50 + 10. Celda 2: 12 pt de texto. La fila mide 60.
  const r = render(tabla([pImg(100, 50), pTxt('hola')]));
  expect(arriba(r) - abajo(r)).toBeCloseTo(50 + 10, 6);
  // Imagen escalada: 420 x 210 => 140 x 70 => fila de 80.
  expect(arriba(render(tabla([pImg(420, 210)]))) - abajo(render(tabla([pImg(420, 210)])))).toBeCloseTo(70 + 10, 6);
});

test('texto + imagen + texto en la misma celda: cada bloque apilado y la fila suma sus alturas', () => {
  const r = render(tabla([pTxt('antes') + pImg(40, 20) + pTxt('despues')]));
  const im = r.imagenes[0]!;
  const antes = r.trazos.find((t) => t.text === 'antes')!;
  const despues = r.trazos.find((t) => t.text === 'despues')!;
  expect(antes.yPt).toBeGreaterThan(im.yPt + im.hPt - 1);
  expect(despues.yPt).toBeLessThan(im.yPt);
  expect(arriba(r) - abajo(r)).toBeCloseTo(12 + 20 + 12 + 10, 6);
});

test('una imagen flotante (wp:anchor) en celda sigue omitiéndose con aviso; la inline ya no avisa', () => {
  const xml = tabla([pImg(40, 20, 'left', 'anchor')]);
  expect(render(xml).imagenes).toHaveLength(0);
  // Este aviso nace al leer el modelo (no al maquetar).
  expect(modelo(xml).advertencias.filter((a) => a.tipo === 'omitido' && /imagen flotante/i.test(a.mensaje))).toHaveLength(1);
  expect(modelo(tabla([pImg(40, 20)])).advertencias).toEqual([]);
});

test('una imagen más alta que la página se reduce a lo que cabe (con aviso aproximado) en vez de salirse', () => {
  const r = render(tabla([pImg(100, 2000)]));
  const im = r.imagenes[0]!;
  expect(im.hPt).toBeLessThan(792 - 144);
  expect(im.wPt / im.hPt).toBeCloseTo(100 / 2000, 6);
  expect(im.yPt).toBeGreaterThanOrEqual(72 - 1e-6);
  expect(r.advertencias.some((a) => a.tipo === 'aproximado' && /imagen/i.test(a.mensaje))).toBe(true);
});
