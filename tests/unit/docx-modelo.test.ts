import { textosAdvertencias } from '../../src/convert/advertencia';
import { test, expect } from 'vitest';
import { construirModeloDocx, esParrafo, esTabla, type Parrafo } from '../../src/convert/docx/modelo';
import { DocxError } from '../../src/convert/docx/DocxError';

/** Los tests que solo tratan párrafos siguen escribiendo `.parrafos` para minimizar el diff: helper que filtra `bloques` y castea. */
function soloParrafos(modelo: ReturnType<typeof construirModeloDocx>): Parrafo[] {
  return modelo.bloques.filter(esParrafo);
}

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

  const titulo = soloParrafos(modelo)[0]!;
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

  const cursiva = soloParrafos(modelo)[1]!;
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
  expect(soloParrafos(modelo)).toHaveLength(1);
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
  const parrafos = soloParrafos(modelo);
  const marcadores = parrafos.map((p) => p.lista?.textoMarcador);
  expect(marcadores).toEqual(['•', '•', '•', '•']); // viñeta: mismo símbolo en todos los niveles
  // La sangría del nivel 1 (hijo) es mayor que la del nivel 0 (raíz): 1440/20=72pt frente a 720/20=36pt.
  expect(parrafos[2]!.sangriaIzqPt).toBeGreaterThan(parrafos[0]!.sangriaIzqPt);
});

test('lista numerada: numeración decimal correlativa desde 1', () => {
  const documentXml = `<w:document><w:body>
    ${parrafoLista('2', 0, 'primero')}
    ${parrafoLista('2', 0, 'segundo')}
    ${parrafoLista('2', 0, 'tercero')}
  </w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, null, NUMBERING);
  expect(soloParrafos(modelo).map((p) => p.lista?.textoMarcador)).toEqual(['1.', '2.', '3.']);
});

test('tablas: grid de anchos, gridSpan, vMerge, bordes y sombreado quedan en el modelo (fase 2a, tablas REALES)', () => {
  const documentXml = `<w:document><w:body>
    <w:tbl>
      <w:tblPr><w:tblBorders><w:top w:val="single" w:sz="8" w:color="000000"/></w:tblBorders></w:tblPr>
      <w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>
      <w:tr><w:trPr><w:tblHeader/></w:trPr>
        <w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:fill="FFCC00"/></w:tcPr><w:p><w:r><w:t>Encabezado combinado</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>C1</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, null, null);
  expect(modelo.bloques).toHaveLength(1);
  const tabla = modelo.bloques[0]!;
  expect(esTabla(tabla)).toBe(true);
  if (!esTabla(tabla)) throw new Error('se esperaba una tabla');

  // Grid: 3 columnas de 2000 twips = 100pt cada una.
  expect(tabla.anchosColPt).toEqual([100, 100, 100]);
  expect(tabla.bordeColor).toEqual([0, 0, 0]);
  expect(tabla.bordeGrosorPt).toBeCloseTo(1, 5); // w:sz=8 octavos de punto -> 1pt

  expect(tabla.filas).toHaveLength(2);
  expect(tabla.filas[0]!.esEncabezado).toBe(true);
  expect(tabla.filas[1]!.esEncabezado).toBe(false);

  const celdaCombinada = tabla.filas[0]!.celdas[0]!;
  expect(celdaCombinada.gridSpan).toBe(2);
  expect(celdaCombinada.colorFondo).toEqual([255, 204, 0]);
  expect(celdaCombinada.partes.find((x) => x.tipo === 'texto')).toMatchObject({ tipo: 'texto', texto: 'Encabezado combinado' });

  const filaDatos = tabla.filas[1]!.celdas.map((c) => (c.partes.find((x) => x.tipo === 'texto') as { texto: string }).texto);
  expect(filaDatos).toEqual(['A1', 'B1', 'C1']);
});

test('tablas: w:vMerge "continue" se marca en el modelo (no se pierde en silencio)', () => {
  const documentXml = `<w:document><w:body>
    <w:tbl>
      <w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>
      <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>fusionada</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>x1</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>x2</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, null, null);
  const tabla = modelo.bloques[0]!;
  if (!esTabla(tabla)) throw new Error('se esperaba una tabla');
  expect(tabla.filas[0]!.celdas[0]!.vMerge).toBe('restart');
  expect(tabla.filas[1]!.celdas[0]!.vMerge).toBe('continue');
});

test('imágenes, encabezados/pies, notas, comentarios, campos y control de cambios se cuentan en advertencias sin perderse en silencio', () => {
  const documentXml = `<w:document><w:body>
    <w:p><w:r><w:drawing/></w:r></w:p>
    <w:p><w:r><w:t>con nota</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>
    <w:p><w:ins><w:r><w:t>agregado</w:t></w:r></w:ins><w:del><w:r><w:delText>quitado</w:delText></w:r></w:del></w:p>
    <w:sectPr><w:headerReference w:type="default" r:id="rId1"/><w:footerReference w:type="default" r:id="rId2"/></w:sectPr>
  </w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, null, null);
  const todas = textosAdvertencias(modelo.advertencias).join(' | ');
  expect(todas).toMatch(/imagen/i);
  expect(todas).toMatch(/encabezado/i);
  expect(todas).toMatch(/pie/i);
  expect(todas).toMatch(/nota al pie/i);
  expect(todas).toMatch(/cambio/i);
  // La inserción se conserva; la eliminación se descarta.
  const textosPresentes = soloParrafos(modelo).flatMap((p) => p.partes).filter((x) => x.tipo === 'texto').map((x) => (x as { texto: string }).texto);
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
  const p = soloParrafos(modelo)[0]!;
  expect(p.alineacion).toBe('justify');
  expect(p.sangriaIzqPt).toBe(18); // 360/20
  expect(p.sangriaDerPt).toBe(9); // 180/20
  expect(p.interlineadoExactoPt).toBe(24); // 480/20, lineRule exact -> puntos absolutos
});

// ---------------------------------------------------------------------------
// Imágenes inline (fase 2a)
// ---------------------------------------------------------------------------

const RELS_UNA_IMAGEN = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type=".../image" Target="media/image1.png"/>
</Relationships>`;

function drawingInline(rId: string, cx: number, cy: number): string {
  return `<w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

test('imagen inline resuelta: refId apunta a word/media/..., tamaño convertido de EMU a pt (12700 EMU/pt)', () => {
  const documentXml = `<w:document><w:body>
    <w:p><w:r>${drawingInline('rId1', 914400, 457200)}</w:r></w:p>
  </w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, null, null, RELS_UNA_IMAGEN);
  const parrafo = soloParrafos(modelo)[0]!;
  const parte = parrafo.partes[0]!;
  expect(parte).toMatchObject({ tipo: 'imagen', refId: 'word/media/image1.png', wPt: 72, hPt: 36 });
  expect(modelo.advertencias.some((a) => /imagen/i.test(a.mensaje))).toBe(false);
});

test('imagen flotante (wp:anchor) sin datos de origen se omite y se avisa (la colocada vive en docx-modelo-2b.test.ts)', () => {
  const documentXml = `<w:document><w:body>
    <w:p><w:r><w:drawing><wp:anchor><wp:extent cx="914400" cy="914400"/></wp:anchor></w:drawing></w:r></w:p>
  </w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, null, null, RELS_UNA_IMAGEN);
  expect(soloParrafos(modelo)[0]!.partes).toEqual([]);
  expect(modelo.advertencias.some((a) => /no se pudo insertar una imagen/i.test(a.mensaje))).toBe(true);
});

test('imagen sin relación resoluble (r:embed que no existe en los rels) se omite y se avisa', () => {
  const documentXml = `<w:document><w:body>
    <w:p><w:r>${drawingInline('rIdInexistente', 914400, 914400)}</w:r></w:p>
  </w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, null, null, RELS_UNA_IMAGEN);
  expect(soloParrafos(modelo)[0]!.partes).toEqual([]);
  expect(modelo.advertencias.some((a) => /imagen/i.test(a.mensaje))).toBe(true);
});

// ---------------------------------------------------------------------------
// Hipervínculos (fase 2a)
// ---------------------------------------------------------------------------

const RELS_ENLACES = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdOk" Type=".../hyperlink" Target="https://example.com" TargetMode="External"/>
  <Relationship Id="rIdJs" Type=".../hyperlink" Target="javascript:alert(1)" TargetMode="External"/>
</Relationships>`;

test('w:hyperlink externo válido: el texto lleva la URL y color/subrayado azul por defecto', () => {
  const documentXml = `<w:document><w:body>
    <w:p><w:hyperlink r:id="rIdOk"><w:r><w:t>haz clic</w:t></w:r></w:hyperlink></w:p>
  </w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, null, null, RELS_ENLACES);
  const parte = soloParrafos(modelo)[0]!.partes[0]!;
  expect(parte).toMatchObject({ tipo: 'texto', texto: 'haz clic', url: 'https://example.com' });
  if (parte.tipo === 'texto') {
    expect(parte.formato.color).toEqual([37, 99, 235]);
    expect(parte.formato.underline).toBe(true);
  }
});

test('w:hyperlink con esquema no permitido (javascript:) NO lleva url y se avisa', () => {
  const documentXml = `<w:document><w:body>
    <w:p><w:hyperlink r:id="rIdJs"><w:r><w:t>peligroso</w:t></w:r></w:hyperlink></w:p>
  </w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, null, null, RELS_ENLACES);
  const parte = soloParrafos(modelo)[0]!.partes[0]!;
  expect(parte).toMatchObject({ tipo: 'texto', texto: 'peligroso' });
  if (parte.tipo === 'texto') expect(parte.url).toBeUndefined();
  expect(modelo.advertencias.some((a) => /enlace/i.test(a.mensaje))).toBe(true);
});

test('un run con color explícito DENTRO de un w:hyperlink respeta ese color ("si el estilo no dice otra cosa")', () => {
  const documentXml = `<w:document><w:body>
    <w:p><w:hyperlink r:id="rIdOk"><w:r><w:rPr><w:color w:val="00FF00"/></w:rPr><w:t>verde</w:t></w:r></w:hyperlink></w:p>
  </w:body></w:document>`;
  const modelo = construirModeloDocx(documentXml, null, null, RELS_ENLACES);
  const parte = soloParrafos(modelo)[0]!.partes[0]!;
  expect(parte).toMatchObject({ tipo: 'texto', url: 'https://example.com' });
  if (parte.tipo === 'texto') expect(parte.formato.color).toEqual([0, 255, 0]);
});

// ---------------------------------------------------------------------------
// T1b: nada se descarta o se aplana en silencio
// ---------------------------------------------------------------------------

function avisos(documentXml: string, rels: string | null = null): string {
  return textosAdvertencias(construirModeloDocx(documentXml, null, null, rels).advertencias).join(' | ');
}

test('enlace interno (w:anchor): conserva el texto y su ancla (se resuelve al paginar); un enlace sin destino resoluble se conserva y se avisa', () => {
  const xml = `<w:document><w:body>
    <w:p><w:hyperlink w:anchor="marcador"><w:r><w:t>ir al marcador</w:t></w:r></w:hyperlink></w:p>
    <w:p><w:hyperlink r:id="rIdNoExiste"><w:r><w:t>sin destino</w:t></w:r></w:hyperlink></w:p>
  </w:body></w:document>`;
  const modelo = construirModeloDocx(xml, null, null, RELS_ENLACES);
  const textos = soloParrafos(modelo).flatMap((p) => p.partes).map((x) => (x as { texto: string }).texto);
  expect(textos).toEqual(['ir al marcador', 'sin destino']);
  expect(textosAdvertencias(modelo.advertencias).join(' | ')).not.toMatch(/enlaces? interno/i);
  expect(modelo.advertencias.filter((a) => /sin destino/i.test(a.mensaje)).map((a) => a.tipo)).toEqual(['omitido']);
});

test('contenido dentro de w:sdt en línea, w:fldSimple, w:customXml y w:moveTo NO se pierde', () => {
  const xml = `<w:document><w:body>
    <w:p>
      <w:sdt><w:sdtContent><w:r><w:t>control</w:t></w:r></w:sdtContent></w:sdt>
      <w:fldSimple w:instr="DATE"><w:r><w:t>campo</w:t></w:r></w:fldSimple>
      <w:customXml><w:r><w:t>xml</w:t></w:r></w:customXml>
      <w:moveTo><w:r><w:t>movido</w:t></w:r></w:moveTo>
    </w:p>
  </w:body></w:document>`;
  const textos = soloParrafos(construirModeloDocx(xml, null, null)).flatMap((p) => p.partes).map((x) => (x as { texto: string }).texto);
  expect(textos).toEqual(['control', 'campo', 'xml', 'movido']);
});

test('un elemento desconocido con texto dentro se avisa en vez de descartarse', () => {
  const xml = `<w:document><w:body><w:p><w:elementoRaro><w:r><w:t>perdido</w:t></w:r></w:elementoRaro><w:r><w:t>ok</w:t></w:r></w:p></w:body></w:document>`;
  expect(avisos(xml)).toMatch(/no reconocid/i);
});

test('ecuaciones, símbolos, objetos incrustados y saltos de columna se avisan', () => {
  const xml = `<w:document><w:body>
    <w:p><m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath></w:p>
    <w:p><w:r><w:sym w:font="Wingdings" w:char="F04A"/></w:r></w:p>
    <w:p><w:r><w:object/></w:r></w:p>
    <w:p><w:r><w:br w:type="column"/></w:r></w:p>
  </w:body></w:document>`;
  const t = avisos(xml);
  expect(t).toMatch(/ecuaci/i);
  expect(t).toMatch(/símbolo/i);
  expect(t).toMatch(/objeto/i);
  expect(t).toMatch(/columna/i);
});

test('las columnas de texto se avisan; varias secciones ya NO avisan (fase 2c: cada una conserva su geometría)', () => {
  const xml = `<w:document><w:body>
    <w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="15840" w:h="12240"/><w:cols w:num="2"/></w:sectPr>
  </w:body></w:document>`;
  const t = avisos(xml);
  expect(t).not.toMatch(/última|todo el documento/i);
  expect(t).toMatch(/columnas/i);
});

test('una lista cuyo numId no está definido se avisa (el marcador se perdería)', () => {
  const xml = `<w:document><w:body>${parrafoLista('99', 0, 'huérfano')}</w:body></w:document>`;
  expect(avisos(xml)).toMatch(/lista|numeraci/i);
});

test('tabla anidada, imagen y salto de página dentro de una celda: el texto se conserva aplanado y se avisa', () => {
  const xml = `<w:document><w:body><w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>
    <w:p><w:r><w:t>externa</w:t></w:r></w:p>
    <w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>
      <w:tr><w:tc><w:p><w:r><w:t>n1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>n2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r>${drawingInline('rId1', 914400, 914400)}</w:r><w:r><w:br w:type="page"/></w:r></w:p>
  </w:tc></w:tr></w:tbl></w:body></w:document>`;
  const modelo = construirModeloDocx(xml, null, null, RELS_UNA_IMAGEN);
  const tabla = modelo.bloques[0]!;
  if (!esTabla(tabla)) throw new Error('tabla');
  const partes = tabla.filas[0]!.celdas[0]!.partes;
  const texto = partes.filter((p) => p.tipo === 'texto').map((p) => (p as { texto: string }).texto).join(' ');
  expect(texto).toContain('externa');
  expect(texto).toContain('n1');
  expect(texto).toContain('n2');
  expect(partes.some((p) => p.tipo === 'imagen' || p.tipo === 'saltoPagina')).toBe(false);
  const t = textosAdvertencias(modelo.advertencias).join(' | ');
  expect(t).toMatch(/anidada/i);
  expect(t).toMatch(/imagen.*(tabla|celda)|(tabla|celda).*imagen/i);
  expect(t).toMatch(/salto de página.*(tabla|celda)|(tabla|celda).*salto de página/i);
});
