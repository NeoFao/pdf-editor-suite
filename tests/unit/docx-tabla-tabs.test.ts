import { test, expect } from 'vitest';
import { textosAdvertencias } from '../../src/convert/advertencia';
import { construirModeloDocx, esTabla } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';

/**
 * E-101: tabulaciones dentro de celdas de tabla. Usan el MISMO motor que los párrafos (`lineaConTabs`), con las paradas
 * medidas desde el borde INTERIOR de la celda (borde izquierdo + 5 pt de relleno), no desde el margen de la página.
 * medir falso: 5 pt por carácter.
 */
const medir = (_f: string, _s: number, t: string): number => t.length * 5;
const SECT = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
const run = (t: string) => `<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${t}</w:t></w:r>`;
const TAB = '<w:r><w:tab/></w:r>';
const parrafo = (cuerpo: string, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${cuerpo}</w:p>`;
/** Una tabla de una fila con una celda de 4000 twips (200 pt): x de página 72, interior 77..267. */
const tabla = (...ps: string[]) => `<w:document><w:body><w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${ps.join('')}</w:tc></w:tr></w:tbl>${SECT}</w:body></w:document>`;
const convertir = (xml: string, styles: string | null = null) => {
  const modelo = construirModeloDocx(xml, styles, null);
  return { modelo, res: renderizarModeloDocx(modelo, medir) };
};
const x = (res: ReturnType<typeof renderizarModeloDocx>, texto: string): number => res.trazos.find((t) => t.text === texto)!.xPt;

test('parada izquierda a 1000 twips (50 pt): el texto tras la tabulación empieza en borde interior + 50', () => {
  const { res, modelo } = convertir(tabla(parrafo(run('a') + TAB + run('b'), '<w:tabs><w:tab w:val="left" w:pos="1000"/></w:tabs>')));
  expect(x(res, 'a')).toBe(77);
  expect(x(res, 'b')).toBe(77 + 50);
  expect(textosAdvertencias(modelo.advertencias).join('|')).not.toMatch(/tabulaci/i);
  expect(textosAdvertencias(res.advertencias)).toEqual([]);
});

test('parada derecha (3000 twips = 150 pt) con líder de puntos: el texto ACABA en borde interior + 150 y los puntos rellenan', () => {
  const { res } = convertir(tabla(parrafo(run('Tema') + TAB + run('42'), '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="3000"/></w:tabs>')));
  expect(x(res, '42') + 10).toBeCloseTo(77 + 150, 5);
  const puntos = res.trazos.find((t) => /^\.+$/.test(t.text))!;
  expect(puntos).toBeDefined();
  expect(puntos.xPt).toBeGreaterThanOrEqual(77 + 20 - 0.01);
  expect(puntos.xPt + puntos.text.length * 5).toBeLessThanOrEqual(x(res, '42') + 0.01);
});

test('sin paradas propias valen las de por defecto (36 pt) contadas desde el borde interior de la celda', () => {
  const { res } = convertir(tabla(parrafo(run('a') + TAB + run('b'))));
  expect(x(res, 'b')).toBe(77 + 36);
});

test('cada párrafo de la celda usa SUS paradas (y las del estilo, con clear)', () => {
  const styles = '<w:styles><w:style w:type="paragraph" w:styleId="Tab"><w:name w:val="Tab"/><w:pPr><w:tabs><w:tab w:val="left" w:pos="2000"/></w:tabs></w:pPr></w:style></w:styles>';
  const { res } = convertir(tabla(
    parrafo(run('uno') + TAB + run('A'), '<w:tabs><w:tab w:val="left" w:pos="1000"/></w:tabs>'),
    parrafo(run('dos') + TAB + run('B'), '<w:pStyle w:val="Tab"/>')
  ), styles);
  expect(x(res, 'A')).toBe(77 + 50);
  expect(x(res, 'B')).toBe(77 + 100);
});

test('parada decimal dentro de una celda: el separador decimal cae en la parada', () => {
  const { res } = convertir(tabla(parrafo(run('T') + TAB + run('12.50'), '<w:tabs><w:tab w:val="decimal" w:pos="2000"/></w:tabs>')));
  // "12" mide 10 pt: el punto cae en 77 + 100 -> el texto empieza en 77 + 100 - 10
  expect(x(res, '12.50')).toBe(77 + 100 - 10);
});

test('el modelo ya no degrada: la celda conserva las partes `tab` y sus paradas, y no hay aviso de tabulación', () => {
  const m = construirModeloDocx(tabla(parrafo(run('a') + TAB + run('b'), '<w:tabs><w:tab w:val="left" w:pos="1000"/></w:tabs>')), null, null);
  const t = m.bloques[0]!;
  expect(esTabla(t)).toBe(true);
  if (!esTabla(t)) return;
  const tab = t.filas[0]!.celdas[0]!.partes.find((p) => p.tipo === 'tab')!;
  expect(tab).toMatchObject({ tipo: 'tab', paradas: [{ posPt: 50, tipo: 'left' }] });
  expect(m.advertencias.find((a) => /tabulaci/i.test(a.mensaje))).toBeUndefined();
});
