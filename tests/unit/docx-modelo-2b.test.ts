import { textosAdvertencias } from '../../src/convert/advertencia';
import { test, expect } from 'vitest';
import { construirModeloDocx, esParrafo, esTabla, type Parrafo, type Tabla, type BloqueDocx } from '../../src/convert/docx/modelo';

/**
 * Word fase 2b (§9 fila #4): encabezados/pies (default/first/even), campos
 * PAGE/NUMPAGES, keepNext/keepLines, bordes de celda (`w:tcBorders`) e
 * imágenes flotantes (`wp:anchor`). Unitarios del MODELO (puro, sin motor).
 */
const REL_CAB = '<Relationships><Relationship Id="rIdH1" Type="x/header" Target="header1.xml"/><Relationship Id="rIdH2" Type="x/header" Target="header2.xml"/><Relationship Id="rIdF1" Type="x/footer" Target="footer1.xml"/><Relationship Id="rIdF2" Type="x/footer" Target="footer2.xml"/><Relationship Id="rIdI" Type="x/image" Target="media/image1.png"/></Relationships>';
const sect = (extra: string, mar = '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="360"/>') =>
  `<w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/><w:headerReference w:type="first" r:id="rIdH2"/><w:footerReference w:type="default" r:id="rIdF1"/>${extra}<w:pgSz w:w="12240" w:h="15840"/>${mar}</w:sectPr>`;
const cuerpo = (s: string) => `<w:document><w:body><w:p><w:r><w:t>cuerpo</w:t></w:r></w:p>${s}</w:body></w:document>`;
const hdr = (t: string) => `<w:hdr><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:hdr>`;
const textos = (ps: BloqueDocx[] | null) => (ps ?? []).filter(esParrafo).flatMap((p) => p.partes).map((x) => (x.tipo === 'texto' ? x.texto : x.tipo === 'campo' ? `{${x.campo}}` : `<${x.tipo}>`));
function soloP(m: ReturnType<typeof construirModeloDocx>): Parrafo[] { return m.bloques.filter(esParrafo); }

const PARTES = { 'word/header1.xml': hdr('cab general'), 'word/header2.xml': hdr('cab primera'), 'word/footer1.xml': '<w:ftr><w:p><w:r><w:t>pie general</w:t></w:r></w:p></w:ftr>' };

test('encabezados/pies: default y first resueltos vía rels, márgenes de encabezado/pie en pt (twips/20), y SIN aviso de "no soportado"', () => {
  const m = construirModeloDocx(cuerpo(sect('<w:titlePg/>')), null, null, REL_CAB, { partes: PARTES });
  expect(textos(m.encabezados.default)).toEqual(['cab general']);
  expect(textos(m.encabezados.first)).toEqual(['cab primera']);
  expect(textos(m.pies.default)).toEqual(['pie general']);
  expect(m.pies.first).toBeNull();
  expect(m.tituloPagina).toBe(true);
  expect(m.margenEncabezadoPt).toBe(36); // 720 twips
  expect(m.margenPiePt).toBe(18); // 360 twips
  expect(textosAdvertencias(m.advertencias).join(' | ')).not.toMatch(/encabezado|pie de página/i);
});

test('sin w:titlePg el tipo first existe pero no se usa; evenAndOddHeaders se lee de settings.xml', () => {
  const sin = construirModeloDocx(cuerpo(sect('')), null, null, REL_CAB, { partes: PARTES });
  expect(sin.tituloPagina).toBe(false);
  expect(sin.paresImpares).toBe(false);
  const con = construirModeloDocx(cuerpo(sect('')), null, null, REL_CAB, { partes: PARTES, settingsXml: '<w:settings><w:evenAndOddHeaders/></w:settings>' });
  expect(con.paresImpares).toBe(true);
});

test('márgenes de encabezado/pie por defecto de Word (0,5" = 36 pt) si w:pgMar no los trae', () => {
  const m = construirModeloDocx(cuerpo(sect('', '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>')), null, null, REL_CAB, { partes: PARTES });
  expect(m.margenEncabezadoPt).toBe(36);
  expect(m.margenPiePt).toBe(36);
});

test('una referencia cuyo contenido no está en el paquete se avisa (encabezado y pie), no se pierde en silencio', () => {
  const m = construirModeloDocx(cuerpo(sect('')), null, null, REL_CAB, { partes: {} });
  const a = textosAdvertencias(m.advertencias).join(' | ');
  expect(a).toMatch(/encabezado/i);
  expect(a).toMatch(/pie de página/i);
  expect(m.encabezados.default).toBeNull();
});

test('campos PAGE y NUMPAGES: en w:fldSimple y en w:fldChar/w:instrText, con el formato del run y SIN el texto cacheado', () => {
  const pie = `<w:ftr><w:p>
    <w:r><w:t xml:space="preserve">Página </w:t></w:r>
    <w:fldSimple w:instr=" PAGE \\* MERGEFORMAT "><w:r><w:rPr><w:b/></w:rPr><w:t>7</w:t></w:r></w:fldSimple>
    <w:r><w:t xml:space="preserve"> de </w:t></w:r>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p></w:ftr>`;
  const m = construirModeloDocx(cuerpo(sect('')), null, null, REL_CAB, { partes: { ...PARTES, 'word/footer1.xml': pie } });
  expect(textos(m.pies.default)).toEqual(['Página ', '{PAGE}', ' de ', '{NUMPAGES}']);
  const campoPage = (m.pies.default![0] as Parrafo).partes.find((x) => x.tipo === 'campo')!;
  expect(campoPage.tipo === 'campo' && campoPage.formato.font).toBe('Helvetica-Bold');
  expect(textosAdvertencias(m.advertencias).join(' | ')).not.toMatch(/campo/i);
});

test('un campo no soportado (DATE) deja su último valor guardado y se AVISA; en el cuerpo, PAGE también (solo se resuelve en encabezado/pie)', () => {
  const pie = '<w:ftr><w:p><w:fldSimple w:instr="DATE"><w:r><w:t>01/01/2026</w:t></w:r></w:fldSimple></w:p></w:ftr>';
  const m = construirModeloDocx(
    `<w:document><w:body><w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>${sect('')}</w:body></w:document>`,
    null, null, REL_CAB, { partes: { ...PARTES, 'word/footer1.xml': pie } }
  );
  expect(textos(m.pies.default)).toEqual(['01/01/2026']);
  expect(textos(soloP(m))).toEqual(['1']);
  expect(textosAdvertencias(m.advertencias).join(' | ')).toMatch(/campo/i);
});

test('la última sección manda en los campos de siempre y hereda el tipo que no define (fase 2c: ya no se avisa de secciones)', () => {
  const doc = `<w:document><w:body>
    <w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/><w:headerReference w:type="even" r:id="rIdH2"/></w:sectPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p>
    <w:p><w:r><w:t>b</w:t></w:r></w:p>
    <w:sectPr><w:headerReference w:type="default" r:id="rIdH2"/></w:sectPr>
  </w:body></w:document>`;
  const m = construirModeloDocx(doc, null, null, REL_CAB, { partes: PARTES });
  expect(textos(m.encabezados.default)).toEqual(['cab primera']); // la última sección manda
  expect(textos(m.encabezados.even)).toEqual(['cab primera']); // no la define: hereda el `even` de la anterior (header2)
  expect(textosAdvertencias(m.advertencias).join(' | ')).not.toMatch(/secciones/i);
});

test('imagen dentro de un encabezado cuya relación no está en el paquete se omite con aviso (con relación se pinta: ver docx-modelo-2c)', () => {
  const cab = '<w:hdr><w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rIdI"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r><w:r><w:t>logo</w:t></w:r></w:p></w:hdr>';
  const m = construirModeloDocx(cuerpo(sect('')), null, null, REL_CAB, { partes: { ...PARTES, 'word/header1.xml': cab } });
  expect(textos(m.encabezados.default)).toEqual(['logo']);
  expect(textosAdvertencias(m.advertencias).join(' | ')).toMatch(/imagen/i);
});

// ---------------------------------------------------------------------------
// keepNext / keepLines
// ---------------------------------------------------------------------------

const STYLES_KEEP = `<w:styles>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Pegado"><w:name w:val="Pegado"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/></w:pPr></w:style>
</w:styles>`;

test('keepNext/keepLines: directos, heredados de estilo, y un título (Heading) mantiene con el siguiente aunque el estilo no lo diga', () => {
  const doc = `<w:document><w:body>
    <w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>directo</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Pegado"/></w:pPr><w:r><w:t>estilo</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>titulo</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>titulo sin keep</w:t></w:r></w:p>
    <w:p><w:r><w:t>normal</w:t></w:r></w:p>
  </w:body></w:document>`;
  const ps = soloP(construirModeloDocx(doc, STYLES_KEEP, null));
  expect(ps.map((p) => [p.mantenerConSiguiente, p.mantenerLineasJuntas])).toEqual([
    [true, false], [true, true], [true, true], [false, true], [false, false]
  ]);
});

// ---------------------------------------------------------------------------
// w:tcBorders
// ---------------------------------------------------------------------------

test('w:tcBorders: lados por celda, w:sz en OCTAVOS de punto (24 → 3 pt), color, nil = sin borde explícito; w:tblBorders por lado', () => {
  const doc = `<w:document><w:body><w:tbl>
    <w:tblPr><w:tblBorders><w:top w:val="single" w:sz="8" w:color="00FF00"/><w:insideV w:val="single" w:sz="4" w:color="0000FF"/></w:tblBorders></w:tblPr>
    <w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>
    <w:tr>
      <w:tc><w:tcPr><w:tcBorders><w:top w:val="single" w:sz="24" w:color="FF0000"/><w:left w:val="nil"/><w:end w:val="single" w:sz="16" w:color="112233"/></w:tcBorders></w:tcPr><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc>
    </w:tr>
  </w:tbl></w:body></w:document>`;
  const m = construirModeloDocx(doc, null, null);
  const t = m.bloques.find(esTabla) as Tabla;
  const a = t.filas[0]!.celdas[0]!;
  expect(a.bordes!.top).toEqual({ color: [255, 0, 0], grosorPt: 3 });
  expect(a.bordes!.left).toBeNull(); // nil explícito: gana al borde de tabla
  expect(a.bordes!.right).toEqual({ color: [0x11, 0x22, 0x33], grosorPt: 2 }); // w:end = derecha
  expect(a.bordes!.bottom).toBeUndefined(); // no definido: hereda de la tabla
  expect(t.filas[0]!.celdas[1]!.bordes).toBeUndefined();
  expect(t.bordesTabla!.top).toEqual({ color: [0, 255, 0], grosorPt: 1 });
  expect(t.bordesTabla!.insideV).toEqual({ color: [0, 0, 255], grosorPt: 0.5 });
  expect(t.bordesTabla!.bottom).toBeUndefined();
});

test('un estilo de borde que no es línea continua (doble, punteado) se dibuja continuo y se AVISA', () => {
  const doc = '<w:document><w:body><w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcBorders><w:top w:val="dotted" w:sz="8"/></w:tcBorders></w:tcPr><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  const m = construirModeloDocx(doc, null, null);
  expect(textosAdvertencias(m.advertencias).join(' | ')).toMatch(/borde/i);
});

// ---------------------------------------------------------------------------
// wp:anchor
// ---------------------------------------------------------------------------

const RELS_IMG = '<Relationships><Relationship Id="rId1" Type="x/image" Target="media/image1.png"/></Relationships>';
function ancla(h: string, v: string): string {
  return `<w:drawing><wp:anchor><wp:positionH relativeFrom="${h.split('|')[0]}">${h.split('|')[1]}</wp:positionH><wp:positionV relativeFrom="${v.split('|')[0]}">${v.split('|')[1]}</wp:positionV><wp:extent cx="914400" cy="457200"/><wp:wrapNone/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
}

test('imagen flotante (wp:anchor): se coloca (posOffset EMU → pt) y se avisa "sin ajuste de texto"', () => {
  const doc = `<w:document><w:body><w:p><w:r>${ancla('page|<wp:posOffset>914400</wp:posOffset>', 'margin|<wp:posOffset>-127000</wp:posOffset>')}<w:t>x</w:t></w:r></w:p></w:body></w:document>`;
  const m = construirModeloDocx(doc, null, null, RELS_IMG);
  const img = soloP(m)[0]!.partes.find((x) => x.tipo === 'imagen')!;
  expect(img).toMatchObject({ tipo: 'imagen', refId: 'word/media/image1.png', wPt: 72, hPt: 36 });
  expect(img.tipo === 'imagen' && img.flotante).toEqual({ h: { rel: 'page', offsetPt: 72 }, v: { rel: 'margin', offsetPt: -10 } });
  expect(textosAdvertencias(m.advertencias).join(' | ')).toMatch(/imagen flotante colocada sin ajuste de texto/i);
  expect(textosAdvertencias(m.advertencias).join(' | ')).not.toMatch(/omiti/i);
});

test('wp:align y relativeFrom (leftMargin/paragraph/column) se mapean; relativeFrom desconocido cae a margen', () => {
  const doc = `<w:document><w:body><w:p><w:r>${ancla('column|<wp:align>center</wp:align>', 'paragraph|<wp:posOffset>12700</wp:posOffset>')}</w:r></w:p><w:p><w:r>${ancla('leftMargin|<wp:align>right</wp:align>', 'topMargin|<wp:align>bottom</wp:align>')}</w:r></w:p><w:p><w:r>${ancla('rareza|<wp:align>inside</wp:align>', 'line|<wp:posOffset>0</wp:posOffset>')}</w:r></w:p></w:body></w:document>`;
  const ps = soloP(construirModeloDocx(doc, null, null, RELS_IMG));
  const fl = ps.map((p) => { const i = p.partes.find((x) => x.tipo === 'imagen'); return i && i.tipo === 'imagen' ? i.flotante : undefined; });
  expect(fl[0]).toEqual({ h: { rel: 'margin', align: 'center' }, v: { rel: 'paragraph', offsetPt: 1 } });
  expect(fl[1]).toEqual({ h: { rel: 'leftMargin', align: 'right' }, v: { rel: 'topMargin', align: 'bottom' } });
  expect(fl[2]).toEqual({ h: { rel: 'margin', align: 'left' }, v: { rel: 'paragraph', offsetPt: 0 } });
});

test('imagen flotante dentro de una celda: se omite con aviso de imagen en celda', () => {
  const doc = `<w:document><w:body><w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r>${ancla('page|<wp:posOffset>0</wp:posOffset>', 'page|<wp:posOffset>0</wp:posOffset>')}</w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
  const m = construirModeloDocx(doc, null, null, RELS_IMG);
  expect(textosAdvertencias(m.advertencias).join(' | ')).toMatch(/imagen.*celda/i);
});
