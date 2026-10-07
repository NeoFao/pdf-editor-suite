import { test, expect } from 'vitest';
import { construirModeloDocx, esTabla } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';
import { textosAdvertencias } from '../../src/convert/advertencia';

/**
 * E-103: formato de párrafo DENTRO de una celda (alineación, sangría derecha, espaciado e interlineado por párrafo), con el
 * mismo `pPrEfectivo` que el cuerpo. Medida falsa: cada carácter ocupa `0,5 × tamaño` pt. Unidades: pt de página (origen
 * arriba-izquierda para x; `yPt` de los trazos es la línea base con origen ABAJO-izquierda).
 */
const medir = (_f: string, sz: number, s: string): number => s.length * sz * 0.5;
const RPR = '<w:rPr><w:sz w:val="20"/></w:rPr>'; // 10 pt: cada carácter = 5 pt
const p = (t: string, ppr = '') => `<w:p><w:pPr>${ppr}</w:pPr><w:r>${RPR}<w:t>${t}</w:t></w:r></w:p>`;
const SIN_ESP = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>'; // 12 pt exactos
const BORDES = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right'].map((l) => `<w:${l} w:val="single" w:sz="8" w:color="000000"/>`).join('') + '</w:tblBorders>';
/** Una fila con celdas de 150 pt (3000 twips): x de celda 72, 222...; interior desde x + 5 hasta x + 145 (140 pt). */
const tabla = (...celdas: string[]) => `<w:document><w:body><w:tbl><w:tblPr>${BORDES}</w:tblPr><w:tblGrid>${celdas.map(() => '<w:gridCol w:w="3000"/>').join('')}</w:tblGrid><w:tr>${celdas.map((c) => `<w:tc>${c}</w:tc>`).join('')}</w:tr></w:tbl></w:body></w:document>`;
const render = (xml: string, estilos: string | null = null) => renderizarModeloDocx(construirModeloDocx(xml, estilos, null), medir);
const trazoDe = (r: ReturnType<typeof render>, texto: string) => r.trazos.find((t) => t.text === texto || t.text.startsWith(texto))!;
const alturaFila = (r: ReturnType<typeof render>): number => Math.max(...r.barras.map((b) => b.yPt + b.hPt)) - Math.min(...r.barras.map((b) => b.yPt));

test('el modelo guarda alineación, sangría derecha, espaciado e interlineado POR PÁRRAFO de la celda (también heredados del estilo)', () => {
  const estilos = '<w:styles><w:style w:type="paragraph" w:styleId="Centrado"><w:pPr><w:jc w:val="center"/></w:pPr></w:style></w:styles>';
  const xml = tabla(
    p('uno', '<w:pStyle w:val="Centrado"/>') + p('dos', '<w:ind w:right="720"/><w:jc w:val="right"/><w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/>'),
  );
  const t = construirModeloDocx(xml, estilos, null).bloques.find(esTabla)!;
  const inicios = t.filas[0]!.celdas[0]!.partes.filter((x) => x.tipo === 'inicioParrafo');
  expect(inicios).toHaveLength(2);
  expect(inicios[0]).toMatchObject({ alineacion: 'center' });
  expect(inicios[1]).toMatchObject({ alineacion: 'right', sangriaDerPt: 36, espacioAntesPt: 12, espacioDespuesPt: 6, interlineadoFactor: 1.5, interlineadoExactoPt: null });
});

test('una línea centrada cae centrada en el ancho INTERIOR de la celda y una a la derecha pegada a su borde interior', () => {
  const r = render(tabla(p('abcd', `${SIN_ESP}<w:jc w:val="center"/>`), p('abcd', `${SIN_ESP}<w:jc w:val="right"/>`)));
  const [centro, derecha] = r.trazos.filter((t) => t.text === 'abcd');
  // Celda 1: interior 77..217 (140 pt); "abcd" mide 20 pt. Celda 2: interior 227..367.
  expect(centro!.xPt).toBeCloseTo(72 + 5 + (140 - 20) / 2, 3);
  expect(derecha!.xPt).toBeCloseTo(222 + 5 + 140 - 20, 3);
});

test('una celda con DOS párrafos de alineación distinta: cada uno la suya (no la del primero para todos)', () => {
  const r = render(tabla(p('abcd', `${SIN_ESP}<w:jc w:val="left"/>`) + p('efgh', `${SIN_ESP}<w:jc w:val="right"/>`)));
  expect(trazoDe(r, 'abcd').xPt).toBeCloseTo(77, 3);
  expect(trazoDe(r, 'efgh').xPt).toBeCloseTo(77 + 140 - 20, 3);
});

test('la sangría derecha acorta la línea: el justificado termina 36 pt antes del borde interior y la ÚLTIMA línea no se estira', () => {
  // Interior útil = 140 - 36 = 104 pt = 20 caracteres. "aaaa bbbb cccc dddd" cabe (19); " eeee" no => línea 2 = "eeee ffff" (última).
  const r = render(tabla(p('aaaa bbbb cccc dddd eeee ffff', `${SIN_ESP}<w:ind w:right="720"/><w:jc w:val="both"/>`)));
  const l1 = r.trazos.filter((t) => ['aaaa', 'bbbb', 'cccc', 'dddd'].includes(t.text));
  expect(l1).toHaveLength(4);
  const ultima = l1[3]!;
  expect(ultima.xPt + ultima.text.length * 5).toBeCloseTo(77 + 140 - 36, 3); // borde derecho del texto = interior derecho - sangría
  expect(l1[0]!.xPt).toBeCloseTo(77, 3);
  const l2 = r.trazos.filter((t) => t.text === 'eeee ffff' || t.text === 'eeee' || t.text === 'ffff');
  expect(l2[0]!.xPt).toBeCloseTo(77, 3);
  // Sin estirar: "eeee" y "ffff" quedan a un solo espacio natural (5 pt) uno del otro.
  const fin = l2[l2.length - 1]!;
  expect(l2.length === 1 ? l2[0]!.text.length * 5 : fin.xPt + 20 - l2[0]!.xPt).toBeCloseTo(45, 3);
});

test('el espaciado antes/después y el interlineado del párrafo mueven las líneas y hacen crecer la fila', () => {
  const sp = '<w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/>'; // 12 antes, 6 después, 1,5 => 15 pt por línea
  const r = render(tabla(p('aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk', sp)));
  // 140 pt = 28 caracteres por línea: "aaaa bbbb cccc dddd eeee ffff" (29) no cabe => 5 palabras; son 11 palabras => 3 líneas.
  const ys = r.trazos.filter((t) => t.text.length >= 4).map((t) => t.yPt);
  const lineas = [...new Set(ys.map((y) => y.toFixed(3)))].map(Number).sort((a, b) => b - a);
  expect(lineas).toHaveLength(3);
  expect(lineas[0]! - lineas[1]!).toBeCloseTo(15, 3);
  expect(lineas[1]! - lineas[2]!).toBeCloseTo(15, 3);
  // Fila = relleno 5 + 12 antes + 3 × 15 + 6 después + relleno 5.
  expect(alturaFila(r)).toBeCloseTo(5 + 12 + 45 + 6 + 5, 3);
});

test('entre dos párrafos de la celda: después del primero + antes del segundo (se suman, como en Word dentro de una celda)', () => {
  const r = render(tabla(p('aaaa', '<w:spacing w:before="0" w:after="120" w:line="240" w:lineRule="exact"/>') + p('bbbb', '<w:spacing w:before="240" w:after="0" w:line="240" w:lineRule="exact"/>')));
  expect(trazoDe(r, 'aaaa').yPt - trazoDe(r, 'bbbb').yPt).toBeCloseTo(12 + 6 + 12, 3);
  expect(alturaFila(r)).toBeCloseTo(5 + 12 + 6 + 12 + 12 + 5, 3);
});

test('sin avisos: el formato de párrafo en celdas ya no se degrada', () => {
  const m = construirModeloDocx(tabla(p('abcd', `${SIN_ESP}<w:ind w:right="720"/><w:jc w:val="both"/>`)), null, null);
  expect(textosAdvertencias(m.advertencias)).toEqual([]);
});

test('el estilo de la tabla ("Table Grid": sin espacio después, interlineado sencillo) manda sobre los valores por defecto del documento en sus celdas', () => {
  const estilos = `<w:styles><w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="table" w:styleId="Rejilla"><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style></w:styles>`;
  const celda = '<w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>abcd</w:t></w:r></w:p>';
  const con = (estilo: string) => `<w:document><w:body><w:tbl><w:tblPr>${estilo}${BORDES}</w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc>${celda}</w:tc></w:tr></w:tbl></w:body></w:document>`;
  // Con el estilo de tabla: línea de 10 pt (factor 1,0) y nada después => fila = 5 + 10 + 5.
  expect(alturaFila(render(con('<w:tblStyle w:val="Rejilla"/>'), estilos))).toBeCloseTo(20, 3);
  // Sin él, valen los de docDefaults: línea de 10 × 259/240 y 8 pt después => fila = 5 + 10,7916 + 8 + 5.
  expect(alturaFila(render(con(''), estilos))).toBeCloseTo(5 + 10 * 259 / 240 + 8 + 5, 3);
});
