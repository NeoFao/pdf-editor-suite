import { test, expect } from 'vitest';
import { construirModeloDocx, esParrafo } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';
import { textosAdvertencias } from '../../src/convert/advertencia';

/**
 * E-118: columnas de sección de Word (`w:cols`) y saltos de columna (`w:br w:type="column"`).
 * Página de 300 x 200 pt con márgenes de 20 (área de texto 260 x 160); líneas de 12 pt exactos con letra de 10 pt, así que caben 13 por columna.
 * Medida falsa: cada carácter ocupa 0,5 x tamaño pt (5 pt a 10 pt). Unidades: pt de página con origen abajo-izquierda.
 */
const medir = (_f: string, sz: number, s: string): number => s.length * sz * 0.5;
const ESP = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>';
const PG = '<w:pgSz w:w="6000" w:h="4000"/><w:pgMar w:top="400" w:right="400" w:bottom="400" w:left="400" w:header="0" w:footer="0"/>';
const sect = (cols = '', tipo = '') => `<w:sectPr>${tipo}${PG}${cols}</w:sectPr>`;
const DOS = '<w:cols w:num="2" w:space="400"/>'; // 2 x 120 pt, hueco de 20 pt: la 2.ª columna empieza en x = 160
const par = (t: string, extra = '') => `<w:p><w:pPr>${ESP}${extra}</w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${t}</w:t></w:r></w:p>`;
const doc = (cuerpo: string, finalSect: string) => `<w:document><w:body>${cuerpo}${finalSect}</w:body></w:document>`;
const lineas = (n: number, pref = 'L') => Array.from({ length: n }, (_, i) => par(`${pref}${i + 1}`)).join('');
const render = (xml: string) => renderizarModeloDocx(construirModeloDocx(xml, null, null, null), medir);
const t = (r: ReturnType<typeof render>, texto: string) => r.trazos.find((x) => x.text === texto)!;

// ───────────────────────────────────────── modelo ─────────────────────────────────────────

test('w:num="2" w:space: dos columnas iguales; el hueco por defecto es de 720 twips (36 pt)', () => {
  const m = construirModeloDocx(doc(par('a'), sect(DOS)), null, null, null);
  expect(m.secciones![0]!.columnas).toEqual({ anchosPt: [120, 120], espaciosPt: [20], separador: false });
  const porDefecto = construirModeloDocx(`<w:document><w:body>${par('a')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/><w:cols w:num="3"/></w:sectPr></w:body></w:document>`, null, null, null);
  const c = porDefecto.secciones![0]!.columnas!;
  expect(c.espaciosPt).toEqual([36, 36]);
  expect(c.anchosPt.map((a) => Math.round(a * 100) / 100)).toEqual([132, 132, 132]); // (468 - 72) / 3
});

test('anchos desiguales (equalWidth="0" + w:col) y separador (w:sep); cada w:col trae el hueco que le SIGUE', () => {
  const cols = '<w:cols w:num="3" w:sep="1" w:equalWidth="0"><w:col w:w="1100" w:space="200"/><w:col w:w="2200" w:space="400"/><w:col w:w="1100"/></w:cols>';
  const c = construirModeloDocx(doc(par('a'), sect(cols)), null, null, null).secciones![0]!.columnas!;
  expect(c.anchosPt).toEqual([55, 110, 55]);
  expect(c.espaciosPt).toEqual([10, 20]);
  expect(c.separador).toBe(true);
});

test('con equalWidth="1" los w:col se ignoran; una columna, w:num ausente o anchos que no caben (se escalan) se resuelven sin romper', () => {
  const igual = '<w:cols w:num="2" w:space="400" w:equalWidth="1"><w:col w:w="400" w:space="400"/><w:col w:w="400"/></w:cols>';
  expect(construirModeloDocx(doc(par('a'), sect(igual)), null, null, null).secciones![0]!.columnas!.anchosPt).toEqual([120, 120]);
  expect(construirModeloDocx(doc(par('a'), sect('<w:cols w:num="1"/>')), null, null, null).secciones![0]!.columnas).toBeUndefined();
  expect(construirModeloDocx(doc(par('a'), sect()), null, null, null).secciones![0]!.columnas).toBeUndefined();
  // 2 x 200 pt + 20 pt de hueco = 420 > 260 de área útil: se escalan a 120 pt cada una.
  const ancho = '<w:cols w:num="2" w:equalWidth="0"><w:col w:w="4000" w:space="400"/><w:col w:w="4000"/></w:cols>';
  const c = construirModeloDocx(doc(par('a'), sect(ancho)), null, null, null).secciones![0]!.columnas!;
  expect(c.anchosPt[0]!).toBeCloseTo(120, 6);
  expect(c.anchosPt[1]!).toBeCloseTo(120, 6);
});

test('las columnas ya no se avisan como omitidas, ni un salto de columna en el cuerpo; dentro de una celda sí (salto de línea)', () => {
  const m = construirModeloDocx(doc(par('a') + '<w:p><w:r><w:br w:type="column"/></w:r></w:p>', sect(DOS)), null, null, null);
  expect(textosAdvertencias(m.advertencias).join('|')).not.toMatch(/columna/i);
  const p = m.bloques.filter(esParrafo)[1]!;
  expect(p.partes.some((x) => x.tipo === 'saltoColumna')).toBe(true);
  const celda = construirModeloDocx(`<w:document><w:body><w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>a</w:t><w:br w:type="column"/><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`, null, null, null);
  expect(textosAdvertencias(celda.advertencias).join('|')).toMatch(/salto de columna dentro de una celda/i);
});

// ───────────────────────────────────────── render ─────────────────────────────────────────

test('dos columnas: 13 líneas por columna de arriba abajo, luego la 2.ª (x = 160) y luego la página siguiente; sin avisos', () => {
  const r = render(doc(lineas(30), sect(DOS)));
  expect(r.totalPaginas).toBe(2);
  const top = 180 - 12 + 0.28 * 12; // base de la 1.ª línea: borde superior (180) - 12 + 0,28 x 12
  expect([t(r, 'L1').page, t(r, 'L1').xPt, t(r, 'L1').yPt]).toEqual([0, 20, top]);
  expect([t(r, 'L13').page, t(r, 'L13').xPt]).toEqual([0, 20]);
  expect([t(r, 'L14').page, t(r, 'L14').xPt, t(r, 'L14').yPt]).toEqual([0, 160, top]);
  expect([t(r, 'L26').page, t(r, 'L26').xPt]).toEqual([0, 160]);
  expect([t(r, 'L27').page, t(r, 'L27').xPt, t(r, 'L27').yPt]).toEqual([1, 20, top]);
  expect(textosAdvertencias(r.advertencias)).toEqual([]);
});

test('columnas desiguales: cada párrafo se ajusta al ancho de la columna donde cae (60 pt: 2 palabras por línea; 160 pt: 6)', () => {
  const cols = '<w:cols w:num="2" w:equalWidth="0"><w:col w:w="1200" w:space="400"/><w:col w:w="3200"/></w:cols>'; // 60 + 20 + 160; la 2.ª empieza en x = 100
  const palabras = Array.from({ length: 40 }, (_, i) => `a${String(i + 1).padStart(3, '0')}`).join(' '); // palabras de 4 letras = 20 pt
  const r = render(doc(par(palabras), sect(cols)));
  expect(r.totalPaginas).toBe(1);
  const col1 = r.trazos.filter((x) => x.xPt === 20), col2 = r.trazos.filter((x) => x.xPt === 100);
  expect(col1).toHaveLength(13);
  expect(col1.every((x) => x.text.split(' ').length === 2)).toBe(true);
  expect(col2.map((x) => x.text.split(' ').length)).toEqual([6, 6, 2]);
  // Orden de lectura: la columna 2 sigue donde acabó la 1.
  expect(col2[0]!.text.startsWith('a027')).toBe(true);
});

test('w:br w:type="column": lo que sigue va arriba de la columna siguiente; en la última, a la página siguiente', () => {
  const salto = '<w:p><w:r><w:br w:type="column"/></w:r></w:p>';
  const r = render(doc(par('A1') + par('A2') + salto + par('B1') + salto + par('C1'), sect(DOS)));
  const top = 180 - 12 + 0.28 * 12;
  expect([t(r, 'A2').xPt, t(r, 'A2').page]).toEqual([20, 0]);
  expect([t(r, 'B1').xPt, t(r, 'B1').yPt, t(r, 'B1').page]).toEqual([160, top, 0]);
  expect([t(r, 'C1').xPt, t(r, 'C1').yPt, t(r, 'C1').page]).toEqual([20, top, 1]);
  expect(r.totalPaginas).toBe(2);
});

test('sección continua 1 -> 2 -> 1 columnas: la de 2 se equilibra (5 + 4) y la última empieza bajo la columna más alta', () => {
  // Sección 1 = A1 (una columna, su sectPr va en el párrafo); sección 2 = B1..B9 (continua, 2 columnas, cerrada por el sectPr de B9); sección 3 = C1, C2 (continua).
  const parSect = (texto: string, sectXml: string) => par(texto, sectXml);
  const xml = doc(parSect('A1', sect()) + lineas(8, 'B') + parSect('B9', sect(DOS, '<w:type w:val="continuous"/>')) + par('C1') + par('C2'), sect('', '<w:type w:val="continuous"/>'));
  const r = render(xml);
  expect(r.totalPaginas).toBe(1);
  const b = r.trazos.filter((x) => x.text.startsWith('B'));
  expect(b.filter((x) => x.xPt === 20).map((x) => x.text)).toEqual(['B1', 'B2', 'B3', 'B4', 'B5']);
  expect(b.filter((x) => x.xPt === 160).map((x) => x.text)).toEqual(['B6', 'B7', 'B8', 'B9']);
  const base = (n: number) => 180 - 12 * n + 0.28 * 12; // base de la línea n-ésima contada desde el borde superior del área
  expect(t(r, 'A1').yPt).toBeCloseTo(base(1), 6);
  expect(t(r, 'B1').yPt).toBeCloseTo(base(2), 6); // la región de columnas arranca bajo A1
  expect(t(r, 'B6').yPt).toBeCloseTo(base(2), 6); // y la 2.ª columna arriba, a la misma altura
  expect(t(r, 'C1').yPt).toBeCloseTo(base(2 + 5), 6); // C1 bajo la columna más alta (5 líneas)
  expect(t(r, 'C1').xPt).toBe(20);
  expect(textosAdvertencias(r.advertencias)).toEqual([]);
});

test('una tabla dentro de la columna 2 usa su x y una imagen en línea se ajusta al ancho de la columna', () => {
  const tabla = `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:pPr>${ESP}</w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>celda</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
  const rels = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/></Relationships>';
  const dibujo = `<w:p><w:pPr>${ESP}</w:pPr><w:r><w:drawing><wp:inline><wp:extent cx="${300 * 12700}" cy="${30 * 12700}"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  // 13 líneas llenan la columna 1: la tabla (sola, tras ellas) cae en la columna 2; la imagen, tras otra tabla, en la 3.ª zona (página siguiente).
  const r = renderizarModeloDocx(construirModeloDocx(doc(lineas(13) + tabla + lineas(11, 'M') + dibujo, sect(DOS)), null, null, rels), medir);
  expect(t(r, 'celda').xPt).toBe(160 + 5); // x de la columna 2 + relleno de celda
  const im = r.imagenes[0]!;
  expect(im.wPt).toBeCloseTo(120, 6); // 300 pt escalados al ancho de la columna (120)
  expect(im.hPt).toBeCloseTo(12, 6);
  expect(im.xPt === 20 || im.xPt === 160).toBe(true);
});

test('una tabla en columnas de ancho DISTINTO avisa (se maqueta al ancho de la más estrecha); en columnas iguales no', () => {
  const tabla = `<w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
  const desiguales = '<w:cols w:num="2" w:equalWidth="0"><w:col w:w="1200" w:space="400"/><w:col w:w="3200"/></w:cols>';
  expect(textosAdvertencias(render(doc(tabla, sect(desiguales))).advertencias).join('|')).toMatch(/columna más estrecha/i);
  expect(textosAdvertencias(render(doc(tabla, sect(DOS))).advertencias)).toEqual([]);
});

test('las notas al pie van al pie de la PÁGINA con el ancho de la primera columna, aunque la referencia esté en la columna 2', () => {
  const ref = '<w:r><w:footnoteReference w:id="1"/></w:r>';
  const nota = '<w:footnotes><w:footnote w:id="1"><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>uno dos tres cuatro cinco seis siete</w:t></w:r></w:p></w:footnote></w:footnotes>';
  const cuerpo = lineas(13) + `<w:p><w:pPr>${ESP}</w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>REF</w:t></w:r>${ref}</w:p>`;
  const m = construirModeloDocx(doc(cuerpo, sect(DOS)), null, null, null, { partes: { 'word/footnotes.xml': nota } });
  const r = renderizarModeloDocx(m, medir);
  expect(t(r, 'REF').xPt).toBe(160); // la referencia en la columna 2 (la columna 1 está llena)
  const trozos = r.trazos.filter((x) => /uno|siete/.test(x.text) && x.yPt < 60);
  expect(trozos.length).toBeGreaterThanOrEqual(2); // 7 palabras de ~20 pt no caben en 120 pt: varias líneas
  expect(Math.min(...trozos.map((x) => x.xPt))).toBe(20); // a la izquierda del margen, no en la columna 2
  expect(Math.max(...trozos.map((x) => x.xPt + x.text.length * 5))).toBeLessThanOrEqual(20 + 120 + 0.5);
});
