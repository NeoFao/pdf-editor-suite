import { test, expect } from 'vitest';
import { construirModeloDocx, esParrafo, esTabla, type ParteParrafo, type RunFormato } from '../../src/convert/docx/modelo';
import { textosAdvertencias } from '../../src/convert/advertencia';

/**
 * E-104: formato de carácter EFECTIVO (`rPrEfectivo`), el mismo en cuerpo y en celdas, en el orden de OOXML 17.7.2:
 * docDefaults < estilo de tabla < estilo de párrafo (basedOn) < estilo de carácter (basedOn) < rPr directo; b/i conmutan (17.7.3).
 * Se mide el `RunFormato` del primer texto (fuente = negrita/cursiva, tamaño en pt, color, subrayado).
 */
const SECT = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
const run = (t: string, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t>${t}</w:t></w:r>`;
const par = (runs: string, ppr = '') => `<w:p><w:pPr>${ppr}</w:pPr>${runs}</w:p>`;
const celda = (...ps: string[]) => `<w:tbl><w:tblPr><w:tblStyle w:val="Tabla"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc>${ps.join('')}</w:tc></w:tr></w:tbl>`;
const doc = (...bloques: string[]) => `<w:document><w:body>${bloques.join('')}${SECT}</w:body></w:document>`;

function textos(partes: ParteParrafo[]): RunFormato[] {
  return partes.flatMap((p) => (p.tipo === 'texto' ? [p.formato] : []));
}
let ESTILOS = '';
/** Formato del primer texto del cuerpo (párrafo suelto) y del de la celda: los dos caminos deben dar lo mismo. */
function enCuerpo(xml: string): RunFormato { return textos(construirModeloDocx(xml, ESTILOS, null).bloques.filter(esParrafo).flatMap((p) => p.partes))[0]!; }
function enCelda(xml: string): RunFormato {
  const t = construirModeloDocx(xml, ESTILOS, null).bloques.find(esTabla)!;
  return textos(t.filas[0]!.celdas[0]!.partes)[0]!;
}

const estilos = (extra = '', dd = '') => `<w:styles>${dd}${extra}</w:styles>`;
const NEGRO = '<w:style w:type="paragraph" w:styleId="Base"><w:rPr><w:sz w:val="24"/><w:color w:val="112233"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Negro"><w:basedOn w:val="Base"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>';

test('estilo de párrafo con negrita y 20 pt (basedOn de dos niveles): en la celda igual que en el cuerpo', () => {
  ESTILOS = estilos(NEGRO);
  const p = par(run('x'), '<w:pStyle w:val="Negro"/>');
  for (const f of [enCuerpo(doc(p)), enCelda(doc(celda(p)))]) {
    expect(f.font).toBe('Helvetica-Bold');
    expect(f.sizePt).toBe(20);
    expect(f.color).toEqual([0x11, 0x22, 0x33]); // heredado del nivel más bajo (Base)
  }
});

test('un nivel de basedOn lejano aporta lo que el cercano no dice (color de Base) y el cercano gana donde habla (tamaño)', () => {
  ESTILOS = estilos(NEGRO);
  const f = enCelda(doc(celda(par(run('x'), '<w:pStyle w:val="Base"/>'))));
  expect(f).toMatchObject({ font: 'Helvetica', sizePt: 12, color: [0x11, 0x22, 0x33] });
});

test('cadena completa: docDefaults < tabla < párrafo < carácter < directo, cada capa gana a la anterior (cuerpo y celda)', () => {
  const dd = '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="18"/><w:color w:val="010101"/><w:rFonts w:ascii="Courier New"/></w:rPr></w:rPrDefault></w:docDefaults>';
  const tabla = '<w:style w:type="table" w:styleId="Tabla"><w:rPr><w:sz w:val="20"/><w:color w:val="020202"/></w:rPr></w:style>';
  const parr = '<w:style w:type="paragraph" w:styleId="P"><w:rPr><w:sz w:val="22"/><w:color w:val="030303"/></w:rPr></w:style>';
  const car = '<w:style w:type="character" w:styleId="C"><w:rPr><w:sz w:val="26"/></w:rPr></w:style>';
  ESTILOS = estilos(tabla + parr + car, dd);
  const base = (ppr: string, rpr: string): string => par(run('x', rpr), ppr);
  // Solo docDefaults.
  expect(enCuerpo(doc(base('', '')))).toMatchObject({ sizePt: 9, color: [1, 1, 1], font: 'Courier' });
  // Celda sin estilo de párrafo: gana el estilo de tabla sobre docDefaults.
  expect(enCelda(doc(celda(base('', ''))))).toMatchObject({ sizePt: 10, color: [2, 2, 2], font: 'Courier' });
  // Estilo de párrafo gana a tabla; el cuerpo igual.
  const pp = '<w:pStyle w:val="P"/>';
  expect(enCelda(doc(celda(base(pp, ''))))).toMatchObject({ sizePt: 11, color: [3, 3, 3] });
  expect(enCuerpo(doc(base(pp, '')))).toMatchObject({ sizePt: 11, color: [3, 3, 3] });
  // Estilo de carácter gana a párrafo (solo en lo que dice: tamaño; el color sigue siendo el del párrafo).
  const rs = '<w:rStyle w:val="C"/>';
  expect(enCelda(doc(celda(base(pp, rs))))).toMatchObject({ sizePt: 13, color: [3, 3, 3] });
  expect(enCuerpo(doc(base(pp, rs)))).toMatchObject({ sizePt: 13, color: [3, 3, 3] });
  // Directo gana a todo.
  const dir = '<w:sz w:val="30"/><w:color w:val="0A0B0C"/>';
  expect(enCelda(doc(celda(base(pp, rs + dir))))).toMatchObject({ sizePt: 15, color: [10, 11, 12] });
  expect(enCuerpo(doc(base(pp, rs + dir)))).toMatchObject({ sizePt: 15, color: [10, 11, 12] });
});

test('estilo de carácter con basedOn de dos niveles', () => {
  ESTILOS = estilos(
    '<w:style w:type="character" w:styleId="C0"><w:rPr><w:i/><w:color w:val="AA0000"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="C1"><w:basedOn w:val="C0"/><w:rPr><w:sz w:val="36"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="C2"><w:basedOn w:val="C1"/><w:rPr><w:u w:val="single"/></w:rPr></w:style>');
  const p = par(run('x', '<w:rStyle w:val="C2"/>'));
  for (const f of [enCuerpo(doc(p)), enCelda(doc(celda(p)))]) {
    expect(f).toMatchObject({ font: 'Helvetica-Oblique', sizePt: 18, color: [0xaa, 0, 0], underline: true });
  }
});

test('toggle de negrita (17.7.3): estilo + estilo de carácter se anulan; el directo manda; tabla + párrafo también conmutan', () => {
  ESTILOS = estilos(
    '<w:style w:type="paragraph" w:styleId="N"><w:rPr><w:b/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="CN"><w:rPr><w:b/></w:rPr></w:style>' +
    '<w:style w:type="table" w:styleId="Tabla"><w:rPr><w:b/></w:rPr></w:style>');
  const n = '<w:pStyle w:val="N"/>';
  const cn = '<w:rStyle w:val="CN"/>';
  const caso = (ppr: string, rpr: string): string => par(run('x', rpr), ppr);
  // Cuerpo (sin estilo de tabla): párrafo b => negrita; + rStyle b => se anulan; + directo b => negrita; directo b=0 => normal.
  expect(enCuerpo(doc(caso(n, ''))).font).toBe('Helvetica-Bold');
  expect(enCuerpo(doc(caso(n, cn))).font).toBe('Helvetica');
  expect(enCuerpo(doc(caso(n, cn + '<w:b/>'))).font).toBe('Helvetica-Bold');
  expect(enCuerpo(doc(caso(n, '<w:b w:val="0"/>'))).font).toBe('Helvetica');
  expect(enCuerpo(doc(caso('', cn))).font).toBe('Helvetica-Bold');
  // Celda: el estilo de tabla (b) conmuta con el de párrafo (b): se anulan; con el de carácter también, vuelve a ser negrita.
  expect(enCelda(doc(celda(caso('', '')))).font).toBe('Helvetica-Bold'); // solo tabla
  expect(enCelda(doc(celda(caso(n, '')))).font).toBe('Helvetica');
  expect(enCelda(doc(celda(caso(n, cn)))).font).toBe('Helvetica-Bold');
  expect(enCelda(doc(celda(caso(n, '<w:b w:val="0"/>')))).font).toBe('Helvetica');
});

test('un estilo de tabla con formato condicional (tblStylePr con rPr) avisa de que no se aplica; sin condicional no avisa', () => {
  ESTILOS = estilos('<w:style w:type="table" w:styleId="Tabla"><w:rPr><w:sz w:val="20"/></w:rPr><w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr></w:tblStylePr></w:style>');
  const con = construirModeloDocx(doc(celda(par(run('x')))), ESTILOS, null);
  expect(textosAdvertencias(con.advertencias).join('|')).toMatch(/condicional/);
  ESTILOS = estilos('<w:style w:type="table" w:styleId="Tabla"><w:rPr><w:sz w:val="20"/></w:rPr></w:style>');
  const sin = construirModeloDocx(doc(celda(par(run('x')))), ESTILOS, null);
  expect(textosAdvertencias(sin.advertencias)).toEqual([]);
});
