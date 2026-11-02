import { test, expect } from 'vitest';
import { paginar, parrafoFlex, type Atom, type Medir, type FlowItem, type PageGeometry, type FlowParrafoFlex } from '../../src/convert/flujo/layout';

/**
 * Imágenes flotantes (Word `wp:anchor`), MAQUETADOR puro: exclusión por línea en la banda vertical de la imagen,
 * `topAndBottom`, posiciones relativas a margen y a página, capa (detrás/delante del texto) y la imagen que sigue a su párrafo
 * al saltar de página. `medir` falso exacto: 6 pt por carácter. Unidades: pt PDF (origen abajo-izquierda) salvo `v.offsetPt`
 * (hacia abajo desde el borde superior de `rel`).
 */
const medir: Medir = (_f, _s, t) => t.length * 6;
const atomo = (text: string): Atom => ({ text, font: 'Helvetica', sizePt: 10, color: [0, 0, 0] });
const palabras = (n: number): Atom[] => Array.from({ length: n }, (_v, i) => atomo(`p${String(i).padStart(2, '0')}`)); // 3 caracteres = 18 pt
/** Página 300x400, márgenes de 50: texto en x de 50 a 250 (200 pt), de y=350 (arriba) a y=50. */
const GEO: PageGeometry = { widthPt: 300, heightPt: 400, marginTopPt: 50, marginBottomPt: 50, marginLeftPt: 50, marginRightPt: 50 };
const parrafo = (n = 60, extra: Partial<Parameters<typeof parrafoFlex>[0]> = {}): FlowParrafoFlex =>
  parrafoFlex({ atoms: palabras(n), xNormalPt: 50, xPrimeraPt: 50, wPt: 200, align: 'left', alturaLinea: () => 20, tabs: null, medir, ...extra });
const lineasDe = (res: ReturnType<typeof paginar>) => {
  const porY = new Map<number, { page: number; x: number; fin: number }>();
  for (const t of res.trazos) {
    const k = t.page * 10000 + t.yPt;
    const prev = porY.get(k);
    porY.set(k, { page: t.page, x: Math.min(prev?.x ?? Infinity, t.xPt), fin: Math.max(prev?.fin ?? 0, t.xPt + medir('', 0, t.text)) });
  }
  return [...porY.entries()].map(([k, v]) => ({ y: k - v.page * 10000, ...v })).sort((a, b) => a.page - b.page || b.y - a.y);
};
const SQ = (l = 10, r = 0, t = 0, b = 0) => ({ modo: 'square' as const, distLPt: l, distRPt: r, distTPt: t, distBPt: b });
const lin = (txt: string): FlowItem => ({ kind: 'line', height: 20, segs: [{ xPt: 50, text: txt, font: 'Helvetica', sizePt: 10, color: [0, 0, 0] }], bars: [] });

test('square relativa a PÁGINA (x) y a MARGEN (y): las líneas de la banda se acortan a su izquierda; las demás, no', () => {
  // Imagen 60x60: x = 190 (page, offset 190); yTop = 50 (margen sup.) + 40 = 90 desde arriba -> y PDF 250..310. distL 10 -> caja desde x=180.
  const items: FlowItem[] = [
    { kind: 'floatImage', imgId: 'i', wPt: 60, hPt: 60, h: { rel: 'page', offsetPt: 190 }, v: { rel: 'margin', offsetPt: 40 }, ajuste: SQ() },
    parrafo()
  ];
  const res = paginar(items, GEO, 0.28);
  const img = res.imagenes[0]!;
  expect([img.xPt, img.yPt, img.wPt, img.hPt]).toEqual([190, 250, 60, 60]);
  let cruzan = 0;
  for (const l of lineasDe(res)) {
    const fondo = l.y - 20 * 0.28; // las líneas miden 20 pt y la base está al 28 % desde el fondo
    if (fondo < 310 && fondo + 20 > 250) { cruzan++; expect(l.fin).toBeLessThanOrEqual(180 + 0.001); }
  }
  expect(cruzan).toBeGreaterThanOrEqual(3);
  expect(lineasDe(res).filter((l) => l.fin > 190).length).toBeGreaterThan(0); // fuera de la banda usa todo el ancho
});

test('topAndBottom relativa al margen y centrada: ninguna línea se cruza con la caja y la primera pasa por debajo de ella', () => {
  const items: FlowItem[] = [
    { kind: 'floatImage', imgId: 'i', wPt: 100, hPt: 40, h: { rel: 'margin', align: 'center' }, v: { rel: 'paragraph', offsetPt: 0 }, ajuste: { modo: 'topBottom', distLPt: 0, distRPt: 0, distTPt: 0, distBPt: 10 } },
    parrafo(20)
  ];
  const res = paginar(items, GEO, 0.28);
  const img = res.imagenes[0]!;
  expect(img.xPt).toBe(100); // 50 + (200 - 100) / 2
  expect(img.yPt).toBe(310); // tope del párrafo (350) - 40
  const primera = lineasDe(res)[0]!;
  expect(primera.y - 20 * 0.28 + 20).toBeLessThanOrEqual(310 - 10 + 0.001); // la línea empieza bajo la caja con su distancia inferior
});

test('detrás del texto (`capa: detras`) y delante (`capa: delante`) se copian a la imagen colocada, sin apartar el texto', () => {
  const items: FlowItem[] = [
    { kind: 'floatImage', imgId: 'a', wPt: 60, hPt: 60, h: { rel: 'page', offsetPt: 100 }, v: { rel: 'page', offsetPt: 60 }, capa: 'detras' },
    { kind: 'floatImage', imgId: 'b', wPt: 60, hPt: 60, h: { rel: 'page', offsetPt: 100 }, v: { rel: 'page', offsetPt: 60 }, capa: 'delante' },
    { kind: 'floatImage', imgId: 'c', wPt: 60, hPt: 60, h: { rel: 'page', offsetPt: 10 }, v: { rel: 'page', offsetPt: 60 } },
    parrafo(20)
  ];
  const res = paginar(items, GEO, 0.28);
  expect(res.imagenes.map((i) => [i.imgId, i.capa])).toEqual([['a', 'detras'], ['b', 'delante'], ['c', undefined]]);
  // El texto no se aparta de ninguna: la primera línea llena el ancho completo (8 palabras).
  expect(lineasDe(res)[0]!.fin).toBeGreaterThan(200);
});

test('una flotante anclada a un párrafo (mantener junto) que salta de página se coloca en ESA página, con su párrafo', () => {
  // Página útil de 300 pt = 15 líneas de 20. 14 líneas de relleno dejan 1; el párrafo de 3 líneas (keepStart..keepEnd) salta entero.
  const items: FlowItem[] = [
    ...Array.from({ length: 14 }, (_v, i) => lin(`r${i}`)),
    { kind: 'keepStart' },
    { kind: 'floatImage', imgId: 'i', wPt: 30, hPt: 30, h: { rel: 'margin', align: 'right' }, v: { rel: 'paragraph', offsetPt: 0 }, ajuste: SQ() },
    lin('a1'), lin('a2'), lin('a3'),
    { kind: 'keepEnd' }
  ];
  const res = paginar(items, GEO, 0.28);
  expect(res.trazos.find((t) => t.text === 'a1')!.page).toBe(1);
  expect(res.imagenes[0]!.page).toBe(1);
  expect(res.imagenes[0]!.yPt).toBe(320); // tope del párrafo en la página nueva (350) - 30
});
