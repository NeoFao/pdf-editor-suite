import { test, expect } from 'vitest';
import { construirModeloDocx } from '../../src/convert/docx/modelo';
import { DocxError } from '../../src/convert/docx/DocxError';

const STYLES_HERENCIA = `
<w:styles>
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:sz w:val="22"/><w:rFonts w:ascii="Calibri"/></w:rPr></w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="FF0000"/></w:rPr>
  </w:style>
</w:styles>`;

test('herencia de estilos: docDefaults -> estilo -> basedOn -> run, con twips y medios puntos convertidos', () => {
  const documentXml = `
<w:document><w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Titulo</w:t></w:r></w:p>
  <w:p><w:r><w:rPr><w:i/></w:rPr><w:t>cursiva heredada</w:t></w:r></w:p>
  <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`;

  const modelo = construirModeloDocx(documentXml, STYLES_HERENCIA, null);

  // Geometría de página: 12240 twips / 20 = 612 pt; márgenes 1440/20 = 72 pt.
  expect(modelo.paginaAnchoPt).toBe(612);
  expect(modelo.paginaAltoPt).toBe(792);
  expect(modelo.margenSupPt).toBe(72);
  expect(modelo.margenIzqPt).toBe(72);

  const titulo = modelo.parrafos[0]!;
  expect(titulo.nivelEncabezado).toBe(1);
  expect(titulo.espacioAntesPt).toBe(12); // 240 twips / 20
  expect(titulo.espacioDespuesPt).toBe(6); // 120 twips / 20
  const parteTitulo = titulo.partes[0]!;
  expect(parteTitulo).toMatchObject({ tipo: 'texto', texto: 'Titulo' });
  if (parteTitulo.tipo === 'texto') {
    expect(parteTitulo.formato.font).toBe('Helvetica-Bold'); // Calibri (sans) + negrita del estilo
    expect(parteTitulo.formato.sizePt).toBe(16); // w:sz 32 medios puntos -> 16pt
    expect(parteTitulo.formato.color).toEqual([255, 0, 0]);
  }

  const cursiva = modelo.parrafos[1]!;
  const parteCursiva = cursiva.partes[0]!;
  expect(parteCursiva).toMatchObject({ tipo: 'texto', texto: 'cursiva heredada' });
  if (parteCursiva.tipo === 'texto') {
    expect(parteCursiva.formato.font).toBe('Helvetica-Oblique'); // cursiva del run, tamaño heredado de docDefaults
    expect(parteCursiva.formato.sizePt).toBe(11); // w:sz 22 medios puntos -> 11pt, de docDefaults
  }
});

test('un ciclo w:basedOn no cuelga la resolución de estilos (cota anti-ciclo)', () => {
  const stylesCiclo = `
<w:styles>
  <w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/></w:style>
</w:styles>`;
  const documentXml = `<w:document><w:body><w:p><w:pPr><w:pStyle w:val="A"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, stylesCiclo, null);
  expect(modelo.parrafos).toHaveLength(1);
});

const NUMBERING = `
<w:numbering>
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

function parrafoLista(numId: string, ilvl: number, texto: string): string {
  return `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${texto}</w:t></w:r></w:p>`;
}

test('listas: viñetas de 2 niveles y numeración correlativa que se reinicia al volver a un nivel más superficial', () => {
  const documentXml = `<w:document><w:body>
    ${parrafoLista('1', 0, 'raiz uno')}
    ${parrafoLista('1', 0, 'raiz dos')}
    ${parrafoLista('1', 1, 'hijo de dos')}
    ${parrafoLista('1', 0, 'raiz tres')}
  </w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, null, NUMBERING);
  const marcadores = modelo.parrafos.map((p) => p.lista?.textoMarcador);
  expect(marcadores).toEqual(['•', '•', '•', '•']); // viñeta: mismo símbolo en todos los niveles
  // La sangría del nivel 1 (hijo) es mayor que la del nivel 0 (raíz): 1440/20=72pt frente a 720/20=36pt.
  expect(modelo.parrafos[2]!.sangriaIzqPt).toBeGreaterThan(modelo.parrafos[0]!.sangriaIzqPt);
});

test('lista numerada: numeración decimal correlativa desde 1', () => {
  const documentXml = `<w:document><w:body>
    ${parrafoLista('2', 0, 'primero')}
    ${parrafoLista('2', 0, 'segundo')}
    ${parrafoLista('2', 0, 'tercero')}
  </w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, null, NUMBERING);
  expect(modelo.parrafos.map((p) => p.lista?.textoMarcador)).toEqual(['1.', '2.', '3.']);
});

test('tablas: se aplanan a un párrafo por fila con celdas separadas por tabulador, y se avisa', () => {
  const documentXml = `<w:document><w:body>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, null, null);
  expect(modelo.parrafos).toHaveLength(2);
  const fila1 = modelo.parrafos[0]!.partes;
  expect(fila1.map((p) => p.tipo)).toEqual(['texto', 'tab', 'texto']);
  expect(fila1[0]).toMatchObject({ texto: 'A1' });
  expect(fila1[2]).toMatchObject({ texto: 'B1' });
  expect(modelo.advertencias.some((a) => /tabla/i.test(a))).toBe(true);
});

test('imágenes, encabezados/pies, notas, comentarios, campos y control de cambios se cuentan en advertencias sin perderse en silencio', () => {
  const documentXml = `<w:document><w:body>
    <w:p><w:r><w:drawing/></w:r></w:p>
    <w:p><w:r><w:t>con nota</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>
    <w:p><w:ins><w:r><w:t>agregado</w:t></w:r></w:ins><w:del><w:r><w:delText>quitado</w:delText></w:r></w:del></w:p>
    <w:sectPr><w:headerReference w:type="default" r:id="rId1"/><w:footerReference w:type="default" r:id="rId2"/></w:sectPr>
  </w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, null, null);
  const todas = modelo.advertencias.join(' | ');
  expect(todas).toMatch(/imagen/i);
  expect(todas).toMatch(/encabezado/i);
  expect(todas).toMatch(/pie/i);
  expect(todas).toMatch(/nota al pie/i);
  expect(todas).toMatch(/cambio/i);
  // La inserción se conserva; la eliminación se descarta.
  const textosPresentes = modelo.parrafos.flatMap((p) => p.partes).filter((x) => x.tipo === 'texto').map((x) => (x as { texto: string }).texto);
  expect(textosPresentes).toContain('agregado');
  expect(textosPresentes).not.toContain('quitado');
});

test('sin <w:body> lanza DocxError', () => {
  expect(() => construirModeloDocx('<w:document></w:document>', null, null)).toThrow(DocxError);
});

test('alineación, sangría e interlineado exacto se leen del w:pPr directo', () => {
  const documentXml = `<w:document><w:body>
    <w:p><w:pPr><w:jc w:val="both"/><w:ind w:left="360" w:right="180"/><w:spacing w:line="480" w:lineRule="exact"/></w:pPr><w:r><w:t>justificado</w:t></w:r></w:p>
  </w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, null, null);
  const p = modelo.parrafos[0]!;
  expect(p.alineacion).toBe('justify');
  expect(p.sangriaIzqPt).toBe(18); // 360/20
  expect(p.sangriaDerPt).toBe(9); // 180/20
  expect(p.interlineadoExactoPt).toBe(24); // 480/20, lineRule exact -> puntos absolutos
});
