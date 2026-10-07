import { test, expect } from 'vitest';
import { textosAdvertencias } from '../../src/convert/advertencia';
import { construirModeloDocx, esParrafo } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';

/** E-101: marcadores de lista con `w:numFmt` (romanos, letras), `w:lvlText`, `w:start` y niveles anidados. */
const lvl = (ilvl: number, fmt: string, texto: string, start = '1') =>
  `<w:lvl w:ilvl="${ilvl}"><w:start w:val="${start}"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${texto}"/><w:pPr><w:ind w:left="${720 * (ilvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
const numbering = (niveles: string) => `<w:numbering><w:abstractNum w:abstractNumId="0">${niveles}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
const item = (ilvl: number, t: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const doc = (...ps: string[]) => `<w:document><w:body>${ps.join('')}</w:body></w:document>`;
const marcadores = (xml: string, num: string) => construirModeloDocx(xml, null, num).bloques.filter(esParrafo).map((p) => p.lista?.textoMarcador);

test('lowerRoman con lvlText "%1.": i. ii. iii. iv.', () => {
  expect(marcadores(doc(item(0, 'a'), item(0, 'b'), item(0, 'c'), item(0, 'd')), numbering(lvl(0, 'lowerRoman', '%1.')))).toEqual(['i.', 'ii.', 'iii.', 'iv.']);
});

test('upperLetter con lvlText "%1)": A) B) ...; upperRoman y lowerLetter', () => {
  expect(marcadores(doc(item(0, 'a'), item(0, 'b')), numbering(lvl(0, 'upperLetter', '%1)')))).toEqual(['A)', 'B)']);
  expect(marcadores(doc(item(0, 'a'), item(0, 'b')), numbering(lvl(0, 'upperRoman', '%1.')))).toEqual(['I.', 'II.']);
  expect(marcadores(doc(item(0, 'a'), item(0, 'b')), numbering(lvl(0, 'lowerLetter', '(%1)')))).toEqual(['(a)', '(b)']);
});

test('w:start: la numeración empieza en el valor indicado (también en romanos y letras)', () => {
  expect(marcadores(doc(item(0, 'a'), item(0, 'b')), numbering(lvl(0, 'decimal', '%1.', '5')))).toEqual(['5.', '6.']);
  expect(marcadores(doc(item(0, 'a'), item(0, 'b')), numbering(lvl(0, 'lowerRoman', '%1.', '4')))).toEqual(['iv.', 'v.']);
  expect(marcadores(doc(item(0, 'a')), numbering(lvl(0, 'upperLetter', '%1.', '3')))).toEqual(['C.']);
});

test('niveles anidados: "%1.%2." usa el formato de CADA nivel; al subir de nivel se reinicia al start del hijo', () => {
  const num = numbering(lvl(0, 'decimal', '%1.') + lvl(1, 'lowerLetter', '%1.%2.') + lvl(2, 'lowerRoman', '%3)'));
  expect(marcadores(doc(item(0, 'a'), item(1, 'b'), item(1, 'c'), item(2, 'd'), item(2, 'e'), item(0, 'f'), item(1, 'g')), num))
    .toEqual(['1.', '1.a.', '1.b.', 'i)', 'ii)', '2.', '2.a.']);
});

test('sin lvlText ni start: valores por defecto de siempre ("1.", "a.", viñeta "•")', () => {
  const sinTexto = '<w:numbering><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
  expect(marcadores(doc(item(0, 'a'), item(0, 'b')), sinTexto)).toEqual(['a.', 'b.']);
  expect(marcadores(doc(item(0, 'a')), numbering(lvl(0, 'bullet', '')))).toEqual(['•']);
});

test('un numFmt no soportado (p. ej. ordinalText) se numera con cifras y AVISA (aproximado); los soportados no avisan', () => {
  const m = construirModeloDocx(doc(item(0, 'a'), item(0, 'b')), null, numbering(lvl(0, 'ordinalText', '%1.')));
  expect(m.bloques.filter(esParrafo).map((p) => p.lista?.textoMarcador)).toEqual(['1.', '2.']);
  const aviso = m.advertencias.find((a) => /numeraci/i.test(a.mensaje));
  expect(aviso?.tipo).toBe('aproximado');
  const ok = construirModeloDocx(doc(item(0, 'a')), null, numbering(lvl(0, 'lowerRoman', '%1.')));
  expect(textosAdvertencias(ok.advertencias).join('|')).not.toMatch(/numeraci/i);
});

test('numFmt "none": el marcador es vacío y el render no antepone un hueco ni un trazo vacío al texto', () => {
  const m = construirModeloDocx(doc(item(0, 'texto')), null, numbering(lvl(0, 'none', '')));
  expect(marcadores(doc(item(0, 'texto')), numbering(lvl(0, 'none', '')))).toEqual(['']);
  const res = renderizarModeloDocx(m, (_f, _s, t) => t.length * 5);
  expect(res.trazos.map((t) => t.text)).toEqual(['texto']);
});
