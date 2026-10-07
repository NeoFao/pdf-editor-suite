import { test, expect } from 'vitest';
import { construirModeloDocx, esParrafo, esTabla, type ParteParrafo } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';
import { textosAdvertencias } from '../../src/convert/advertencia';

/** E-102: listas dentro de celdas de tabla (mismo camino que el cuerpo) y viñetas reales. */
const numbering = (niveles: string, extra = '') => `<w:numbering><w:abstractNum w:abstractNumId="0">${niveles}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${extra}</w:numbering>`;
const lvlNum = '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>';
const item = (t: string, numId = 1) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const celda = (...ps: string[]) => `<w:tc>${ps.join('')}</w:tc>`;
const tabla = (...celdas: string[]) => `<w:tbl><w:tblGrid>${celdas.map(() => '<w:gridCol w:w="3000"/>').join('')}</w:tblGrid><w:tr>${celdas.join('')}</w:tr></w:tbl>`;
const doc = (...x: string[]) => `<w:document><w:body>${x.join('')}</w:body></w:document>`;

/** Marcadores en orden de documento, de cuerpo y de celdas. */
function marcadores(xml: string, num: string): string[] {
  const m = construirModeloDocx(xml, null, num);
  const out: string[] = [];
  const deCelda = (partes: ParteParrafo[]) => { for (const p of partes) if (p.tipo === 'inicioParrafo' && p.lista) out.push(p.lista.textoMarcador); };
  for (const b of m.bloques) {
    if (esParrafo(b)) { if (b.lista) out.push(b.lista.textoMarcador); }
    else if (esTabla(b)) for (const f of b.filas) for (const c of f.celdas) deCelda(c.partes);
  }
  return out;
}

test('una lista que empieza en el cuerpo continúa dentro de una celda y vuelve al cuerpo con el siguiente número', () => {
  const xml = doc(item('a'), item('b'), tabla(celda(item('c'), item('d')), celda(item('e'))), item('f'));
  expect(marcadores(xml, numbering(lvlNum))).toEqual(['1.', '2.', '3.', '4.', '5.', '6.']);
});

test('dos listas distintas en celdas contiguas llevan cada una su contador', () => {
  const dos = '<w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>';
  const xml = doc(tabla(celda(item('a', 1), item('b', 1)), celda(item('x', 2), item('y', 2)), celda(item('c', 1))));
  expect(marcadores(xml, numbering(lvlNum, dos))).toEqual(['1.', '2.', '1.', '2.', '3.']);
});

test('la sangría de la lista se aplica en la celda: el marcador cuelga a la izquierda y el texto queda sangrado', () => {
  const m = construirModeloDocx(doc(tabla(celda(item('uno')))), null, numbering(lvlNum));
  const t = m.bloques.find(esTabla)!;
  const ini = t.filas[0]!.celdas[0]!.partes.find((p) => p.tipo === 'inicioParrafo');
  expect(ini).toMatchObject({ tipo: 'inicioParrafo', sangriaIzqPt: 36, sangriaPrimeraLineaPt: -18 });
});

test('en el PDF, la primera línea de cada ítem de la celda lleva su marcador y arranca colgada 18 pt a la izquierda de la sangría', () => {
  const m = construirModeloDocx(doc(tabla(celda(item('uno'), item('dos')))), null, numbering(lvlNum));
  const r = renderizarModeloDocx(m, (_f, sz, s) => s.length * sz * 0.5);
  const uno = r.trazos.find((x) => x.text.startsWith('1.') && x.text.includes('uno'))!;
  const dos = r.trazos.find((x) => x.text.startsWith('2.') && x.text.includes('dos'))!;
  expect(uno).toBeDefined();
  expect(dos).toBeDefined();
  // x de la celda (72) + relleno (5) + sangría del nivel (36) - colgante (18).
  expect(uno.xPt).toBeCloseTo(72 + 5 + 36 - 18, 1);
  expect(dos.xPt).toBeCloseTo(uno.xPt, 1);
});

// --- Viñetas ---------------------------------------------------------------
const lvlBullet = (texto: string, fuente: string | null) =>
  `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${texto}"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>${fuente ? `<w:rPr><w:rFonts w:ascii="${fuente}" w:hAnsi="${fuente}" w:hint="default"/></w:rPr>` : ''}</w:lvl>`;

test('la viñeta usa el carácter de lvlText: Wingdings F0FC es ✓ y lleva fuente ZapfDingbats', () => {
  const m = construirModeloDocx(doc(item('a')), null, numbering(lvlBullet('', 'Wingdings')));
  const p = m.bloques.filter(esParrafo)[0]!;
  expect(p.lista).toMatchObject({ textoMarcador: '✓', fuenteMarcador: 'ZapfDingbats' });
  expect(textosAdvertencias(m.advertencias).join('|')).not.toMatch(/viñeta/i);
});

test('una viñeta sin glifo disponible (Wingdings F0A8) sale como "•" y avisa como aproximado, una sola vez por tipo', () => {
  const m = construirModeloDocx(doc(item('a'), item('b')), null, numbering(lvlBullet('', 'Wingdings')));
  expect(m.bloques.filter(esParrafo).map((p) => p.lista?.textoMarcador)).toEqual(['•', '•']);
  const aviso = m.advertencias.filter((a) => /viñeta/i.test(a.mensaje));
  expect(aviso).toHaveLength(1);
  expect(aviso[0]!.tipo).toBe('aproximado');
});

test('una viñeta dentro de una celda también usa su carácter real', () => {
  const m = construirModeloDocx(doc(tabla(celda(item('a')))), null, numbering(lvlBullet('', 'Wingdings')));
  const ini = m.bloques.find(esTabla)!.filas[0]!.celdas[0]!.partes.find((p) => p.tipo === 'inicioParrafo');
  expect(ini).toMatchObject({ lista: { textoMarcador: '➢' } });
});
