import { test, expect } from 'vitest';
import { construirModeloDocx, esParrafo, type ParteParrafo } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';
import { agruparAdvertencias, textosAdvertencias } from '../../src/convert/advertencia';

/**
 * E-111: campos de Word (`w:fldSimple`, `w:fldChar`/`w:instrText`). Un campo no soportado dibuja su RESULTADO EN CACHÉ (los runs entre
 * `separate` y `end`) con el formato de esos runs, nunca su código; sin caché no dibuja nada y avisa `omitido`. Solo avisa
 * `aproximado` si el campo cambia al abrir (DATE, TIME, PAGE en el cuerpo...). `PAGEREF marcador` se resuelve con NUESTRA paginación.
 * Modelo (puro) + maquetación con `medir` falso exacto (5 pt por carácter).
 */
const medir = (_f: string, _s: number, t: string): number => t.length * 5;
const DOC = (cuerpo: string, sect = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>') => `<w:document><w:body>${cuerpo}${sect}</w:body></w:document>`;
const run = (t: string, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const begin = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>';
const sep = '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const instr = (i: string) => `<w:r><w:instrText xml:space="preserve"> ${i} </w:instrText></w:r>`;
/** Campo complejo: `cache` null = sin `separate` ni resultado. */
const campo = (i: string, cache: string | null) => begin + instr(i) + (cache === null ? '' : sep + cache) + end;
const p = (c: string, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${c}</w:p>`;

function partesDe(xml: string): ParteParrafo[] {
  return construirModeloDocx(xml, null, null, null).bloques.filter(esParrafo).flatMap((b) => b.partes);
}
const textos = (ps: ParteParrafo[]): string[] => ps.filter((x) => x.tipo === 'texto').map((x) => (x as { texto: string }).texto);
const avisos = (xml: string) => agruparAdvertencias(construirModeloDocx(xml, null, null, null).advertencias);
const msgs = (a: { mensaje: string }[]) => a.map((x) => x.mensaje).join(' | ');

test('fldChar complejo desconocido (REF) con caché: dibuja la caché con el formato de SUS runs, no el código, y no avisa', () => {
  const xml = DOC(p(run('ver ') + campo('REF _Toc9 \\h', run('Capitulo dos', '<w:b/>'))));
  const ps = partesDe(xml);
  expect(textos(ps)).toEqual(['ver ', 'Capitulo dos']);
  const t = ps.find((x) => x.tipo === 'texto' && x.texto === 'Capitulo dos')!;
  expect(t.tipo === 'texto' && t.formato.font).toBe('Helvetica-Bold');
  const a = avisos(xml);
  expect(textosAdvertencias([...a.omitidas, ...a.aproximadas])).toEqual([]);
});

test('fldSimple desconocido con caché: dibuja la caché sin avisar', () => {
  const xml = DOC(p(`<w:fldSimple w:instr=" REF destino \\h ">${run('texto guardado')}</w:fldSimple>`));
  expect(textos(partesDe(xml))).toEqual(['texto guardado']);
  const a = avisos(xml);
  expect([...a.omitidas, ...a.aproximadas]).toEqual([]);
});

test('campo cambiante (DATE) con caché, complejo o simple: dibuja la caché y avisa aproximado', () => {
  for (const cuerpo of [p(campo('DATE \\@ "dd/MM/yyyy"', run('01/02/2020'))), p(`<w:fldSimple w:instr="DATE">${run('01/02/2020')}</w:fldSimple>`)]) {
    const xml = DOC(cuerpo);
    expect(textos(partesDe(xml))).toEqual(['01/02/2020']);
    const a = avisos(xml);
    expect(a.omitidas).toEqual([]);
    expect(msgs(a.aproximadas)).toMatch(/campo/i);
  }
});

test('campo sin caché (sin separate, o separate vacío; complejo o simple): no dibuja nada, jamás el código, y avisa omitido', () => {
  for (const cuerpo of [p(run('a') + campo('FOOBAR ZZCODIGO', null)), p(run('a') + campo('FOOBAR ZZCODIGO', '')), p(run('a') + '<w:fldSimple w:instr="FOOBAR ZZCODIGO"></w:fldSimple>')]) {
    const xml = DOC(cuerpo);
    expect(textos(partesDe(xml))).toEqual(['a']);
    const a = avisos(xml);
    expect(a.aproximadas).toEqual([]);
    expect(msgs(a.omitidas)).toMatch(/campo/i);
  }
});

test('campos anidados (TOC con PAGEREF dentro de un hipervínculo): ningún código se dibuja y el PAGEREF queda como referencia al marcador', () => {
  const entrada = (n: string, t: string, pg: string) => p(
    `<w:hyperlink w:anchor="${n}">${run(t)}${campo(`PAGEREF ${n} \\h`, run(pg))}</w:hyperlink>`);
  const xml = DOC(p(begin + instr('TOC \\o "1-3" \\h \\z \\u') + sep) + entrada('_Toc1', 'Intro', '7') + entrada('_Toc2', 'Fin', '8') + p(end));
  const ps = partesDe(xml);
  const refs = ps.filter((x) => x.tipo === 'texto' && x.pageref !== undefined) as { pageref: string; texto: string; ancla?: string }[];
  expect(refs.map((r) => [r.pageref, r.texto, r.ancla])).toEqual([['_Toc1', '7', '_Toc1'], ['_Toc2', '8', '_Toc2']]);
  expect(textos(ps).filter((t) => !/^\d$/.test(t))).toEqual(['Intro', 'Fin']); // ningún fragmento del código del TOC ni del PAGEREF
  const a = avisos(xml);
  expect([...a.omitidas, ...a.aproximadas]).toEqual([]);
});

test('PAGEREF con fldSimple y sin caché también es una referencia (sin caché → texto vacío)', () => {
  const ps = partesDe(DOC(p(`<w:fldSimple w:instr=" PAGEREF alfa \\h ">${run('5')}</w:fldSimple>` + campo('PAGEREF beta', ''))));
  const refs = ps.filter((x) => x.tipo === 'texto' && x.pageref !== undefined) as { pageref: string; texto: string }[];
  expect(refs.map((r) => [r.pageref, r.texto])).toEqual([['alfa', '5'], ['beta', '']]);
});

// ---------- maquetación: PAGEREF con NUESTRA paginación ----------

/** Página de 612x200 pt con 40 pt de margen arriba y abajo: 10 líneas exactas de 12 pt por página. */
const SECT = '<w:sectPr><w:pgSz w:w="12240" w:h="4000"/><w:pgMar w:top="800" w:right="1440" w:bottom="800" w:left="1440" w:header="200" w:footer="200"/></w:sectPr>';
const LINEA = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>';
const r10 = (t: string) => `<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`;
const campo10 = (i: string, cache: string) => begin + instr(i) + sep + r10(cache) + end;
const pl = (c: string, ppr = '') => p(c, LINEA + ppr);
const relleno = (n: number, pref: string) => Array.from({ length: n }, (_v, i) => pl(r10(`${pref}${i + 1}`))).join('');
const marca = (id: number, nombre: string, t: string) => pl(`<w:bookmarkStart w:id="${id}" w:name="${nombre}"/>${r10(t)}<w:bookmarkEnd w:id="${id}"/>`);
const TABS = '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs>';
const entrada = (n: string, t: string, cache: string) => pl(`<w:hyperlink w:anchor="${n}">${r10(t)}<w:r><w:tab/></w:r>${campo10(`PAGEREF ${n} \\h`, cache)}</w:hyperlink>`, TABS);

function convertir(cuerpo: string, sect = SECT) {
  const modelo = construirModeloDocx(DOC(cuerpo, sect), null, null, null);
  return { modelo, res: renderizarModeloDocx(modelo, medir) };
}
const trazosPag = (res: ReturnType<typeof renderizarModeloDocx>, texto: string) => res.trazos.filter((t) => t.text === texto);

/** TOC de 3 entradas (cachés 7, 8 y 9 a propósito) en la página 1; los títulos caen en las páginas 1, 2 y 3. */
const TOC = pl(begin + instr('TOC \\o "1-3" \\h') + sep) + entrada('_Toc1', 'Uno', '7') + entrada('_Toc2', 'Dos', '8') + entrada('_Toc3', 'Tres', '9') + pl(end)
  + marca(1, '_Toc1', 'H1') + relleno(4, 'A') // 1+3+1+1+4 = 10 líneas: página 1 completa
  + marca(2, '_Toc2', 'H2') + relleno(9, 'B') // página 2 completa
  + marca(3, '_Toc3', 'H3') + relleno(2, 'C');

test('TOC: los números son los de NUESTRA paginación (1, 2, 3), no la caché (7, 8, 9), con puntos de relleno entre título y número', () => {
  const { res } = convertir(TOC);
  expect(res.totalPaginas).toBe(3);
  for (const n of ['7', '8', '9']) expect(trazosPag(res, n)).toEqual([]);
  for (const [titulo, num] of [['Uno', '1'], ['Dos', '2'], ['Tres', '3']] as const) {
    const t = trazosPag(res, titulo)[0]!;
    const n = trazosPag(res, num)[0]!;
    expect(n.yPt).toBeCloseTo(t.yPt, 3); // misma línea
    expect(n.xPt + 5).toBeCloseTo(72 + 450, 3); // el número acaba en la parada derecha
    const puntos = res.trazos.filter((x) => /^\.+$/.test(x.text) && Math.abs(x.yPt - t.yPt) < 0.01);
    expect(puntos.length).toBeGreaterThan(0);
    expect(puntos[0]!.xPt).toBeGreaterThan(t.xPt + titulo.length * 5 - 0.01);
    expect(puntos[0]!.xPt + puntos[0]!.text.length * 5).toBeLessThanOrEqual(n.xPt + 0.01);
  }
});

test('TOC: cada entrada enlaza a la página de su marcador y no hay avisos', () => {
  const { res } = convertir(TOC);
  const destinos = new Set(res.enlacesInternos.map((e) => e.destPage));
  expect([...destinos].sort()).toEqual([0, 1, 2]);
  expect(res.enlacesInternos.every((e) => e.page === 0)).toBe(true);
  expect(textosAdvertencias(res.advertencias)).toEqual([]);
});

test('PAGEREF a un marcador inexistente: conserva la caché y avisa aproximado; sin caché, nada y omitido', () => {
  const { res } = convertir(pl(campo10('PAGEREF fantasma', '5')) + pl(begin + instr('PAGEREF otro') + end));
  expect(trazosPag(res, '5')).toHaveLength(1);
  const a = agruparAdvertencias(res.advertencias);
  expect(msgs(a.aproximadas)).toMatch(/marcador/i);
  expect(msgs(a.omitidas)).toMatch(/campo|marcador/i);
});

test('el número sale de la numeración VISIBLE: una sección que reinicia en 5 muestra 5 para su marcador', () => {
  const sec1 = '<w:sectPr><w:pgSz w:w="12240" w:h="4000"/><w:pgMar w:top="800" w:right="1440" w:bottom="800" w:left="1440"/></w:sectPr>';
  const sec2 = '<w:sectPr><w:pgSz w:w="12240" w:h="4000"/><w:pgMar w:top="800" w:right="1440" w:bottom="800" w:left="1440"/><w:pgNumType w:start="5"/></w:sectPr>';
  const cuerpo = pl(campo10('PAGEREF m', '1')) + `<w:p><w:pPr>${sec1}</w:pPr></w:p>` + marca(1, 'm', 'destino');
  const { res } = convertir(cuerpo, sec2);
  expect(trazosPag(res, '5')).toHaveLength(1);
});

test('converge cuando resolver los números cambia el ancho de la línea y mueve el salto de página', () => {
  // Caché de 119 caracteres ("9 9 9 ..."): la línea del índice ocupa 2 líneas con la caché y 1 con el número real; el marcador está en la línea 10.
  const larga = Array(60).fill('9').join(' ');
  const cuerpo = pl(campo10('PAGEREF fin', larga)) + relleno(8, 'A') + marca(1, 'fin', 'FIN') + relleno(3, 'B');
  const { res } = convertir(cuerpo);
  expect(res.marcadores.get('fin')!.page).toBe(0);
  expect(trazosPag(res, '1')).toHaveLength(1);
  expect(trazosPag(res, '9')).toEqual([]);
  expect(textosAdvertencias(res.advertencias)).toEqual([]);
});
