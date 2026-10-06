import { test, expect } from 'vitest';
import { construirModeloDocx } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';

/**
 * Word fase 2b, MAQUETACIÓN (modelo → páginas): encabezados/pies repetidos por
 * página con PAGE/NUMPAGES, tipos first/even, encabezado no huérfano, bordes de
 * celda e imagen flotante. `medir` falso exacto (5 pt por carácter).
 */
const medir = (_f: string, _s: number, t: string): number => t.length * 5;

/** Página de 612x200 pt, márgenes de 40 pt arriba/abajo (120 pt útiles), encabezado a 10 pt y pie a 10 pt del borde. */
const MAR = '<w:pgSz w:w="12240" w:h="4000"/><w:pgMar w:top="800" w:right="1440" w:bottom="800" w:left="1440" w:header="200" w:footer="200"/>';
const RELS = '<Relationships><Relationship Id="rH1" Type="x/header" Target="header1.xml"/><Relationship Id="rH2" Type="x/header" Target="header2.xml"/><Relationship Id="rH3" Type="x/header" Target="header3.xml"/><Relationship Id="rF1" Type="x/footer" Target="footer1.xml"/><Relationship Id="rI" Type="x/image" Target="media/i.png"/></Relationships>';
/** Línea exacta de 12 pt sin espacio posterior: 10 líneas por página. */
const LINEA = '<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>';
const lineas = (n: number, pref = 'L') => Array.from({ length: n }, (_v, i) => `<w:p>${LINEA}<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${pref}${i + 1}</w:t></w:r></w:p>`).join('');
const parr = (t: string) => `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${t}</w:t></w:r></w:p>`;
const PIE = `<w:ftr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">Página </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve"> de </w:t></w:r><w:fldSimple w:instr="NUMPAGES"><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
const PARTES = {
  'word/header1.xml': `<w:hdr>${parr('H-def')}</w:hdr>`,
  'word/header2.xml': `<w:hdr>${parr('H-first')}</w:hdr>`,
  'word/header3.xml': `<w:hdr>${parr('H-even')}</w:hdr>`,
  'word/footer1.xml': PIE
};
const refs = (extra = '') => `<w:headerReference w:type="default" r:id="rH1"/><w:headerReference w:type="first" r:id="rH2"/><w:headerReference w:type="even" r:id="rH3"/><w:footerReference w:type="default" r:id="rF1"/><w:footerReference w:type="first" r:id="rF1"/>${extra}`;

function render(cuerpo: string, extra = '', settingsXml: string | null = null, styles: string | null = null) {
  const doc = `<w:document><w:body>${cuerpo}<w:sectPr>${refs(extra)}${MAR}</w:sectPr></w:body></w:document>`;
  const modelo = construirModeloDocx(doc, styles, null, RELS, { partes: PARTES, settingsXml });
  return { modelo, res: renderizarModeloDocx(modelo, medir) };
}
const paginaDe = (res: ReturnType<typeof renderizarModeloDocx>, texto: string) => res.trazos.filter((t) => t.text === texto).map((t) => t.page);

test('encabezado default en cada página y first solo en la primera (w:titlePg); el pie dice "Página N de M" en cada una', () => {
  const { res } = render(lineas(25), '<w:titlePg/>');
  expect(res.totalPaginas).toBe(3);
  expect(paginaDe(res, 'H-first')).toEqual([0]);
  expect(paginaDe(res, 'H-def')).toEqual([1, 2]);
  expect(res.trazos.filter((t) => /^Página \d de \d$/.test(t.text)).map((t) => [t.page, t.text]).sort()).toEqual([[0, 'Página 1 de 3'], [1, 'Página 2 de 3'], [2, 'Página 3 de 3']]);
  expect(res.advertencias).toEqual([]);
});

test('sin w:titlePg la primera página lleva el default; con titlePg y sin tipo first, la primera queda en blanco (como Word)', () => {
  const sin = render(lineas(25));
  expect(paginaDe(sin.res, 'H-def')).toEqual([0, 1, 2]);
  expect(paginaDe(sin.res, 'H-first')).toEqual([]);
  const doc = `<w:document><w:body>${lineas(25)}<w:sectPr><w:headerReference w:type="default" r:id="rH1"/><w:titlePg/>${MAR}</w:sectPr></w:body></w:document>`;
  const m = construirModeloDocx(doc, null, null, RELS, { partes: PARTES });
  expect(paginaDe(renderizarModeloDocx(m, medir), 'H-def')).toEqual([1, 2]);
});

test('w:evenAndOddHeaders: las páginas pares llevan el encabezado even, las impares el default', () => {
  const { res } = render(lineas(25), '', '<w:settings><w:evenAndOddHeaders/></w:settings>');
  expect(paginaDe(res, 'H-def')).toEqual([0, 2]);
  expect(paginaDe(res, 'H-even')).toEqual([1]);
});

test('geometría: el encabezado arranca a margenEncabezado del borde superior y el pie queda a margenPie del inferior', () => {
  const { res } = render(lineas(3));
  const cab = res.trazos.find((t) => t.text === 'H-def')!;
  // Encabezado: caja de 11,5 pt (10 pt × 1,15) que empieza a 10 pt del borde superior → su línea base cae entre 200-10-11,5 y 200-10.
  expect(cab.yPt).toBeGreaterThan(200 - 10 - 11.5);
  expect(cab.yPt).toBeLessThan(200 - 10);
  const pie = res.trazos.find((t) => t.text.startsWith('Página'))!;
  // Pie: caja de 11,5 pt cuyo borde inferior está a 10 pt del borde inferior de la página.
  expect(pie.yPt).toBeGreaterThan(10);
  expect(pie.yPt).toBeLessThan(10 + 11.5);
  // El pie va centrado (w:jc center) entre márgenes de 72 pt: 612 de ancho.
  const medio = pie.xPt + (pie.text.length * 5) / 2;
  expect(Math.abs(medio - 306)).toBeLessThan(1);
  // El cuerpo no invade las zonas: la primera línea del cuerpo está por debajo del margen superior de 40 pt.
  expect(res.trazos.find((t) => t.text === 'L1')!.yPt).toBeLessThan(200 - 40);
});

test('un encabezado más alto que el margen empuja el cuerpo hacia abajo (como Word)', () => {
  const alto = '<w:hdr>' + parr('a') + parr('b') + parr('c') + parr('d') + '</w:hdr>'; // 4 líneas de 11,5 pt = 46 pt; empieza a 10 pt → termina a 56 pt > 40 pt
  const doc = `<w:document><w:body>${lineas(3)}<w:sectPr><w:headerReference w:type="default" r:id="rH1"/>${MAR}</w:sectPr></w:body></w:document>`;
  const m = construirModeloDocx(doc, null, null, RELS, { partes: { ...PARTES, 'word/header1.xml': alto } });
  const res = renderizarModeloDocx(m, medir);
  const l1 = res.trazos.find((t) => t.text === 'L1')!;
  expect(l1.yPt).toBeLessThan(200 - 56); // la línea 1 del cuerpo queda bajo el final del encabezado (≈ 56 pt)
});

// ---------------------------------------------------------------------------
// Encabezado no huérfano
// ---------------------------------------------------------------------------

const STYLES = `<w:styles><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:rPr><w:b/><w:sz w:val="20"/></w:rPr></w:style></w:styles>`;
const TITULO = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>TITULO</w:t></w:r></w:p>`;

test('un título al pie de la página pasa a la siguiente junto con su párrafo (no queda huérfano)', () => {
  // 9 líneas de 12 pt = 108 pt; el título cabe en la 10ª (12 pt) pero el párrafo que sigue ya no.
  const { res } = render(lineas(9) + TITULO + lineas(2, 'S'), '', null, STYLES);
  expect(paginaDe(res, 'TITULO')).toEqual([1]);
  expect(paginaDe(res, 'S1')).toEqual([1]);
  expect(paginaDe(res, 'L9')).toEqual([0]);
});

test('sin título (párrafo normal) la misma línea SÍ se queda al pie: el arreglo no mueve lo que no pidió', () => {
  const { res } = render(lineas(9) + lineas(1, 'N') + lineas(2, 'S'), '', null, STYLES);
  expect(paginaDe(res, 'N1')).toEqual([0]);
  expect(paginaDe(res, 'S1')).toEqual([1]);
});

test('w:keepNext explícito en un párrafo normal también lo mantiene con el siguiente; w:keepNext w:val=0 en un título lo desactiva', () => {
  const kn = (t: string, v = '') => `<w:p><w:pPr><w:keepNext${v}/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
  expect(paginaDe(render(lineas(9) + kn('KN') + lineas(2, 'S')).res, 'KN')).toEqual([1]);
  const sinKeep = `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:keepNext w:val="0"/></w:pPr><w:r><w:t>TITULO</w:t></w:r></w:p>`;
  expect(paginaDe(render(lineas(9) + sinKeep + lineas(2, 'S'), '', null, STYLES).res, 'TITULO')).toEqual([0]);
});

test('w:keepLines: un párrafo de varias líneas que no cabe entero pasa completo a la página siguiente', () => {
  const kl = `<w:p><w:pPr><w:keepLines/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>uno</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>dos</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>tres</w:t></w:r></w:p>`;
  const { res } = render(lineas(8) + kl);
  expect(paginaDe(res, 'uno')).toEqual([1]);
  expect(paginaDe(res, 'tres')).toEqual([1]);
});

// ---------------------------------------------------------------------------
// Bordes de celda
// ---------------------------------------------------------------------------

function tablaBordes(tblBorders: string, tc1: string, tc2 = ''): string {
  const c = (t: string, pr: string) => `<w:tc><w:tcPr>${pr}</w:tcPr><w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  return `<w:tbl><w:tblPr>${tblBorders}</w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>${c('a', tc1)}${c('b', tc2)}</w:tr><w:tr>${c('c', '')}${c('d', '')}</w:tr></w:tbl>`;
}
const SEIS = (sz: number, color: string) => '<w:tblBorders>' + ['top', 'bottom', 'left', 'right', 'insideH', 'insideV'].map((l) => `<w:${l} w:val="single" w:sz="${sz}" w:color="${color}"/>`).join('') + '</w:tblBorders>';
const rojas = (res: ReturnType<typeof renderizarModeloDocx>) => res.barras.filter((b) => b.color[0] === 255 && b.color[1] === 0);
const negras = (res: ReturnType<typeof renderizarModeloDocx>) => res.barras.filter((b) => b.color[0] === 0 && b.color[1] === 0);

test('w:tcBorders: el borde de la celda (3 pt, rojo; w:sz en octavos de punto) gana al de la tabla (1 pt, negro) en ese lado', () => {
  const { res } = render(tablaBordes(SEIS(8, '000000'), '<w:tcBorders><w:left w:val="single" w:sz="24" w:color="FF0000"/></w:tcBorders>'));
  const r = rojas(res);
  expect(r).toHaveLength(1);
  expect(r[0]!.wPt).toBe(3);
  expect(r[0]!.xPt).toBe(72);
  // En la celda 'a' no queda además el borde izquierdo negro de la tabla: solo el de la fila de 'c' (la fila de abajo).
  const izquierdosNegros = negras(res).filter((b) => b.xPt === 72 && b.wPt === 1 && b.hPt > 3);
  expect(izquierdosNegros).toHaveLength(1);
});

test('w:tcBorders con nil quita el borde que la tabla sí tiene; los demás lados siguen intactos', () => {
  const { res } = render(tablaBordes(SEIS(8, '000000'), '<w:tcBorders><w:top w:val="nil"/></w:tcBorders>'));
  const superioresDeA = res.barras.filter((b) => b.hPt === 1 && b.xPt === 72 && b.wPt === 100 && b.yPt > 150);
  expect(superioresDeA).toHaveLength(0);
  const superioresDeB = res.barras.filter((b) => b.hPt === 1 && b.xPt === 172 && b.wPt === 100 && b.yPt > 150);
  expect(superioresDeB).toHaveLength(1);
});

test('el borde inferior explícito de la celda de arriba gana al insideH de la tabla en la arista compartida (una sola barra)', () => {
  const { res } = render(tablaBordes(SEIS(8, '000000'), '<w:tcBorders><w:bottom w:val="single" w:sz="16" w:color="FF0000"/></w:tcBorders>'));
  const r = rojas(res);
  expect(r).toHaveLength(1);
  expect(r[0]!.hPt).toBe(2);
  // Y no se dibuja ADEMÁS el insideH negro en ese tramo (x de la celda a, ancho 100).
  const negrasMismaArista = negras(res).filter((b) => b.hPt === 1 && b.xPt === 72 && b.wPt === 100 && Math.abs(b.yPt - r[0]!.yPt) < 3);
  expect(negrasMismaArista).toHaveLength(0);
});

test('bordes de tabla POR LADO: solo los lados declarados se dibujan (antes un lado se extendía a toda la tabla)', () => {
  const soloArriba = '<w:tblBorders><w:top w:val="single" w:sz="8" w:color="000000"/></w:tblBorders>';
  const { res } = render(tablaBordes(soloArriba, ''));
  expect(negras(res)).toHaveLength(2); // el superior de a y el de b
});

test('el estilo de tabla (w:tblStyle) aporta los bordes si la tabla no declara los suyos', () => {
  const styles = `<w:styles><w:style w:type="table" w:styleId="Rejilla"><w:name w:val="Table Grid"/><w:tblPr>${SEIS(8, '000000')}</w:tblPr></w:style></w:styles>`;
  const doc = `<w:document><w:body>${tablaBordes('<w:tblStyle w:val="Rejilla"/>', '')}<w:sectPr>${MAR}</w:sectPr></w:body></w:document>`;
  const res = renderizarModeloDocx(construirModeloDocx(doc, styles, null), medir);
  expect(negras(res).length).toBeGreaterThan(4);
});

// ---------------------------------------------------------------------------
// Imagen flotante
// ---------------------------------------------------------------------------

test('imagen flotante: se coloca en su posición de página (EMU → pt) en la página de su párrafo, sin empujar el texto', () => {
  const ancla = `<w:drawing><wp:anchor><wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>381000</wp:posOffset></wp:positionV><wp:extent cx="635000" cy="317500"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rI"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
  const doc = `<w:document><w:body>${lineas(11)}<w:p>${LINEA}<w:r>${ancla}<w:t>ANCLA</w:t></w:r></w:p>${lineas(1, 'Z')}<w:sectPr>${MAR}</w:sectPr></w:body></w:document>`;
  const res = renderizarModeloDocx(construirModeloDocx(doc, null, null, RELS), medir);
  expect(res.imagenes).toHaveLength(1);
  const im = res.imagenes[0]!;
  expect(im.page).toBe(1); // el párrafo de ANCLA es la línea 12: cae en la segunda página
  expect(im.xPt).toBeCloseTo(72, 6); // 914400 EMU
  expect(im.wPt).toBeCloseTo(50, 6); // 635000 EMU
  expect(im.hPt).toBeCloseTo(25, 6); // 317500 EMU
  expect(im.yPt).toBeCloseTo(200 - 30 - 25, 6); // 381000 EMU = 30 pt desde arriba; y PDF = 200 - 30 - alto
  // El texto no se aparta: ANCLA está en la línea 12 (página 2, primera línea) y Z justo debajo, sin hueco por la imagen.
  const yAncla = res.trazos.find((t) => t.text === 'ANCLA')!.yPt;
  const yZ = res.trazos.find((t) => t.text === 'Z1')!.yPt;
  expect(yAncla - yZ).toBeCloseTo(12, 6);
});
