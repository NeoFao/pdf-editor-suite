import { test, expect } from 'vitest';
import { construirModeloDocx, esParrafo, esTabla, type ParteParrafo, type RunFormato } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';
import { textosAdvertencias } from '../../src/convert/advertencia';

/**
 * E-105: efectos de carácter de `w:rPr` (strike, dstrike, vertAlign, caps, smallCaps, highlight, shd, vanish) a través de `rPrEfectivo`:
 * las conmutables (caps, smallCaps, strike, dstrike, vanish) hacen XOR entre niveles (OOXML 17.7.3), el resto sobrescribe.
 */
const SECT = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
const run = (t: string, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t>${t}</w:t></w:r>`;
const par = (runs: string, ppr = '') => `<w:p><w:pPr>${ppr}</w:pPr>${runs}</w:p>`;
const doc = (...b: string[]) => `<w:document><w:body>${b.join('')}${SECT}</w:body></w:document>`;
const modelo = (xml: string, estilos: string | null = null) => construirModeloDocx(xml, estilos, null);
type Texto = Extract<ParteParrafo, { tipo: 'texto' }>;
const textos = (xml: string, estilos: string | null = null): Texto[] =>
  modelo(xml, estilos).bloques.filter(esParrafo).flatMap((p) => p.partes).filter((p): p is Texto => p.tipo === 'texto');
const f = (rpr: string, estilos: string | null = null): RunFormato => textos(doc(par(run('x', rpr))), estilos)[0]!.formato;

test('strike y dstrike: 1 = simple, 2 = doble; val="0" lo apaga; dstrike manda sobre strike', () => {
  expect(f('<w:strike/>').strike).toBe(1);
  expect(f('<w:dstrike/>').strike).toBe(2);
  expect(f('<w:strike/><w:dstrike/>').strike).toBe(2);
  expect(f('<w:strike w:val="0"/>').strike ?? 0).toBe(0);
  expect(f('').strike ?? 0).toBe(0);
});

test('strike es conmutable: estilo de párrafo con strike + estilo de carácter con strike = sin tachado; el directo manda', () => {
  const est = '<w:styles><w:style w:type="paragraph" w:styleId="P"><w:rPr><w:strike/></w:rPr></w:style><w:style w:type="character" w:styleId="C"><w:rPr><w:strike/></w:rPr></w:style></w:styles>';
  const t = (r: string) => textos(doc(par(run('x', r), '<w:pStyle w:val="P"/>')), est)[0]!.formato.strike ?? 0;
  expect(t('')).toBe(1);
  expect(t('<w:rStyle w:val="C"/>')).toBe(0);
  expect(t('<w:rStyle w:val="C"/><w:strike/>')).toBe(1);
});

test('vertAlign: superíndice y subíndice a 2/3 del tamaño; la línea base sube 0,33 / baja 0,14 del tamaño NOMINAL; el alto de línea usa el nominal', () => {
  const sup = f('<w:sz w:val="40"/><w:vertAlign w:val="superscript"/>');
  expect(sup.sizePt).toBeCloseTo(20 * 2 / 3, 6);
  expect(sup.dyPt).toBeCloseTo(20 * 0.33, 6);
  expect(sup.sizeLineaPt).toBe(20);
  const sub = f('<w:sz w:val="40"/><w:vertAlign w:val="subscript"/>');
  expect(sub.sizePt).toBeCloseTo(20 * 2 / 3, 6);
  expect(sub.dyPt).toBeCloseTo(-20 * 0.14, 6);
  const bl = f('<w:sz w:val="40"/><w:vertAlign w:val="baseline"/>');
  expect(bl.sizePt).toBe(20); expect(bl.dyPt ?? 0).toBe(0);
});

test('vertAlign se hereda del estilo de carácter y baseline en el directo lo anula', () => {
  const est = '<w:styles><w:style w:type="character" w:styleId="Sup"><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style></w:styles>';
  expect(textos(doc(par(run('x', '<w:rStyle w:val="Sup"/><w:sz w:val="40"/>'))), est)[0]!.formato.sizePt).toBeCloseTo(20 * 2 / 3, 6);
  expect(textos(doc(par(run('x', '<w:rStyle w:val="Sup"/><w:sz w:val="40"/><w:vertAlign w:val="baseline"/>'))), est)[0]!.formato.sizePt).toBe(20);
});

test('caps: el texto pasa a mayúsculas; val="0" directo sobre un estilo con caps lo apaga (toggle)', () => {
  expect(textos(doc(par(run('título', '<w:caps/>'))))[0]!.texto).toBe('TÍTULO');
  const est = '<w:styles><w:style w:type="paragraph" w:styleId="P"><w:rPr><w:caps/></w:rPr></w:style></w:styles>';
  expect(textos(doc(par(run('abc'), '<w:pStyle w:val="P"/>')), est)[0]!.texto).toBe('ABC');
  expect(textos(doc(par(run('abc', '<w:caps w:val="0"/>'), '<w:pStyle w:val="P"/>')), est)[0]!.texto).toBe('abc');
});

test('smallCaps: minúsculas en mayúsculas al 80 % del tamaño, mayúsculas y cifras al tamaño pleno; el alto de línea usa el pleno', () => {
  const ps = textos(doc(par(run('Hola 2', '<w:sz w:val="40"/><w:smallCaps/>'))));
  expect(ps).toHaveLength(3);
  expect(ps[0]).toMatchObject({ texto: 'H', formato: { sizePt: 20 } });
  expect(ps[1]!.texto).toBe('OLA ');
  expect(ps[1]!.formato.sizePt).toBeCloseTo(16, 6);
  expect(ps[1]!.formato.sizeLineaPt).toBe(20);
  expect(ps[2]).toMatchObject({ texto: '2', formato: { sizePt: 20 } });
});

test('caps gana a smallCaps (Word dibuja todo en mayúsculas plenas)', () => {
  const ps = textos(doc(par(run('ab', '<w:sz w:val="40"/><w:caps/><w:smallCaps/>'))));
  expect(ps).toHaveLength(1);
  expect(ps[0]).toMatchObject({ texto: 'AB', formato: { sizePt: 20 } });
});

test('highlight (16 colores con nombre) y shd del run: fondo; highlight manda sobre shd; none y auto lo quitan', () => {
  expect(f('<w:highlight w:val="yellow"/>').fondo).toEqual([255, 255, 0]);
  expect(f('<w:highlight w:val="darkBlue"/>').fondo).toEqual([0, 0, 128]);
  expect(f('<w:shd w:val="clear" w:color="auto" w:fill="00FF00"/>').fondo).toEqual([0, 255, 0]);
  expect(f('<w:shd w:val="clear" w:fill="00FF00"/><w:highlight w:val="red"/>').fondo).toEqual([255, 0, 0]);
  const est = '<w:styles><w:style w:type="character" w:styleId="R"><w:rPr><w:highlight w:val="red"/></w:rPr></w:style></w:styles>';
  expect(f('<w:rStyle w:val="R"/>', est).fondo).toEqual([255, 0, 0]);
  expect(f('<w:rStyle w:val="R"/><w:highlight w:val="none"/>', est).fondo ?? null).toBeNull();
  expect(f('<w:shd w:val="clear" w:fill="auto"/>').fondo ?? null).toBeNull();
});

test('vanish: el texto oculto no se dibuja (como al exportar a PDF desde Word) y es conmutable', () => {
  const ps = textos(doc(par(run('oculto', '<w:vanish/>') + run('visible'))));
  expect(ps.map((p) => p.texto)).toEqual(['visible']);
  const est = '<w:styles><w:style w:type="paragraph" w:styleId="P"><w:rPr><w:vanish/></w:rPr></w:style></w:styles>';
  expect(textos(doc(par(run('abc', '<w:vanish w:val="0"/>'), '<w:pStyle w:val="P"/>')), est).map((p) => p.texto)).toEqual(['abc']);
});

test('los efectos funcionan igual dentro de una celda (misma rPrEfectivo)', () => {
  const celda = `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc>${par(run('x', '<w:strike/><w:highlight w:val="cyan"/><w:vertAlign w:val="superscript"/>'))}</w:tc></w:tr></w:tbl>`;
  const t = modelo(doc(celda)).bloques.find(esTabla)!;
  const parte = t.filas[0]!.celdas[0]!.partes.find((p): p is Texto => p.tipo === 'texto')!;
  expect(parte.formato).toMatchObject({ strike: 1, fondo: [0, 255, 255] });
  expect(parte.formato.dyPt).toBeGreaterThan(0);
});

test('avisos: w:spacing/w:position/w:w de carácter se avisan como aproximado; sin ellos, sin aviso', () => {
  expect(textosAdvertencias(modelo(doc(par(run('x', '<w:spacing w:val="20"/>')))).advertencias).join('|')).toMatch(/espaciado|posición|escala/i);
  expect(textosAdvertencias(modelo(doc(par(run('x', '<w:position w:val="6"/>')))).advertencias).join('|')).toMatch(/espaciado|posición|escala/i);
  expect(textosAdvertencias(modelo(doc(par(run('x', '<w:strike/>')))).advertencias)).toEqual([]);
});

test('el alto de línea no salta por un superíndice al inicio de la línea (se mide con el tamaño nominal)', () => {
  const medir = (_f: string, _s: number, t: string): number => t.length * 5;
  const base = (rpr: string) => doc(par(run('x', `<w:sz w:val="40"/>${rpr}`)) + par(run('despues', '<w:sz w:val="40"/>')));
  const yDespues = (xml: string): number => renderizarModeloDocx(modelo(xml), medir).trazos.find((t) => t.text === 'despues')!.yPt;
  expect(yDespues(base('<w:vertAlign w:val="superscript"/>'))).toBeCloseTo(yDespues(base('')), 6);
  expect(yDespues(base('<w:smallCaps/>'))).toBeCloseTo(yDespues(base('')), 6);
});
