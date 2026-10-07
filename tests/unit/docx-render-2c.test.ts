import { test, expect } from 'vitest';
import { construirModeloDocx } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';
import { textosAdvertencias } from '../../src/convert/advertencia';

/**
 * Word fase 2c, MAQUETACIÓN (modelo → páginas), con un `medir` falso exacto (5 pt por carácter): varias secciones
 * (tamaño propio, numeración, encabezados por sección), imágenes y tablas en encabezados, texto alrededor de flotantes y
 * tabulaciones reales (incluido el "Página X de Y" alineado a la derecha).
 */
const medir = (_f: string, _s: number, t: string): number => t.length * 5;

/** Página de 612x200 pt, márgenes de 40 pt arriba/abajo (120 pt útiles: 10 líneas), encabezado a 10 pt y pie a 10 pt del borde. */
const PG_BAJA = '<w:pgSz w:w="12240" w:h="4000"/><w:pgMar w:top="800" w:right="1440" w:bottom="800" w:left="1440" w:header="200" w:footer="200"/>';
/** Apaisada de 400x300 pt con márgenes de 30 pt a los lados y 40 pt arriba/abajo. */
const PG_APAISADA = '<w:pgSz w:w="8000" w:h="6000" w:orient="landscape"/><w:pgMar w:top="800" w:right="600" w:bottom="800" w:left="600" w:header="200" w:footer="200"/>';
/** Alta de 612x600 pt, márgenes de 72 pt. */
const PG_ALTA = '<w:pgSz w:w="12240" w:h="12000"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>';

const SPC = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>';
const RPR = '<w:rPr><w:sz w:val="20"/></w:rPr>';
const par = (t: string, ppr = '') => `<w:p><w:pPr>${SPC}${ppr}</w:pPr><w:r>${RPR}<w:t>${t}</w:t></w:r></w:p>`;
const lineas = (n: number, pref = 'L') => Array.from({ length: n }, (_v, i) => par(`${pref}${i + 1}`)).join('');
const finSeccion = (pg: string, extra = '') => `<w:p><w:pPr>${SPC}<w:sectPr>${extra}${pg}</w:sectPr></w:pPr><w:r>${RPR}<w:t>FIN</w:t></w:r></w:p>`;
const doc = (cuerpo: string) => `<w:document><w:body>${cuerpo}</w:body></w:document>`;
const paginaDe = (res: ReturnType<typeof renderizarModeloDocx>, texto: string) => res.trazos.filter((t) => t.text === texto).map((t) => t.page);

const RELS = '<Relationships><Relationship Id="rH1" Type="x/header" Target="header1.xml"/><Relationship Id="rH2" Type="x/header" Target="header2.xml"/><Relationship Id="rH3" Type="x/header" Target="header3.xml"/><Relationship Id="rF1" Type="x/footer" Target="footer1.xml"/><Relationship Id="rI" Type="x/image" Target="media/doc.png"/></Relationships>';
const hdr = (t: string) => `<w:hdr>${par(t)}</w:hdr>`;
const PIE_PAGINA = `<w:ftr><w:p><w:pPr><w:jc w:val="center"/>${SPC}</w:pPr><w:r>${RPR}<w:t xml:space="preserve">Página </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r>${RPR}<w:t>1</w:t></w:r></w:fldSimple><w:r>${RPR}<w:t xml:space="preserve"> de </w:t></w:r><w:fldSimple w:instr="NUMPAGES"><w:r>${RPR}<w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;

// ---------------------------------------------------------------------------
// Secciones
// ---------------------------------------------------------------------------

test('dos secciones: la segunda usa SU tamaño apaisado y SUS márgenes; cada página lo registra', () => {
  const m = construirModeloDocx(doc(lineas(2, 'A') + finSeccion(PG_BAJA) + lineas(2, 'B') + `<w:sectPr>${PG_APAISADA}</w:sectPr>`), null, null);
  const res = renderizarModeloDocx(m, medir);
  expect(res.totalPaginas).toBe(2);
  expect(res.paginas.map((p) => [p.geo.widthPt, p.geo.heightPt])).toEqual([[612, 200], [400, 300]]);
  const b1 = res.trazos.find((t) => t.text === 'B1')!;
  expect(b1.page).toBe(1);
  expect(b1.xPt).toBe(30); // margen izquierdo de la sección apaisada (600 twips)
  expect(b1.yPt).toBeGreaterThan(300 - 40 - 12); // dentro del margen superior de 40 pt de SU sección
  expect(res.trazos.find((t) => t.text === 'A1')!.xPt).toBe(72);
  expect(textosAdvertencias(res.advertencias)).toEqual([]);
});

test('la numeración de página reinicia con w:pgNumType w:start; "de Y" sigue siendo el total físico', () => {
  const sec1 = finSeccion(PG_BAJA, '<w:footerReference w:type="default" r:id="rF1"/>');
  const sec2 = `<w:sectPr><w:footerReference w:type="default" r:id="rF1"/><w:pgNumType w:start="5"/>${PG_BAJA}</w:sectPr>`;
  const m = construirModeloDocx(doc(lineas(1, 'A') + sec1 + lineas(1, 'B') + sec2), null, null, RELS, { partes: { 'word/footer1.xml': PIE_PAGINA } });
  const res = renderizarModeloDocx(m, medir);
  expect(res.totalPaginas).toBe(2);
  const pies = res.trazos.filter((t) => /^Página \d de \d$/.test(t.text)).map((t) => [t.page, t.text]);
  expect(pies.sort()).toEqual([[0, 'Página 1 de 2'], [1, 'Página 5 de 2']]);
});

test('sin reinicio, la numeración continúa de una sección a otra', () => {
  const sec1 = finSeccion(PG_BAJA, '<w:footerReference w:type="default" r:id="rF1"/>');
  const m = construirModeloDocx(doc(lineas(1, 'A') + sec1 + lineas(1, 'B') + `<w:sectPr>${PG_BAJA}</w:sectPr>`), null, null, RELS, { partes: { 'word/footer1.xml': PIE_PAGINA } });
  const res = renderizarModeloDocx(m, medir);
  expect(res.trazos.filter((t) => /^Página \d de \d$/.test(t.text)).map((t) => [t.page, t.text]).sort()).toEqual([[0, 'Página 1 de 2'], [1, 'Página 2 de 2']]);
});

test('cada sección lleva SU encabezado y su w:titlePg actúa solo en la primera página de ESA sección', () => {
  const s1 = finSeccion(PG_BAJA, '<w:headerReference w:type="default" r:id="rH1"/>');
  const s2 = `<w:sectPr><w:headerReference w:type="default" r:id="rH2"/><w:headerReference w:type="first" r:id="rH3"/><w:titlePg/>${PG_BAJA}</w:sectPr>`;
  const partes = { 'word/header1.xml': hdr('H1'), 'word/header2.xml': hdr('H2'), 'word/header3.xml': hdr('H2first') };
  const m = construirModeloDocx(doc(lineas(14, 'A') + s1 + lineas(14, 'B') + s2), null, null, RELS, { partes });
  const res = renderizarModeloDocx(m, medir);
  expect(res.totalPaginas).toBe(4); // 15 líneas (con FIN) → 2 páginas por sección
  expect(paginaDe(res, 'H1')).toEqual([0, 1]);
  expect(paginaDe(res, 'H2first')).toEqual([2]);
  expect(paginaDe(res, 'H2')).toEqual([3]);
});

test('una sección continua sigue en la misma página (no abre una nueva)', () => {
  const m = construirModeloDocx(doc(lineas(2, 'A') + finSeccion(PG_BAJA) + lineas(2, 'B') + `<w:sectPr><w:type w:val="continuous"/>${PG_BAJA}</w:sectPr>`), null, null);
  const res = renderizarModeloDocx(m, medir);
  expect(res.totalPaginas).toBe(1);
  expect(paginaDe(res, 'B2')).toEqual([0]);
});

test('una sección final sin contenido no deja una página en blanco', () => {
  const m = construirModeloDocx(doc(lineas(2, 'A') + finSeccion(PG_BAJA) + `<w:sectPr>${PG_APAISADA}</w:sectPr>`), null, null);
  expect(renderizarModeloDocx(m, medir).totalPaginas).toBe(1);
});

test('el salto de sección evenPage se trata como nextPage y avisa "aproximado"', () => {
  const m = construirModeloDocx(doc(lineas(1, 'A') + finSeccion(PG_BAJA) + lineas(1, 'B') + `<w:sectPr><w:type w:val="evenPage"/>${PG_BAJA}</w:sectPr>`), null, null);
  const res = renderizarModeloDocx(m, medir);
  expect(res.totalPaginas).toBe(2);
  expect(m.advertencias.some((a) => a.tipo === 'aproximado' && /página par/i.test(a.mensaje))).toBe(true);
});

// ---------------------------------------------------------------------------
// Imágenes y tablas en encabezados
// ---------------------------------------------------------------------------

const REL_LOGO = '<Relationships><Relationship Id="rLogo" Type="x/image" Target="media/logo.png"/></Relationships>';
const logo = (cxPt: number, cyPt: number) => `<w:drawing><wp:inline><wp:extent cx="${cxPt * 12700}" cy="${cyPt * 12700}"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rLogo"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
const conCab = (cab: string, cuerpo: string, pg = PG_BAJA) => {
  const m = construirModeloDocx(doc(`${cuerpo}<w:sectPr><w:headerReference w:type="default" r:id="rH1"/>${pg}</w:sectPr>`), null, null, RELS, { partes: { 'word/header1.xml': cab }, relsPartes: { 'word/header1.xml': REL_LOGO } });
  return { m, res: renderizarModeloDocx(m, medir) };
};

test('el logo del encabezado sale en CADA página y empuja el cuerpo si es más alto que el margen', () => {
  const { res } = conCab(`<w:hdr><w:p><w:pPr>${SPC}</w:pPr><w:r>${logo(120, 60)}</w:r></w:p></w:hdr>`, lineas(25));
  expect(res.totalPaginas).toBeGreaterThanOrEqual(3);
  const logos = res.imagenes.filter((i) => i.imgId === 'word/media/logo.png');
  expect(logos.map((i) => i.page)).toEqual(Array.from({ length: res.totalPaginas }, (_v, i) => i));
  expect([logos[0]!.wPt, logos[0]!.hPt]).toEqual([120, 60]);
  // Encabezado a 10 pt del borde + 60 pt de logo = 70 pt > margen de 40 pt: el cuerpo empieza más abajo.
  expect(res.trazos.find((t) => t.text === 'L1')!.yPt).toBeLessThan(200 - 70);
  // Y el logo queda dentro de la franja del encabezado.
  expect(logos[0]!.yPt + logos[0]!.hPt).toBeLessThanOrEqual(190.01);
  expect(textosAdvertencias(res.advertencias)).toEqual([]);
});

test('una tabla en el encabezado se pinta en cada página (texto y bordes) sin avisos', () => {
  const tabla = '<w:tbl><w:tblPr><w:tblBorders><w:bottom w:val="single" w:sz="8" w:color="000000"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Empresa</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Informe</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const { res } = conCab(`<w:hdr>${tabla}<w:p/></w:hdr>`, lineas(25));
  expect(paginaDe(res, 'Empresa')).toEqual(Array.from({ length: res.totalPaginas }, (_v, i) => i));
  expect(paginaDe(res, 'Informe')).toEqual(paginaDe(res, 'Empresa'));
  expect(res.barras.filter((b) => b.page === 0 && b.yPt > 150).length).toBeGreaterThan(0); // el borde inferior de la tabla del encabezado
  expect(textosAdvertencias(res.advertencias)).toEqual([]);
});

test('un encabezado absurdamente alto se acota a un tercio de la página y avisa "aproximado"', () => {
  const { res, m } = conCab(`<w:hdr><w:p><w:pPr>${SPC}</w:pPr><w:r>${logo(300, 300)}</w:r></w:p></w:hdr>`, lineas(3));
  const logoPag = res.imagenes.find((i) => i.imgId === 'word/media/logo.png')!;
  expect(logoPag.hPt).toBeLessThanOrEqual(200 * 0.33);
  expect(m.advertencias.length).toBe(0); // el modelo no avisa: es el maquetador quien acota
  expect(res.advertencias.some((a) => a.tipo === 'aproximado' && /encabezado|pie/i.test(a.mensaje))).toBe(true);
  // El cuerpo sigue teniendo sitio (no se queda con alto 0).
  expect(res.trazos.find((t) => t.text === 'L1')).toBeDefined();
});

test('una imagen flotante del encabezado (logo anclado a la página) se coloca en su sitio en cada página', () => {
  const flot = `<w:drawing><wp:anchor behindDoc="1"><wp:positionH relativeFrom="page"><wp:posOffset>254000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>127000</wp:posOffset></wp:positionV><wp:extent cx="508000" cy="254000"/><wp:wrapNone/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rLogo"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
  const { res } = conCab(`<w:hdr><w:p><w:pPr>${SPC}</w:pPr><w:r>${flot}</w:r></w:p></w:hdr>`, lineas(25));
  const logos = res.imagenes.filter((i) => i.imgId === 'word/media/logo.png');
  expect(logos).toHaveLength(res.totalPaginas);
  expect([logos[0]!.xPt, logos[0]!.yPt, logos[0]!.wPt, logos[0]!.hPt]).toEqual([20, 200 - 10 - 20, 40, 20]);
});

// ---------------------------------------------------------------------------
// Texto alrededor de imágenes flotantes
// ---------------------------------------------------------------------------

const PALABRAS = Array.from({ length: 160 }, () => 'palabra').join(' ');
function conFlotante(ajuste: string) {
  const dibujo = `<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="0" behindDoc="0"><wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="1270000" cy="1270000"/>${ajuste}<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rI"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
  const m = construirModeloDocx(doc(`<w:p><w:pPr>${SPC}</w:pPr><w:r>${RPR}${dibujo}<w:t>${PALABRAS}</w:t></w:r></w:p><w:sectPr>${PG_ALTA}</w:sectPr>`), null, null, RELS);
  const res = renderizarModeloDocx(m, medir);
  const img = res.imagenes[0]!;
  // Líneas por y (línea base) con su x mínima y fin máximo.
  const lineasTxt = new Map<number, { x: number; fin: number }>();
  for (const t of res.trazos) { const l = lineasTxt.get(t.yPt) ?? { x: Infinity, fin: 0 }; l.x = Math.min(l.x, t.xPt); l.fin = Math.max(l.fin, t.xPt + t.text.length * 5); lineasTxt.set(t.yPt, l); }
  return { m, res, img, lineas: [...lineasTxt.entries()].sort((a, b) => b[0] - a[0]).map(([y, l]) => ({ y, ...l })) };
}

test('wrapSquare: las líneas que se cruzan con la imagen (100x100 pt a la derecha, 9 pt de separación) acaban a su izquierda; las demás, no', () => {
  const { img, lineas: ls, res } = conFlotante('<wp:wrapSquare wrapText="bothSides"/>');
  expect([img.wPt, img.hPt]).toEqual([100, 100]);
  expect(img.xPt + img.wPt).toBe(540);
  const cruzan = ls.filter((l) => l.y > img.yPt - 12 && l.y < img.yPt + img.hPt + 12); // línea base dentro del tramo de la imagen (±12)
  const dentro = ls.filter((l) => l.y - 12 * 0.28 >= img.yPt - 0.01 && l.y - 12 * 0.28 + 12 <= img.yPt + img.hPt + 0.01);
  expect(dentro.length).toBeGreaterThanOrEqual(6);
  for (const l of dentro) expect(l.fin).toBeLessThanOrEqual(img.xPt - 9 + 0.01);
  expect(cruzan.length).toBeGreaterThan(0);
  // Pasada la imagen el texto vuelve a usar todo el ancho (algo supera la x de la imagen).
  expect(ls.some((l) => l.fin > img.xPt)).toBe(true);
  // Ninguna palabra se pierde: 160 palabras en total.
  expect(res.trazos.map((t) => t.text).join(' ').split(' ').filter((w) => w === 'palabra').length).toBe(160);
  expect(textosAdvertencias(res.advertencias).join(' ')).not.toMatch(/ajuste/i);
});

test('wrapTopAndBottom: ninguna línea de texto se cruza con la imagen; el texto sigue debajo', () => {
  const { img, res } = conFlotante('<wp:wrapTopAndBottom/>');
  for (const t of res.trazos) {
    const fondo = t.yPt - 12 * 0.28;
    expect(fondo + 12 <= img.yPt + 0.01 || fondo >= img.yPt + img.hPt - 0.01).toBe(true);
  }
  expect(res.trazos.some((t) => t.yPt < img.yPt)).toBe(true);
});

test('con wrapNone el texto NO se aparta (como hasta ahora) y avisa', () => {
  const { img, lineas: ls, m } = conFlotante('<wp:wrapNone/>');
  expect(ls.some((l) => l.y > img.yPt && l.y < img.yPt + img.hPt && l.fin > img.xPt)).toBe(true);
  expect(textosAdvertencias(m.advertencias).join(' ')).toMatch(/sin ajuste/i);
});

// ---------------------------------------------------------------------------
// Tabulaciones
// ---------------------------------------------------------------------------

const TAB_DER = '<w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs>';

test('un párrafo "Izq TAB Der" con parada derecha deja "Der" terminando en el margen derecho', () => {
  const m = construirModeloDocx(doc(`<w:p><w:pPr>${SPC}${TAB_DER}</w:pPr><w:r>${RPR}<w:t>Izq</w:t></w:r><w:r>${RPR}<w:tab/></w:r><w:r>${RPR}<w:t>Der</w:t></w:r></w:p><w:sectPr>${PG_BAJA}</w:sectPr>`), null, null);
  const res = renderizarModeloDocx(m, medir);
  const der = res.trazos.find((t) => t.text === 'Der')!;
  expect(der.xPt + 15).toBe(540); // 72 + 468
  expect(res.trazos.find((t) => t.text === 'Izq')!.xPt).toBe(72);
  expect(new Set(res.trazos.map((t) => t.yPt)).size).toBe(1);
});

test('índice "Capítulo ........ 3": el líder de puntos llena el hueco y el número acaba en la parada', () => {
  const tabs = '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9360"/></w:tabs>';
  const m = construirModeloDocx(doc(`<w:p><w:pPr>${SPC}${tabs}</w:pPr><w:r>${RPR}<w:t>Capítulo</w:t></w:r><w:r>${RPR}<w:tab/></w:r><w:r>${RPR}<w:t>3</w:t></w:r></w:p><w:sectPr>${PG_BAJA}</w:sectPr>`), null, null);
  const res = renderizarModeloDocx(m, medir);
  const puntos = res.trazos.find((t) => /^\.+$/.test(t.text))!;
  const tres = res.trazos.find((t) => t.text === '3')!;
  expect(puntos.text.length).toBeGreaterThan(40);
  expect(puntos.xPt).toBeGreaterThanOrEqual(72 + 8 * 5);
  expect(puntos.xPt + puntos.text.length * 5).toBeLessThanOrEqual(tres.xPt);
  expect(tres.xPt + 5).toBe(540);
});

test('el pie "Página X de Y" tras una tabulación derecha (parada heredada del estilo Footer) acaba en el margen derecho', () => {
  const styles = '<w:styles><w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr></w:style></w:styles>';
  const pie = `<w:ftr><w:p><w:pPr><w:pStyle w:val="Footer"/>${SPC}</w:pPr><w:r>${RPR}<w:t>Informe</w:t></w:r><w:r>${RPR}<w:tab/></w:r><w:r>${RPR}<w:tab/></w:r><w:r>${RPR}<w:t xml:space="preserve">Página </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r>${RPR}<w:t>1</w:t></w:r></w:fldSimple><w:r>${RPR}<w:t xml:space="preserve"> de </w:t></w:r><w:fldSimple w:instr="NUMPAGES"><w:r>${RPR}<w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
  const m = construirModeloDocx(doc(`${lineas(14)}<w:sectPr><w:footerReference w:type="default" r:id="rF1"/>${PG_BAJA}</w:sectPr>`), styles, null, RELS, { partes: { 'word/footer1.xml': pie } });
  const res = renderizarModeloDocx(m, medir);
  expect(res.totalPaginas).toBe(2);
  for (const n of [0, 1]) {
    const del = res.trazos.filter((t) => t.page === n && t.yPt < 40);
    const fin = Math.max(...del.map((t) => t.xPt + t.text.length * 5));
    expect(fin).toBe(540);
    expect(del.map((t) => t.text).join(' ')).toContain(`Página ${n + 1} de 2`);
    expect(del.find((t) => t.text.startsWith('Informe'))!.xPt).toBe(72);
  }
});

test('un párrafo sin tabulaciones produce las mismas líneas que antes (el camino flexible no cambia nada sin obstáculos)', () => {
  const texto = Array.from({ length: 60 }, (_v, i) => `pal${i}`).join(' ');
  const base = renderizarModeloDocx(construirModeloDocx(doc(`<w:p><w:pPr>${SPC}</w:pPr><w:r>${RPR}<w:t>${texto}</w:t></w:r></w:p><w:sectPr>${PG_ALTA}</w:sectPr>`), null, null), medir);
  // Mismo texto + una flotante con wrapNone lejos (el documento no tiene ajuste real: se mantiene el camino de siempre) y otro con wrapSquare pequeña fuera de la página (camino flexible).
  const conAjusteLejano = renderizarModeloDocx(construirModeloDocx(doc(`<w:p><w:pPr>${SPC}</w:pPr><w:r>${RPR}<w:drawing><wp:anchor><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>6000000</wp:posOffset></wp:positionV><wp:extent cx="127000" cy="127000"/><wp:wrapSquare wrapText="bothSides"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rI"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing><w:t>${texto}</w:t></w:r></w:p><w:sectPr>${PG_ALTA}</w:sectPr>`), null, null, RELS), medir);
  const firma = (r: typeof base) => r.trazos.map((t) => `${t.page}|${t.xPt}|${t.yPt}|${t.text}`);
  expect(firma(conAjusteLejano)).toEqual(firma(base));
});
