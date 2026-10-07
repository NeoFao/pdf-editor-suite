import { test, expect } from 'vitest';
import { construirModeloDocx } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';
import { agruparAdvertencias } from '../../src/convert/advertencia';

/**
 * Enlaces internos de Word (`w:hyperlink w:anchor` → `w:bookmarkStart w:name`), MODELO + MAQUETACIÓN: la paginación registra dónde
 * cae cada marcador (página 0-based + y del BORDE SUPERIOR de su línea, pt PDF con origen abajo) y, ya paginado, cada enlace se
 * resuelve a su destino. `medir` falso exacto (5 pt por carácter). Página de 612x200 pt con 40 pt de margen arriba y abajo: 120 pt
 * útiles = 10 líneas exactas de 12 pt; la primera línea de cada página tiene su borde superior en y = 160.
 */
const medir = (_f: string, _s: number, t: string): number => t.length * 5;
const MAR = '<w:pgSz w:w="12240" w:h="4000"/><w:pgMar w:top="800" w:right="1440" w:bottom="800" w:left="1440" w:header="200" w:footer="200"/>';
const LINEA = '<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>';
const run = (t: string) => `<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${t}</w:t></w:r>`;
const p = (contenido: string) => `<w:p>${LINEA}${contenido}</w:p>`;
const relleno = (n: number, pref: string) => Array.from({ length: n }, (_v, i) => p(run(`${pref}${i + 1}`))).join('');
const enlace = (ancla: string, t: string) => `<w:hyperlink w:anchor="${ancla}">${run(t)}</w:hyperlink>`;

function convertir(cuerpo: string) {
  const doc = `<w:document><w:body>${cuerpo}<w:sectPr>${MAR}</w:sectPr></w:body></w:document>`;
  const modelo = construirModeloDocx(doc, null, null, null);
  return { modelo, res: renderizarModeloDocx(modelo, medir) };
}

/** 3 páginas: la 1.ª (índice 0) trae los enlaces en sus 3 primeras líneas; el marcador cae en la 5.ª línea de la 3.ª página (índice 2). */
const CUERPO = [
  p(enlace('destino', 'ir')), p(enlace('fantasma', 'roto')), p(enlace('_GoBack', 'volver')), relleno(7, 'A'),
  relleno(10, 'B'),
  relleno(4, 'C'), p(`<w:bookmarkStart w:id="1" w:name="destino"/>${run('aqui')}<w:bookmarkEnd w:id="1"/>`), relleno(4, 'D'),
  p('<w:bookmarkStart w:id="2" w:name="_GoBack"/><w:bookmarkEnd w:id="2"/>')
].join('');

test('modelo: el enlace con w:anchor lleva su ancla, el w:bookmarkStart se conserva y ya no avisa "enlace interno"', () => {
  const { modelo } = convertir(CUERPO);
  const partes = modelo.bloques.flatMap((b) => (b.tipo === 'parrafo' ? b.partes : []));
  expect(partes.filter((x) => x.tipo === 'texto' && x.ancla !== undefined).map((x) => (x as { ancla: string }).ancla)).toEqual(['destino', 'fantasma', '_GoBack']);
  expect(partes.filter((x) => x.tipo === 'marcador').map((x) => (x as { nombre: string }).nombre)).toContain('destino');
  expect(modelo.advertencias.map((a) => a.mensaje).join(' | ')).not.toMatch(/enlaces? interno/i);
});

test('paginación: registra página y y (borde superior de la línea) de cada marcador', () => {
  const { res } = convertir(CUERPO);
  expect(res.totalPaginas).toBe(3);
  const m = res.marcadores.get('destino')!;
  expect(m.page).toBe(2);
  expect(m.yPt).toBeCloseTo(160 - 4 * 12, 1); // 5.ª línea de la página: 4 líneas de 12 pt por encima
  expect(res.marcadores.has('fantasma')).toBe(false);
});

test('_GoBack (el cursor de Word) no se registra como marcador', () => {
  const { res } = convertir(CUERPO);
  expect(res.marcadores.has('_GoBack')).toBe(false);
});

test('un marcador sin texto detrás (párrafo vacío) también se registra, en el borde superior de su línea', () => {
  const { res } = convertir(relleno(2, 'Z') + p('<w:bookmarkStart w:id="3" w:name="vacio"/><w:bookmarkEnd w:id="3"/>'));
  expect(res.marcadores.get('vacio')).toMatchObject({ page: 0 });
  expect(res.marcadores.get('vacio')!.yPt).toBeCloseTo(160 - 2 * 12, 1);
});

test('resolución: el enlace al marcador existente apunta a su página y y; el inexistente y _GoBack quedan sin enlace con aviso omitido', () => {
  const { res } = convertir(CUERPO);
  expect(res.enlacesInternos).toHaveLength(1);
  const e = res.enlacesInternos[0]!;
  expect(e).toMatchObject({ page: 0, destPage: 2 });
  expect(e.destYPt).toBeCloseTo(112, 1);
  // La caja cae sobre el texto "ir" de la 1.ª línea (x = 72 pt de margen, 2 caracteres de 5 pt).
  expect(e.xPt).toBeCloseTo(72, 1);
  expect(e.wPt).toBeCloseTo(10, 1);
  const { omitidas } = agruparAdvertencias(res.advertencias);
  expect(omitidas.map((a) => a.mensaje).join(' | ')).toMatch(/2 enlaces sin destino/);
});

test('un marcador oculto _Toc… es un destino válido', () => {
  const cuerpo = p(enlace('_Toc123', 'indice')) + relleno(10, 'X') + p(`<w:bookmarkStart w:id="9" w:name="_Toc123"/>${run('Capitulo')}`);
  const { res } = convertir(cuerpo);
  expect(res.enlacesInternos).toHaveLength(1);
  expect(res.enlacesInternos[0]!.destPage).toBe(1);
  expect(res.advertencias).toEqual([]);
});

test('un enlace repetido hacia el mismo marcador genera un enlace por cada uso', () => {
  const cuerpo = p(enlace('t', 'uno')) + p(enlace('t', 'dos')) + p(`<w:bookmarkStart w:id="1" w:name="t"/>${run('fin')}`);
  const { res } = convertir(cuerpo);
  expect(res.enlacesInternos.map((e) => e.page)).toEqual([0, 0]);
});
