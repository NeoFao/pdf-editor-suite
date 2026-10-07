import { test, expect } from 'vitest';
import { textosAdvertencias } from '../../src/convert/advertencia';
import { construirModeloDocx, esParrafo, esTabla, type Parrafo, type BloqueDocx } from '../../src/convert/docx/modelo';

/**
 * Word fase 2c (§9 fila #4), MODELO (puro, sin motor): varias secciones, imágenes y tablas dentro de encabezados y
 * pies, ajuste de texto alrededor de imágenes flotantes y paradas de tabulación.
 */
const RELS = '<Relationships><Relationship Id="rH1" Type="x/header" Target="header1.xml"/><Relationship Id="rH2" Type="x/header" Target="header2.xml"/><Relationship Id="rF1" Type="x/footer" Target="footer1.xml"/><Relationship Id="rF2" Type="x/footer" Target="footer2.xml"/><Relationship Id="rI" Type="x/image" Target="media/doc.png"/></Relationships>';
const hdr = (t: string) => `<w:hdr><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:hdr>`;
const PARTES = { 'word/header1.xml': hdr('cab uno'), 'word/header2.xml': hdr('cab dos'), 'word/footer1.xml': '<w:ftr><w:p><w:r><w:t>pie uno</w:t></w:r></w:p></w:ftr>', 'word/footer2.xml': '<w:ftr><w:p><w:r><w:t>pie dos</w:t></w:r></w:p></w:ftr>' };
const p = (t: string, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:r><w:t>${t}</w:t></w:r></w:p>`;
const A4V = '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="360"/>';
const APAISADA = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360"/>';
const documento = (cuerpo: string) => `<w:document><w:body>${cuerpo}</w:body></w:document>`;
const textosZona = (z: BloqueDocx[] | null) => (z ?? []).filter(esParrafo).flatMap((q) => q.partes).map((x) => (x.tipo === 'texto' ? x.texto : `<${x.tipo}>`));
const avisos = (m: ReturnType<typeof construirModeloDocx>) => textosAdvertencias(m.advertencias).join(' | ');

// ---------------------------------------------------------------------------
// Secciones
// ---------------------------------------------------------------------------

test('dos secciones: cada una con su tamaño, orientación y márgenes; los bloques se reparten por sección', () => {
  const xml = documento(p('uno') + p('fin sección uno', `<w:sectPr>${A4V}</w:sectPr>`) + p('dos') + p('tres') + `<w:sectPr>${APAISADA}</w:sectPr>`);
  const m = construirModeloDocx(xml, null, null);
  expect(m.secciones).toHaveLength(2);
  const [s1, s2] = m.secciones!;
  expect([s1!.paginaAnchoPt, s1!.paginaAltoPt, s1!.margenSupPt, s1!.margenIzqPt]).toEqual([612, 792, 72, 72]);
  expect([s2!.paginaAnchoPt, s2!.paginaAltoPt, s2!.margenSupPt, s2!.margenIzqPt]).toEqual([792, 612, 36, 54]);
  expect([s1!.inicioBloque, s1!.finBloque]).toEqual([0, 2]);
  expect([s2!.inicioBloque, s2!.finBloque]).toEqual([2, 4]);
  expect(s1!.tipo).toBe('nextPage');
  // Los campos de siempre describen la ÚLTIMA sección (compatibilidad).
  expect([m.paginaAnchoPt, m.paginaAltoPt]).toEqual([792, 612]);
  // Y ya no se avisa de "se usa la última sección para todo el documento".
  expect(avisos(m)).not.toMatch(/secciones/i);
});

test('el tipo de salto de sección se lee de w:type: continuous se respeta; evenPage/oddPage pasan a nextPage con aviso "aproximado"', () => {
  const sec = (tipo: string) => `<w:sectPr><w:type w:val="${tipo}"/>${A4V}</w:sectPr>`;
  const cont = construirModeloDocx(documento(p('a', sec('nextPage')) + p('b') + sec('continuous')), null, null);
  expect(cont.secciones!.map((s) => s.tipo)).toEqual(['nextPage', 'continuous']);
  expect(avisos(cont)).not.toMatch(/par|impar|even|odd/i);

  const par = construirModeloDocx(documento(p('a') + p('b', sec('evenPage')) + p('c') + sec('oddPage')), null, null);
  expect(par.secciones!.map((s) => s.tipo)).toEqual(['nextPage', 'nextPage']);
  const aviso = par.advertencias.find((a) => /página par|página impar/i.test(a.mensaje));
  expect(aviso).toBeDefined();
  expect(aviso!.tipo).toBe('aproximado');
});

test('encabezados y pies por sección: la que no define uno HEREDA el de la anterior (por tipo); la que lo define usa el suyo', () => {
  const s1 = `<w:sectPr><w:headerReference w:type="default" r:id="rH1"/><w:footerReference w:type="default" r:id="rF1"/>${A4V}</w:sectPr>`;
  const s2 = `<w:sectPr><w:headerReference w:type="default" r:id="rH2"/>${A4V}</w:sectPr>`;
  const m = construirModeloDocx(documento(p('a', s1) + p('b', s2) + p('c') + `<w:sectPr>${A4V}</w:sectPr>`), null, null, RELS, { partes: PARTES });
  const [a, b, c] = m.secciones!;
  expect(textosZona(a!.encabezados.default)).toEqual(['cab uno']);
  expect(textosZona(b!.encabezados.default)).toEqual(['cab dos']);
  expect(textosZona(c!.encabezados.default)).toEqual(['cab dos']); // hereda de la 2
  expect(textosZona(b!.pies.default)).toEqual(['pie uno']); // el pie no se redefine: hereda
  expect(textosZona(c!.pies.default)).toEqual(['pie uno']);
  // Ninguna referencia queda sin usar: ya no se avisa de "zonas de secciones anteriores".
  expect(avisos(m)).not.toMatch(/sección anterior|secciones anteriores/i);
});

test('w:titlePg y los márgenes de encabezado/pie son POR SECCIÓN', () => {
  const s1 = `<w:sectPr><w:headerReference w:type="first" r:id="rH1"/><w:titlePg/>${A4V}</w:sectPr>`;
  const m = construirModeloDocx(documento(p('a', s1) + p('b') + `<w:sectPr>${APAISADA}</w:sectPr>`), null, null, RELS, { partes: PARTES });
  expect(m.secciones!.map((s) => s.tituloPagina)).toEqual([true, false]);
  expect(m.secciones!.map((s) => [s.margenEncabezadoPt, s.margenPiePt])).toEqual([[36, 18], [18, 18]]);
});

test('w:pgNumType w:start reinicia la numeración de la sección; sin él la numeración continúa (null)', () => {
  const s1 = `<w:sectPr>${A4V}</w:sectPr>`;
  const s2 = `<w:sectPr><w:pgNumType w:start="5"/>${A4V}</w:sectPr>`;
  const m = construirModeloDocx(documento(p('a', s1) + p('b') + s2), null, null);
  expect(m.secciones!.map((s) => s.numeroInicial)).toEqual([null, 5]);
});

test('un formato de número de página que no es arábigo (w:fmt) se avisa como aproximado', () => {
  const m = construirModeloDocx(documento(p('a') + `<w:sectPr><w:pgNumType w:fmt="lowerRoman"/>${A4V}</w:sectPr>`), null, null);
  const aviso = m.advertencias.find((a) => /numeración|número de página/i.test(a.mensaje));
  expect(aviso?.tipo).toBe('aproximado');
});

test('un documento de una sola sección produce exactamente una (y el campo `secciones` existe)', () => {
  const m = construirModeloDocx(documento(p('a') + `<w:sectPr>${A4V}</w:sectPr>`), null, null);
  expect(m.secciones).toHaveLength(1);
  expect([m.secciones![0]!.inicioBloque, m.secciones![0]!.finBloque]).toEqual([0, 1]);
});

// ---------------------------------------------------------------------------
// Imágenes y tablas dentro de encabezados y pies
// ---------------------------------------------------------------------------

const REL_CAB_IMG = '<Relationships><Relationship Id="rLogo" Type="x/image" Target="media/logo.png"/></Relationships>';
const dibujo = (rid: string, ancla = '') => ancla
  ? `<w:drawing><wp:anchor ${ancla}><wp:positionH relativeFrom="page"><wp:posOffset>457200</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>228600</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="457200"/><wp:wrapNone/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`
  : `<w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
const SECT_H = `<w:sectPr><w:headerReference w:type="default" r:id="rH1"/>${A4V}</w:sectPr>`;
const zonaH = (xmlCab: string, relsCab: string | null = REL_CAB_IMG) =>
  construirModeloDocx(documento(p('cuerpo') + SECT_H), null, null, RELS, { partes: { 'word/header1.xml': xmlCab }, relsPartes: relsCab ? { 'word/header1.xml': relsCab } : {} });

test('una imagen inline en el encabezado se resuelve con las relaciones del PROPIO encabezado y no avisa', () => {
  const m = zonaH(`<w:hdr><w:p><w:r>${dibujo('rLogo')}</w:r></w:p></w:hdr>`);
  const parte = (m.encabezados.default![0] as Parrafo).partes[0]!;
  expect(parte).toMatchObject({ tipo: 'imagen', refId: 'word/media/logo.png', wPt: 72, hPt: 36 });
  expect(avisos(m)).not.toMatch(/imagen/i);
});

test('una imagen del encabezado sin relación en el paquete se omite CON aviso (omitido)', () => {
  const m = zonaH(`<w:hdr><w:p><w:r>${dibujo('rLogo')}</w:r></w:p></w:hdr>`, null);
  const aviso = m.advertencias.find((a) => /imagen/i.test(a.mensaje));
  expect(aviso?.tipo).toBe('omitido');
});

test('una imagen FLOTANTE (wp:anchor) del encabezado conserva su posición', () => {
  const m = zonaH(`<w:hdr><w:p><w:r>${dibujo('rLogo', 'behindDoc="1"')}</w:r></w:p></w:hdr>`);
  const parte = (m.encabezados.default![0] as Parrafo).partes[0]!;
  expect(parte.tipo === 'imagen' && parte.flotante).toMatchObject({ h: { rel: 'page', offsetPt: 36 }, v: { rel: 'page', offsetPt: 18 } });
});

test('una tabla dentro del encabezado se conserva como Tabla (ya no se omite con aviso)', () => {
  const tabla = '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Empresa</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Informe</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const m = zonaH(`<w:hdr>${tabla}<w:p/></w:hdr>`);
  const zona = m.encabezados.default!;
  expect(esTabla(zona[0]!)).toBe(true);
  expect(avisos(m)).not.toMatch(/tabla/i);
});

// ---------------------------------------------------------------------------
// Ajuste de texto alrededor de imágenes flotantes
// ---------------------------------------------------------------------------

const RELS_IMG = '<Relationships><Relationship Id="rI" Type="x/image" Target="media/doc.png"/></Relationships>';
function flotante(ajuste: string, atrAnchor = 'distT="0" distB="0" distL="114300" distR="114300" behindDoc="0"') {
  const xml = documento(`<w:p><w:r><w:drawing><wp:anchor ${atrAnchor}><wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="1828800" cy="1828800"/>${ajuste}<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rI"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing><w:t>texto</w:t></w:r></w:p>`);
  const m = construirModeloDocx(xml, null, null, RELS_IMG);
  const parte = (m.bloques[0] as Parrafo).partes.find((x) => x.tipo === 'imagen');
  return { m, flotante: parte && parte.tipo === 'imagen' ? parte.flotante : undefined };
}

test('wrapSquare: la flotante lleva ajuste `square` con distL/distR (EMU → pt) y NO avisa de "sin ajuste de texto"', () => {
  const { m, flotante: f } = flotante('<wp:wrapSquare wrapText="bothSides"/>');
  expect(f!.ajuste).toEqual({ modo: 'square', distLPt: 9, distRPt: 9, distTPt: 0, distBPt: 0 });
  expect(avisos(m)).not.toMatch(/sin ajuste/i);
});

test('las distancias propias de wp:wrapSquare mandan sobre las de wp:anchor', () => {
  const { flotante: f } = flotante('<wp:wrapSquare wrapText="largest" distT="25400" distB="50800" distL="12700" distR="38100"/>');
  expect(f!.ajuste).toEqual({ modo: 'square', distLPt: 1, distRPt: 3, distTPt: 2, distBPt: 4 });
});

test('wrapTopAndBottom: ajuste `topBottom`', () => {
  const { m, flotante: f } = flotante('<wp:wrapTopAndBottom/>');
  expect(f!.ajuste?.modo).toBe('topBottom');
  expect(avisos(m)).not.toMatch(/sin ajuste/i);
});

test('wrapTight y wrapThrough (polígonos) se tratan como cuadrado con aviso "aproximado"', () => {
  for (const tag of ['<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/></wp:wrapPolygon></wp:wrapTight>', '<wp:wrapThrough wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/></wp:wrapPolygon></wp:wrapThrough>']) {
    const { m, flotante: f } = flotante(tag);
    expect(f!.ajuste?.modo).toBe('square');
    const aviso = m.advertencias.find((a) => /polígono|cuadrad/i.test(a.mensaje));
    expect(aviso?.tipo).toBe('aproximado');
  }
});

test('wrapNone (o sin elemento de ajuste) sigue SIN ajuste y con el aviso de siempre', () => {
  for (const tag of ['<wp:wrapNone/>', '']) {
    const { m, flotante: f } = flotante(tag);
    expect(f!.ajuste).toBeUndefined();
    expect(avisos(m)).toMatch(/sin ajuste de texto/i);
  }
});

// ---------------------------------------------------------------------------
// Tabulaciones
// ---------------------------------------------------------------------------

const parrafoTabs = (ppr: string, styles: string | null = null, extras = {}) => {
  const m = construirModeloDocx(documento(`<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:r><w:t>Capítulo</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>3</w:t></w:r></w:p>`), styles, null, null, extras);
  return m;
};

test('w:tabs de un párrafo: posición (twips → pt desde el margen), tipo y líder', () => {
  const m = parrafoTabs('<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9360"/><w:tab w:val="center" w:pos="4680"/><w:tab w:val="decimal" w:pos="2000" w:leader="hyphen"/></w:tabs>');
  const tabs = (m.bloques[0] as Parrafo).tabs;
  expect(tabs).toEqual([
    { posPt: 100, tipo: 'decimal', leader: 'hyphen' },
    { posPt: 234, tipo: 'center', leader: 'none' },
    { posPt: 468, tipo: 'right', leader: 'dot' }
  ]);
});

test('las paradas se heredan del estilo y w:val="clear" borra una heredada; las del párrafo se suman', () => {
  const styles = '<w:styles><w:style w:type="paragraph" w:styleId="Pie"><w:name w:val="footer"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr></w:style></w:styles>';
  const sin = parrafoTabs('<w:pStyle w:val="Pie"/>', styles);
  expect((sin.bloques[0] as Parrafo).tabs.map((t) => [t.posPt, t.tipo])).toEqual([[234, 'center'], [468, 'right']]);
  const conClear = parrafoTabs('<w:pStyle w:val="Pie"/><w:tabs><w:tab w:val="clear" w:pos="4680"/><w:tab w:val="left" w:pos="1000"/></w:tabs>', styles);
  expect((conClear.bloques[0] as Parrafo).tabs.map((t) => [t.posPt, t.tipo])).toEqual([[50, 'left'], [468, 'right']]);
});

test('w:tab del texto sigue siendo una parte `tab`; w:ptab con alineación derecha conserva su alineación', () => {
  const m = construirModeloDocx(documento('<w:p><w:r><w:t>a</w:t></w:r><w:r><w:ptab w:relativeTo="margin" w:alignment="right" w:leader="dot"/></w:r><w:r><w:t>b</w:t></w:r></w:p>'), null, null);
  const partes = (m.bloques[0] as Parrafo).partes;
  expect(partes[1]).toEqual({ tipo: 'tab', ptab: { alineacion: 'right', leader: 'dot' } });
});

test('la parada por defecto sale de w:defaultTabStop de settings.xml (36 pt si no está)', () => {
  expect(parrafoTabs('').tabPorDefectoPt).toBe(36);
  const m = parrafoTabs('', null, { settingsXml: '<w:settings><w:defaultTabStop w:val="1440"/></w:settings>' });
  expect(m.tabPorDefectoPt).toBe(72);
});

test('un tabulador dentro de una celda de tabla sigue aproximándose y AHORA lo avisa (aproximado)', () => {
  const xml = documento('<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>');
  const m = construirModeloDocx(xml, null, null);
  expect(m.advertencias.find((a) => /tabulaci/i.test(a.mensaje))?.tipo).toBe('aproximado');
});

test('un enlace externo del encabezado se resuelve con las relaciones del PROPIO encabezado (no con las del documento)', () => {
  const relsCab = '<Relationships><Relationship Id="rId1" Type="x/hyperlink" Target="https://example.com/cab" TargetMode="External"/></Relationships>';
  // En las relaciones del documento "rId1" es OTRA cosa (una imagen): no debe confundirse.
  const relsDoc = '<Relationships><Relationship Id="rH1" Type="x/header" Target="header1.xml"/><Relationship Id="rId1" Type="x/image" Target="media/x.png"/></Relationships>';
  const xml = documento(p('cuerpo') + '<w:sectPr><w:headerReference w:type="default" r:id="rH1"/>' + A4V + '</w:sectPr>');
  const cab = '<w:hdr><w:p><w:hyperlink r:id="rId1"><w:r><w:t>sitio</w:t></w:r></w:hyperlink></w:p></w:hdr>';
  const m = construirModeloDocx(xml, null, null, relsDoc, { partes: { 'word/header1.xml': cab }, relsPartes: { 'word/header1.xml': relsCab } });
  const parte = (m.encabezados.default![0] as Parrafo).partes[0]!;
  expect(parte).toMatchObject({ tipo: 'texto', texto: 'sitio', url: 'https://example.com/cab' });
});
