import { test, expect } from 'vitest';
import { construirModeloDocx, esParrafo, type ParteParrafo } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';
import { textosAdvertencias, agruparAdvertencias } from '../../src/convert/advertencia';

/**
 * E-109: notas al pie y notas al final de Word. `word/footnotes.xml` y `word/endnotes.xml` llegan ya decodificados en `extras.partes`.
 * La referencia del cuerpo es un `texto` con el número en superíndice (y `nota` = índice de la nota); el cuerpo de cada nota se
 * guarda en `ModeloDocx.notasAlPie` / `notasFinales`. Los separadores (`w:type="separator"`/`continuationSeparator`) no son notas.
 */
const SECT = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
const doc = (...b: string[]) => `<w:document><w:body>${b.join('')}${SECT}</w:body></w:document>`;
const par = (runs: string) => `<w:p>${runs}</w:p>`;
const run = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const refPie = (id: number, estilo = 'FootnoteReference') => `<w:r><w:rPr><w:rStyle w:val="${estilo}"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
const refFin = (id: number) => `<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteReference w:id="${id}"/></w:r>`;
const ESTILOS = '<w:styles>'
  + '<w:style w:type="character" w:styleId="FootnoteReference"><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>'
  + '<w:style w:type="character" w:styleId="EndnoteReference"><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:rPr><w:sz w:val="16"/></w:rPr></w:style>'
  + '</w:styles>';
const especiales = (raiz: string) => `<w:${raiz} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${raiz}><w:${raiz} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${raiz}>`;
const notaXml = (raiz: string, id: number, texto: string, tagRef: string) => `<w:${raiz} w:id="${id}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:${tagRef}/></w:r><w:r><w:t xml:space="preserve"> ${texto}</w:t></w:r></w:p></w:${raiz}>`;
const pies = (...t: string[]) => `<w:footnotes>${especiales('footnote')}${t.map((x, i) => notaXml('footnote', i + 1, x, 'footnoteRef')).join('')}</w:footnotes>`;
const finales = (...t: string[]) => `<w:endnotes>${especiales('endnote')}${t.map((x, i) => notaXml('endnote', i + 1, x, 'endnoteRef')).join('')}</w:endnotes>`;
type Texto = Extract<ParteParrafo, { tipo: 'texto' }>;
const textosDe = (m: ReturnType<typeof construirModeloDocx>): Texto[] => m.bloques.filter(esParrafo).flatMap((p) => p.partes).filter((p): p is Texto => p.tipo === 'texto');
const construir = (xml: string, partes: Record<string, string>, settingsXml: string | null = null) => construirModeloDocx(xml, ESTILOS, null, null, { partes, settingsXml });

test('la referencia es el número en superíndice y la numeración es continua por documento', () => {
  const m = construir(doc(par(run('Uno') + refPie(1)), par(run('Dos') + refPie(2))), { 'word/footnotes.xml': pies('Primera', 'Segunda') });
  const refs = textosDe(m).filter((t) => t.nota !== undefined);
  expect(refs.map((t) => t.texto)).toEqual(['1', '2']);
  expect(refs.map((t) => t.nota)).toEqual([0, 1]);
  for (const r of refs) { expect(r.formato.dyPt).toBeGreaterThan(0); expect(r.formato.sizePt).toBeCloseTo(11 * 2 / 3, 1); }
  expect(m.notasAlPie?.map((n) => n.numero)).toEqual(['1', '2']);
});

test('el cuerpo de la nota usa el estilo FootnoteText (tamaño e interlineado efectivos) y arranca con su número en superíndice', () => {
  const m = construir(doc(par(run('Uno') + refPie(1))), { 'word/footnotes.xml': pies('Primera') });
  const n = m.notasAlPie![0]!;
  const p = n.bloques.filter(esParrafo)[0]!;
  expect(p.interlineadoExactoPt).toBe(12);
  expect(p.espacioDespuesPt).toBe(0);
  const t = p.partes.filter((x): x is Texto => x.tipo === 'texto');
  expect(t[0]!.texto).toBe('1');
  expect(t[0]!.formato.dyPt).toBeGreaterThan(0);
  expect(t[0]!.formato.sizePt).toBeCloseTo(8 * 2 / 3, 1); // 8 pt de FootnoteText x 2/3
  expect(t.map((x) => x.texto).join('').replace(/\s+/g, ' ')).toContain('Primera');
});

test('sin el estilo FootnoteReference el número sale igualmente en superíndice', () => {
  const m = construirModeloDocx(doc(par(run('Uno') + refPie(1, 'Inexistente'))), null, null, null, { partes: { 'word/footnotes.xml': pies('Primera') } });
  const r = textosDe(m).find((t) => t.nota !== undefined)!;
  expect(r.formato.dyPt).toBeGreaterThan(0);
});

test('los separadores y notas especiales no cuentan como notas', () => {
  const m = construir(doc(par(run('Uno') + refPie(1))), { 'word/footnotes.xml': pies('Primera') });
  expect(m.notasAlPie).toHaveLength(1);
  expect(JSON.stringify(m.notasAlPie)).not.toContain('separator');
});

test('w:footnotePr de settings.xml: formato y número inicial (w:numFmt, w:numStart)', () => {
  const settings = '<w:settings><w:footnotePr><w:numFmt w:val="lowerLetter"/><w:numStart w:val="3"/></w:footnotePr></w:settings>';
  const m = construir(doc(par(run('A') + refPie(1)), par(run('B') + refPie(2))), { 'word/footnotes.xml': pies('x', 'y') }, settings);
  expect(m.notasAlPie?.map((n) => n.numero)).toEqual(['c', 'd']);
});

test('notas al final: numeración propia en romanos en minúscula; la referencia del cuerpo lleva el número, sin nota al pie', () => {
  const m = construir(doc(par(run('A') + refFin(1)), par(run('B') + refFin(2))), { 'word/endnotes.xml': finales('Final uno', 'Final dos') });
  expect(m.notasFinales?.map((n) => n.numero)).toEqual(['i', 'ii']);
  const refs = textosDe(m).filter((t) => t.formato.dyPt !== undefined && t.formato.dyPt > 0);
  expect(refs.map((t) => t.texto)).toEqual(['i', 'ii']);
  expect(refs.every((t) => t.nota === undefined)).toBe(true);
  expect(m.notasAlPie ?? []).toHaveLength(0);
});

test('pies y finales conviven con numeraciones independientes', () => {
  const m = construir(doc(par(run('A') + refPie(1) + refFin(1))), { 'word/footnotes.xml': pies('P'), 'word/endnotes.xml': finales('F') });
  expect(m.notasAlPie?.map((n) => n.numero)).toEqual(['1']);
  expect(m.notasFinales?.map((n) => n.numero)).toEqual(['i']);
});

test('ya no avisa «omitido» por notas; lo que no se reproduce avisa como aproximado', () => {
  const ok = construir(doc(par(run('A') + refPie(1) + refFin(1))), { 'word/footnotes.xml': pies('P'), 'word/endnotes.xml': finales('F') });
  expect(textosAdvertencias(ok.advertencias)).toEqual([]);

  const reinicio = '<w:settings><w:footnotePr><w:numRestart w:val="eachPage"/></w:footnotePr></w:settings>';
  const aprox = construir(doc(par(run('A') + refPie(1))), { 'word/footnotes.xml': pies('P') }, reinicio);
  expect(agruparAdvertencias(aprox.advertencias).aproximadas.map((a) => a.mensaje).join(' | ')).toMatch(/reinicio/i);

  // Referencia a una nota que no existe: se avisa como omitida (nunca en silencio).
  const rota = construir(doc(par(run('A') + refPie(9))), { 'word/footnotes.xml': pies('P') });
  expect(agruparAdvertencias(rota.advertencias).omitidas.map((a) => a.mensaje).join(' | ')).toMatch(/nota/i);
});

test('sin footnotes.xml la referencia se avisa como omitida (el resto del texto se conserva)', () => {
  const m = construir(doc(par(run('Texto') + refPie(1))), {});
  expect(agruparAdvertencias(m.advertencias).omitidas.map((a) => a.mensaje).join(' | ')).toMatch(/nota/i);
  expect(textosDe(m).map((t) => t.texto).join('')).toContain('Texto');
});

test('render: las notas al final salen tras el último párrafo, con su separador, y los números i / ii', () => {
  const m = construir(doc(par(run('Primero') + refFin(1)), par(run('Ultimo') + refFin(2))), { 'word/endnotes.xml': finales('Final uno', 'Final dos') });
  const medir = (_f: string, s: number, t: string): number => t.length * s * 0.5;
  const r = renderizarModeloDocx(m, medir);
  const y = (t: string): number => r.trazos.find((x) => x.text.includes(t))!.yPt;
  expect(r.totalPaginas).toBe(1);
  expect(y('Final uno')).toBeLessThan(y('Ultimo'));
  expect(y('Final dos')).toBeLessThan(y('Final uno'));
  expect(r.trazos.some((t) => t.text === 'i')).toBe(true);
  expect(r.trazos.some((t) => t.text === 'ii')).toBe(true);
  expect(r.barras.some((b) => b.wPt === 144)).toBe(true); // separador de las notas finales
});

test('render: una referencia dentro de una celda de tabla reserva su nota en la página de la fila, bajo la tabla', () => {
  const celda = `<w:tc><w:p>${run('Celda') + refPie(1)}</w:p></w:tc>`;
  const tabla = `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr>${celda}</w:tr></w:tbl>`;
  const m = construir(doc(tabla, par(run('Despues'))), { 'word/footnotes.xml': pies('Nota de celda') });
  expect(m.notasAlPie).toHaveLength(1);
  const medir = (_f: string, s: number, t: string): number => t.length * s * 0.5;
  const r = renderizarModeloDocx(m, medir);
  const y = (t: string): number => r.trazos.find((x) => x.text.includes(t))!.yPt;
  expect(r.trazos.find((x) => x.text.includes('Nota de celda'))!.page).toBe(0);
  expect(y('Nota de celda')).toBeLessThan(y('Despues'));
  expect(y('Nota de celda')).toBeGreaterThanOrEqual(72);
  expect(r.barras.some((b) => b.wPt === 144)).toBe(true);
});

test('un documento con notas y tabulaciones en la nota: la nota se maqueta entera (flex aplanado) y no se pierde', () => {
  const nota = '<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:tab/><w:t>Con tabulacion</w:t></w:r></w:p></w:footnote>';
  const m = construir(doc(par(run('A') + refPie(1))), { 'word/footnotes.xml': `<w:footnotes>${nota}</w:footnotes>` });
  const medir = (_f: string, s: number, t: string): number => t.length * s * 0.5;
  const r = renderizarModeloDocx(m, medir);
  expect(r.trazos.some((x) => x.text.includes('Con tabulacion'))).toBe(true);
});
