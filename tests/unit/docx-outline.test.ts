import { test, expect } from 'vitest';
import { construirModeloDocx } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';
import { outlineDeTitulos } from '../../src/convert/docx/outline';

/**
 * Árbol de marcadores del PDF desde los títulos de Word (E-114): título = `w:outlineLvl` EFECTIVO 0-8 (por estilo con `basedOn` o
 * directo; nunca por el nombre del estilo, que está localizado). `medir` falso exacto (5 pt por carácter). Página de 612x200 pt con
 * 40 pt de margen arriba y abajo: 10 líneas exactas de 12 pt; la primera línea de cada página tiene su borde superior en y = 160.
 */
const medir = (_f: string, _s: number, t: string): number => t.length * 5;
const MAR = '<w:pgSz w:w="12240" w:h="4000"/><w:pgMar w:top="800" w:right="1440" w:bottom="800" w:left="1440" w:header="200" w:footer="200"/>';
const LINEA = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>';
const run = (t: string) => `<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${t}</w:t></w:r>`;
const p = (t: string, ppr = '') => `<w:p><w:pPr>${ppr}${LINEA}</w:pPr>${run(t)}</w:p>`;
const h = (nivel: number, t: string) => p(t, `<w:outlineLvl w:val="${nivel}"/>`);
const relleno = (n: number, pref: string) => Array.from({ length: n }, (_v, i) => p(`${pref}${i + 1}`)).join('');

// Estilos con nombre localizado: ninguno se llama «Heading». `Titulo2` hereda el outlineLvl de `BaseTitulo` (cadena basedOn).
const ESTILOS = '<w:styles>'
  + '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="Título 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="BaseTitulo"><w:name w:val="Base"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Titulo2"><w:name w:val="Título 2"/><w:basedOn w:val="BaseTitulo"/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading3Falso"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/></w:style>' // se llama «heading» pero NO tiene outlineLvl
  + '</w:styles>';
const conEstilo = (id: string, t: string) => p(t, `<w:pStyle w:val="${id}"/>`);

function convertir(cuerpo: string, estilos: string | null = ESTILOS, extras = {}, numbering: string | null = null) {
  const doc = `<w:document><w:body>${cuerpo}<w:sectPr>${MAR}</w:sectPr></w:body></w:document>`;
  const modelo = construirModeloDocx(doc, estilos, numbering, null, extras);
  const res = renderizarModeloDocx(modelo, medir);
  return { modelo, res, outline: outlineDeTitulos(modelo, res.marcadores) };
}
const titulos = (o: ReturnType<typeof outlineDeTitulos>): string[] => o.flatMap((i) => [i.title, ...titulos(i.children)]);

test('outlineLvl por estilo (con basedOn) y directo; el nombre del estilo no cuenta', () => {
  const { outline } = convertir([
    conEstilo('Ttulo1', 'Uno'), conEstilo('Titulo2', 'Dos heredado'), h(2, 'Tres directo'),
    conEstilo('Heading3Falso', 'No es titulo'), p('Cuerpo'), h(9, 'Nivel 9 es cuerpo')
  ].join(''));
  expect(outline).toHaveLength(1);
  expect(outline[0]!.title).toBe('Uno');
  expect(outline[0]!.children.map((c) => c.title)).toEqual(['Dos heredado']);
  expect(outline[0]!.children[0]!.children.map((c) => c.title)).toEqual(['Tres directo']);
  expect(titulos(outline)).not.toContain('No es titulo');
  expect(titulos(outline)).not.toContain('Nivel 9 es cuerpo');
});

test('la jerarquia sigue el nivel y un salto de nivel cuelga del ultimo de nivel inferior', () => {
  const { outline } = convertir([h(0, 'A'), h(2, 'A.x'), h(1, 'A.1'), h(0, 'B'), h(1, 'B.1'), h(1, 'B.2')].join(''));
  expect(outline.map((i) => i.title)).toEqual(['A', 'B']);
  expect(outline[0]!.children.map((i) => i.title)).toEqual(['A.x', 'A.1']);
  expect(outline[1]!.children.map((i) => i.title)).toEqual(['B.1', 'B.2']);
});

test('un titulo de nivel mayor sin antecesor es raiz', () => {
  const { outline } = convertir([h(1, 'Suelto'), h(0, 'Primero')].join(''));
  expect(outline.map((i) => i.title)).toEqual(['Suelto', 'Primero']);
});

test('documento sin titulos: outline vacio', () => {
  expect(convertir(relleno(3, 'L')).outline).toEqual([]);
});

test('destino: pagina y altura (borde superior de la linea) de NUESTRA paginacion', () => {
  const { outline, res } = convertir([h(0, 'H1'), relleno(9, 'a'), h(1, 'H2'), relleno(2, 'b')].join(''));
  expect(res.totalPaginas).toBe(2);
  expect(outline[0]).toMatchObject({ title: 'H1', pageIndex: 0 });
  expect(outline[0]!.yPt).toBeCloseTo(160, 1);
  expect(outline[0]!.children[0]).toMatchObject({ title: 'H2', pageIndex: 1 });
  expect(outline[0]!.children[0]!.yPt).toBeCloseTo(160, 1);
});

test('el texto es el del parrafo: sin resultado de campos, referencias de nota ni espacios sobrantes', () => {
  const campo = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>77</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const simple = '<w:fldSimple w:instr="DATE"><w:r><w:t>HOY</w:t></w:r></w:fldSimple>';
  const cuerpo = `<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr>${run('Capitulo  ')}${campo}${run(' uno')}${simple}</w:p>`;
  expect(convertir(cuerpo).outline.map((i) => i.title)).toEqual(['Capitulo uno']);
});

test('el numero de la lista visible entra en el texto; una vineta no', () => {
  const numbering = '<w:numbering>'
    + '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>'
    + '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="-"/></w:lvl></w:abstractNum>'
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>';
  const lista = (id: number, t: string) => p(t, `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr><w:outlineLvl w:val="0"/>`);
  const { outline } = convertir([lista(1, 'Intro'), lista(1, 'Metodo'), lista(2, 'Viñeta')].join(''), null, {}, numbering);
  expect(outline.map((i) => i.title)).toEqual(['1. Intro', '2. Metodo', 'Viñeta']);
});

test('un titulo sin texto no genera marcador', () => {
  expect(convertir(`<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:p>${h(0, 'Real')}`).outline.map((i) => i.title)).toEqual(['Real']);
});

test('encabezados, pies, notas y celdas no generan marcadores', () => {
  const cab = '<w:hdr><w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>EN CABECERA</w:t></w:r></w:p></w:hdr>';
  const pie = '<w:ftr><w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>EN PIE</w:t></w:r></w:p></w:ftr>';
  const notas = '<w:footnotes><w:footnote w:id="1"><w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>EN NOTA</w:t></w:r></w:p></w:footnote></w:footnotes>';
  const celda = '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>EN CELDA</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const ref = '<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>';
  const cuerpo = `${h(0, 'Solo este')}${celda}${ref}`;
  const sect = `<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/>${MAR}</w:sectPr>`;
  const doc = `<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${cuerpo}${sect}</w:body></w:document>`;
  const rels = '<Relationships><Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>';
  const modelo = construirModeloDocx(doc, null, null, rels, { partes: { 'word/header1.xml': cab, 'word/footer1.xml': pie, 'word/footnotes.xml': notas } });
  const res = renderizarModeloDocx(modelo, medir);
  expect(titulos(outlineDeTitulos(modelo, res.marcadores))).toEqual(['Solo este']);
});
