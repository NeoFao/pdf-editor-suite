import { test, expect } from 'vitest';
import { agruparAdvertencias, omitido, aproximado } from '../../src/convert/advertencia';
import { construirModeloDocx } from '../../src/convert/docx/modelo';

/** Advertencias tipadas (T13): omitido = no está en el PDF; aproximado = está pero distinto. */

test('agruparAdvertencias reparte por tipo y conserva el orden', () => {
  const g = agruparAdvertencias([aproximado('a1'), omitido('o1'), aproximado('a2'), omitido('o2')]);
  expect(g.omitidas.map((x) => x.mensaje)).toEqual(['o1', 'o2']);
  expect(g.aproximadas.map((x) => x.mensaje)).toEqual(['a1', 'a2']);
});

const tipoDe = (xml: string, patron: RegExp, rels: Parameters<typeof construirModeloDocx>[3] = null) =>
  construirModeloDocx(xml, null, null, rels).advertencias.filter((a) => patron.test(a.mensaje)).map((a) => a.tipo);

test('contenido que no llega al PDF se clasifica como omitido (notas, VML, cuadros de texto, comentarios, OLE, ecuaciones)', () => {
  const doc = `<w:document><w:body>
    <w:p><w:r><w:t>x</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:commentReference w:id="2"/></w:r></w:p>
    <w:p><w:r><w:pict/></w:r></w:p>
    <w:p><w:r><w:object/></w:r></w:p>
    <w:p><w:txbxContent><w:p/></w:txbxContent></w:p>
    <w:p><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p>
  </w:body></w:document>`;
  for (const patron of [/nota al pie/i, /formato antiguo/i, /objeto incrustado/i, /cuadro de texto/i, /comentario/i]) {
    expect(tipoDe(doc, patron), String(patron)).toEqual(['omitido']);
  }
});

test('contenido que aparece distinto se clasifica como aproximado (cambios, salto de sección par/impar, salto de columna en una celda)', () => {
  const doc = `<w:document><w:body>
    <w:p><w:ins><w:r><w:t>a</w:t></w:r></w:ins></w:p>
    <w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>x</w:t><w:br w:type="column"/><w:t>y</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:sectPr><w:type w:val="evenPage"/></w:sectPr>
  </w:body></w:document>`;
  for (const patron of [/control de cambios/i, /página par/i, /salto de columna/i]) {
    expect(tipoDe(doc, patron), String(patron)).toEqual(['aproximado']);
  }
});

test('las columnas de sección y los saltos de columna del cuerpo se maquetan de verdad (E-118): no generan aviso', () => {
  const doc = `<w:document><w:body>
    <w:p><w:pPr><w:sectPr><w:cols w:num="2"/></w:sectPr></w:pPr></w:p>
    <w:p><w:r><w:br w:type="column"/></w:r></w:p>
  </w:body></w:document>`;
  for (const patron of [/columnas/i, /salto de columna/i]) expect(tipoDe(doc, patron), String(patron)).toEqual([]);
});

const RELS_IMG = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>';

test('la imagen flotante colocada es aproximado, nunca omitido; una imagen sin relación es omitido', () => {
  const flotante = `<w:document><w:body><w:p><w:r><w:drawing><wp:anchor><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="457200"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:body></w:document>`;
  const todas = construirModeloDocx(flotante, null, null, RELS_IMG).advertencias;
  expect(todas.filter((a) => /flotante/i.test(a.mensaje)).map((a) => a.tipo)).toEqual(['aproximado']);
  expect(todas.filter((a) => a.tipo === 'omitido')).toEqual([]);

  const sinRel = flotante.replace('rId1', 'rId9');
  const omit = construirModeloDocx(sinRel, null, null, RELS_IMG).advertencias.filter((a) => /no se pudo insertar una imagen/i.test(a.mensaje));
  expect(omit.map((a) => a.tipo)).toEqual(['omitido']);
});
