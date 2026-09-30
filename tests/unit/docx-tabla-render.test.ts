import { test, expect } from 'vitest';
import { construirModeloDocx } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';

/** medir falso exacto (5pt por carácter): dimensiones predecibles. */
const medir = (_f: string, _s: number, t: string): number => t.length * 5;

const BORDES = '<w:tblBorders><w:top w:val="single" w:sz="8" w:color="000000"/></w:tblBorders>'; // 1pt
const SECT_A4 = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
/** Página de 150pt de alto con 20pt de margen: 110pt útiles. */
const SECT_BAJA = '<w:sectPr><w:pgSz w:w="12240" w:h="3000"/><w:pgMar w:top="400" w:right="1440" w:bottom="400" w:left="1440"/></w:sectPr>';

function celda(texto: string, tcPr = ''): string {
  return `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}<w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${texto}</w:t></w:r></w:p></w:tc>`;
}
function tabla(grid: number[], filas: string[], sect = SECT_A4): string {
  return `<w:document><w:body><w:tbl><w:tblPr>${BORDES}</w:tblPr><w:tblGrid>${grid.map((g) => `<w:gridCol w:w="${g}"/>`).join('')}</w:tblGrid>${filas.map((f) => `<w:tr>${f}</w:tr>`).join('')}</w:tbl>${sect}</w:body></w:document>`;
}
function render(xml: string) {
  const modelo = construirModeloDocx(xml, null, null);
  return { modelo, res: renderizarModeloDocx(modelo, medir) };
}

test('vMerge: la celda combinada es UNA celda: texto una vez, sombreado en todas las filas y sin borde interno', () => {
  const { res } = render(tabla([2000, 2000], [
    celda('FUSION', '<w:vMerge w:val="restart"/><w:shd w:fill="FFCC00"/>') + celda('a1'),
    celda('', '<w:vMerge/>') + celda('a2'),
    celda('', '<w:vMerge/>') + celda('a3')
  ]));
  expect(res.trazos.filter((t) => t.text === 'FUSION')).toHaveLength(1);
  const x0 = 72; // margen izquierdo, 1440 twips
  const amarillas = res.barras.filter((b) => b.color[0] === 255 && b.color[1] === 204 && b.xPt === x0);
  expect(amarillas).toHaveLength(3); // una franja por fila combinada
  // Bordes horizontales de 1pt que cubren toda la columna 1: solo el de arriba y el final de la tabla (no 2 internos).
  const horizontales = res.barras.filter((b) => b.hPt === 1 && b.xPt === x0 && Math.abs(b.wPt - 100) < 1);
  expect(horizontales).toHaveLength(1); // el inferior de la tabla abarca todo el ancho (200pt), el superior es el único de 100pt
  expect(res.advertencias).toEqual([]);
});

test('vMerge cuyo texto es más alto que las filas combinadas: la última fila crece, no se corta', () => {
  const alta = ['l1', 'l2', 'l3', 'l4'].map((t) => `<w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${t}</w:t></w:r></w:p>`).join('');
  const { res } = render(tabla([2000, 2000], [
    `<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${alta}</w:tc>` + celda('a1'),
    celda('', '<w:vMerge/>') + celda('a2')
  ]));
  const ys = ['l1', 'l2', 'l3', 'l4'].map((t) => res.trazos.find((x) => x.text === t)!.yPt);
  const yA2 = res.trazos.find((x) => x.text === 'a2')!.yPt;
  // El último renglón de la celda combinada queda por encima del borde inferior de la tabla (bajo la fila de a2).
  const fondoTabla = Math.min(...res.barras.filter((b) => b.hPt === 1).map((b) => b.yPt));
  expect(Math.min(...ys)).toBeGreaterThan(fondoTabla);
  expect(yA2).toBeGreaterThan(fondoTabla);
});

test('vMerge que cruza un salto de página: se avisa', () => {
  const filas = Array.from({ length: 12 }, (_v, i) => (i === 0 ? celda('M', '<w:vMerge w:val="restart"/>') : celda('', '<w:vMerge/>')) + celda(`r${i}`));
  const { res } = render(tabla([2000, 2000], filas, SECT_BAJA));
  expect(res.totalPaginas).toBeGreaterThan(1);
  expect(res.advertencias.join(' | ')).toMatch(/combinad.*salto de página|salto de página.*combinad/i);
});

test('una fila más alta que una página se PARTE por líneas entre páginas, sin perder ninguna línea, y se avisa', () => {
  const muchas = Array.from({ length: 40 }, (_v, i) => `<w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>linea${i}</w:t></w:r></w:p>`).join('');
  const { res } = render(tabla([4000, 2000], [`<w:tc>${muchas}</w:tc>` + celda('lado')], SECT_BAJA));
  expect(res.totalPaginas).toBeGreaterThan(2);
  for (let i = 0; i < 40; i++) expect(res.trazos.some((t) => t.text === `linea${i}`)).toBe(true);
  // Nada cae fuera del área útil (margen inferior de 20pt).
  for (const t of res.trazos) expect(t.yPt).toBeGreaterThanOrEqual(20);
  expect(res.advertencias.join(' | ')).toMatch(/fila.*(más alta|partió|partida)|partió.*fila/i);
});

test('una fila con más celdas que columnas en tblGrid amplía la rejilla (nada se solapa ni se pierde) y se avisa', () => {
  const { res } = render(tabla([2000, 2000], [celda('c1') + celda('c2') + celda('c3')]));
  const x = ['c1', 'c2', 'c3'].map((t) => res.trazos.find((y) => y.text === t)!.xPt);
  expect(x[1]).toBeGreaterThan(x[0]!);
  expect(x[2]).toBeGreaterThan(x[1]!);
  expect(res.advertencias.join(' | ')).toMatch(/más celdas|columnas/i);
});

test('una tabla más ancha que la página se escala y se avisa', () => {
  const { res } = render(tabla([9000, 9000], [celda('a') + celda('b')])); // 900pt > 468pt útiles
  expect(res.advertencias.join(' | ')).toMatch(/más ancha|escal/i);
  const xb = res.trazos.find((t) => t.text === 'b')!.xPt;
  expect(xb).toBeLessThan(612);
});
