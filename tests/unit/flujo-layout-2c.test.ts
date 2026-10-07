import { test, expect } from 'vitest';
import {
  paginar, colocarZona, parrafoFlex, lineaConTabs,
  type Atom, type Medir, type FlowItem, type PageGeometry, type FlowParrafoFlex, type TabStopAbs, type Obstaculo
} from '../../src/convert/flujo/layout';

/**
 * Word fase 2c, MAQUETADOR (puro, sin motor): secciones con geometría propia,
 * texto alrededor de obstáculos flotantes y tabulaciones reales.
 * `medir` falso EXACTO: 6 pt por carácter.
 */
const medir: Medir = (_f, _s, t) => t.length * 6;
const atomo = (text: string): Atom => ({ text, font: 'Helvetica', sizePt: 10, color: [0, 0, 0] });
const tabAtomo = (): Atom => ({ text: '', font: 'Helvetica', sizePt: 10, color: [0, 0, 0], tab: {} });
const palabras = (n: number): Atom[] => Array.from({ length: n }, (_v, i) => atomo(`p${String(i).padStart(2, '0')}`)); // 3 chars = 18 pt

const GEO: PageGeometry = { widthPt: 300, heightPt: 400, marginTopPt: 50, marginBottomPt: 50, marginLeftPt: 50, marginRightPt: 50 };
const APAISADA: PageGeometry = { widthPt: 400, heightPt: 300, marginTopPt: 20, marginBottomPt: 20, marginLeftPt: 30, marginRightPt: 30 };
const linea = (txt: string, x = 50): FlowItem => ({ kind: 'line', height: 20, segs: [{ xPt: x, text: txt, font: 'Helvetica', sizePt: 10, color: [0, 0, 0] }], bars: [] });
const sec = (geo: PageGeometry, seccion: number, continua = false): FlowItem => ({ kind: 'section', geo, continua, seccion });

// ---------------------------------------------------------------------------
// Secciones
// ---------------------------------------------------------------------------

test('una sección nextPage abre una página nueva con SU geometría (apaisada) y la registra en `paginas`', () => {
  const res = paginar([sec(GEO, 0), linea('a'), sec(APAISADA, 1), linea('b')], GEO, 0.28);
  expect(res.totalPaginas).toBe(2);
  expect(res.paginas.map((p) => [p.geo.widthPt, p.geo.heightPt, p.seccion])).toEqual([[300, 400, 0], [400, 300, 1]]);
  const b = res.trazos.find((t) => t.text === 'b')!;
  expect(b.page).toBe(1);
  // La primera línea de la página apaisada cuelga del margen superior de SU sección (300 - 20 - 20 de alto de línea = 260 de fondo).
  expect(b.yPt).toBeCloseTo(300 - 20 - 20 + 20 * 0.28, 5);
});

test('una sección `continuous` NO abre página: sigue en la misma y aplica el margen inferior nuevo', () => {
  const inferiorGrande: PageGeometry = { ...GEO, marginBottomPt: 250 }; // deja solo 100 pt de alto útil (400 - 50 - 250)
  const items: FlowItem[] = [sec(GEO, 0), linea('a'), sec(inferiorGrande, 1, true), linea('b'), linea('c'), linea('d'), linea('e'), linea('f'), linea('g')];
  const res = paginar(items, GEO, 0.28);
  expect(res.paginas[0]!.seccion).toBe(0);
  expect(res.trazos.find((t) => t.text === 'b')!.page).toBe(0);
  // 20 pt de 'a' + 4 líneas de 20 caben en los 100 pt; 'f' ya no cabe y salta de página.
  expect(res.trazos.find((t) => t.text === 'e')!.page).toBe(0);
  expect(res.trazos.find((t) => t.text === 'f')!.page).toBe(1);
  expect(res.totalPaginas).toBe(2);
});

test('una sección nextPage que empieza en una página todavía vacía la reutiliza (sin página en blanco)', () => {
  const res = paginar([sec(GEO, 0), sec(APAISADA, 1), linea('x')], GEO, 0.28);
  expect(res.totalPaginas).toBe(1);
  expect(res.paginas[0]!.geo.widthPt).toBe(400);
  expect(res.paginas[0]!.seccion).toBe(1);
});

test('sin marcadores de sección, `paginas` describe todas las páginas con la geometría inicial (compatibilidad)', () => {
  const items: FlowItem[] = Array.from({ length: 30 }, (_v, i) => linea(`l${i}`));
  const res = paginar(items, GEO, 0.28);
  expect(res.paginas).toHaveLength(res.totalPaginas);
  expect(res.paginas.every((p) => p.geo === GEO && p.seccion === 0)).toBe(true);
});

// ---------------------------------------------------------------------------
// Texto alrededor de obstáculos
// ---------------------------------------------------------------------------

/** Párrafo de 30 palabras de 18 pt: 200 pt de ancho caben 10 palabras con sus espacios (10*18 + 9*6 = 234 > 200 -> 8 por línea: 8*18+7*6=186). */
function parrafo(extra: Partial<Parameters<typeof parrafoFlex>[0]> = {}): FlowParrafoFlex {
  return parrafoFlex({ atoms: palabras(30), xNormalPt: 50, xPrimeraPt: 50, wPt: 200, align: 'left', alturaLinea: () => 20, tabs: null, medir, ...extra });
}
const lineasDe = (res: ReturnType<typeof paginar>) => {
  const porY = new Map<number, { x: number; fin: number }>();
  for (const t of res.trazos) {
    const fin = t.xPt + medir('', 0, t.text);
    const prev = porY.get(t.yPt);
    porY.set(t.yPt, { x: Math.min(prev?.x ?? Infinity, t.xPt), fin: Math.max(prev?.fin ?? 0, fin) });
  }
  return [...porY.entries()].sort((a, b) => b[0] - a[0]).map(([y, v]) => ({ y, ...v }));
};

test('sin obstáculos el párrafo flexible da las mismas líneas que el ajuste de siempre (8 palabras por línea)', () => {
  const res = paginar([parrafo()], GEO, 0.28);
  const ls = lineasDe(res);
  expect(ls).toHaveLength(4); // 8 + 8 + 8 + 6
  expect(ls[0]!.x).toBe(50);
  expect(ls[0]!.fin).toBeLessThanOrEqual(250);
});

test('un obstáculo cuadrado a la DERECHA acorta solo las líneas que se cruzan con él: se quedan a su izquierda', () => {
  // Página de 400 de alto, margen 50: el texto empieza en y=350. Obstáculo: x 170..250, y (PDF) 290..330 -> cruza las líneas 2 y 3.
  const obst: Obstaculo = { xPt: 170, yPt: 290, wPt: 80, hPt: 40, modo: 'square' };
  const res = paginar([parrafo()], GEO, 0.28, new Map([[0, [obst]]]));
  const ls = lineasDe(res);
  expect(ls[0]!.fin).toBeGreaterThan(170); // la línea 1 (y 330..350) no toca el obstáculo
  expect(ls[1]!.fin).toBeLessThanOrEqual(170);
  expect(ls[2]!.fin).toBeLessThanOrEqual(170);
  expect(ls[3]!.fin).toBeGreaterThan(170); // pasada la caja, vuelve el ancho completo
  // Ninguna palabra se pierde.
  expect(res.trazos.map((t) => t.text).join(' ').split(' ')).toHaveLength(30);
});

test('un obstáculo a la IZQUIERDA desplaza el inicio de las líneas afectadas a su derecha', () => {
  const obst: Obstaculo = { xPt: 50, yPt: 290, wPt: 80, hPt: 40, modo: 'square' };
  const res = paginar([parrafo()], GEO, 0.28, new Map([[0, [obst]]]));
  const ls = lineasDe(res);
  expect(ls[0]!.x).toBe(50);
  expect(ls[1]!.x).toBeGreaterThanOrEqual(130);
  expect(ls[2]!.x).toBeGreaterThanOrEqual(130);
  expect(ls[3]!.x).toBe(50);
});

test('`topBottom`: el texto salta por debajo de la caja entera (ninguna línea se cruza con ella)', () => {
  const obst: Obstaculo = { xPt: 50, yPt: 270, wPt: 200, hPt: 60, modo: 'topBottom' }; // y 270..330
  const res = paginar([parrafo()], GEO, 0.28, new Map([[0, [obst]]]));
  for (const t of res.trazos) {
    // La línea base está a ~28% del alto sobre el fondo de la línea; el cuerpo de la línea (20 pt) no puede pisar 270..330.
    const fondo = t.yPt - 20 * 0.28;
    const solapa = fondo < 330 && fondo + 20 > 270;
    expect(solapa).toBe(false);
  }
  expect(res.trazos.map((t) => t.text).join(' ').split(' ')).toHaveLength(30);
});

test('un obstáculo de OTRA página no afecta a las líneas de esta', () => {
  const obst: Obstaculo = { xPt: 170, yPt: 290, wPt: 80, hPt: 40, modo: 'square' };
  const res = paginar([parrafo()], GEO, 0.28, new Map([[3, [obst]]]));
  const ls = lineasDe(res);
  expect(ls[1]!.fin).toBeGreaterThan(170);
});

test('un obstáculo que deja menos de 40 pt de hueco a cada lado se trata como `topBottom`', () => {
  const obst: Obstaculo = { xPt: 70, yPt: 290, wPt: 160, hPt: 40, modo: 'square' }; // deja 20 pt a cada lado de 200
  const res = paginar([parrafo()], GEO, 0.28, new Map([[0, [obst]]]));
  for (const t of res.trazos) {
    const fondo = t.yPt - 20 * 0.28;
    expect(fondo < 330 && fondo + 20 > 290).toBe(false);
  }
});

test('una imagen flotante con `ajuste` crea su obstáculo (más sus distancias) y el texto la rodea; la imagen se coloca', () => {
  const items: FlowItem[] = [
    { kind: 'floatImage', imgId: 'i', wPt: 60, hPt: 40, h: { rel: 'margin', align: 'right' }, v: { rel: 'paragraph', offsetPt: 20 },
      ajuste: { modo: 'square', distLPt: 10, distRPt: 4, distTPt: 2, distBPt: 2 } },
    parrafo()
  ];
  const res = paginar(items, GEO, 0.28);
  expect(res.imagenes).toHaveLength(1);
  const img = res.imagenes[0]!;
  expect(img.xPt + img.wPt).toBe(250); // pegada al margen derecho
  const ls = lineasDe(res);
  // Alguna línea queda acortada a la izquierda de la imagen menos su distancia izquierda (10 pt).
  const cortadas = ls.filter((l) => l.fin <= img.xPt - 10 + 0.001);
  expect(cortadas.length).toBeGreaterThanOrEqual(2);
  // Y ninguna línea se mete en la caja ampliada.
  for (const l of ls) {
    const fondo = l.y - 20 * 0.28;
    const cruza = fondo < img.yPt + img.hPt + 2 && fondo + 20 > img.yPt - 2;
    if (cruza) expect(l.fin).toBeLessThanOrEqual(img.xPt - 10 + 0.001);
  }
});

test('una imagen flotante sin `ajuste` no crea obstáculo (el texto no se aparta)', () => {
  const items: FlowItem[] = [
    { kind: 'floatImage', imgId: 'i', wPt: 60, hPt: 40, h: { rel: 'margin', align: 'right' }, v: { rel: 'paragraph', offsetPt: 20 } },
    parrafo()
  ];
  const ls = lineasDe(paginar(items, GEO, 0.28));
  expect(ls.slice(0, 3).every((l) => l.fin > 200)).toBe(true);
});

// ---------------------------------------------------------------------------
// Tabulaciones
// ---------------------------------------------------------------------------

const BASE = { defectoPt: 36, origenPt: 50 };
const stop = (posPt: number, tipo: TabStopAbs['tipo'], leader: TabStopAbs['leader'] = 'none'): TabStopAbs => ({ posPt, tipo, leader });
const textoEn = (segs: { xPt: number; text: string }[], t: string) => segs.find((s) => s.text === t || s.text.startsWith(t))!;

test('tabulación izquierda: el texto siguiente empieza EXACTAMENTE en la posición de la parada', () => {
  const { segs } = lineaConTabs([atomo('Nombre'), tabAtomo(), atomo('valor')], 0, 50, 250, { ...BASE, stops: [stop(150, 'left')] }, medir);
  expect(textoEn(segs, 'Nombre').xPt).toBe(50);
  expect(textoEn(segs, 'valor').xPt).toBe(150);
});

test('tabulación derecha: el texto siguiente TERMINA en la parada', () => {
  const { segs } = lineaConTabs([atomo('Página'), tabAtomo(), atomo('3')], 0, 50, 250, { ...BASE, stops: [stop(250, 'right')] }, medir);
  const tres = textoEn(segs, '3');
  expect(tres.xPt + 6).toBe(250);
});

test('tabulación derecha con varias palabras tras ella: el bloque entero acaba en la parada', () => {
  const { segs } = lineaConTabs([atomo('Pág'), tabAtomo(), atomo('2'), atomo('de'), atomo('9')], 0, 50, 250, { ...BASE, stops: [stop(250, 'right')] }, medir);
  const bloque = segs.filter((s) => s.xPt > 100);
  const fin = Math.max(...bloque.map((s) => s.xPt + medir('', 0, s.text)));
  expect(fin).toBe(250);
});

test('tabulación centrada: el texto queda centrado en la parada', () => {
  const { segs } = lineaConTabs([tabAtomo(), atomo('medio')], 0, 50, 250, { ...BASE, stops: [stop(150, 'center')] }, medir);
  const m = textoEn(segs, 'medio');
  expect(m.xPt + 15).toBe(150); // 5 caracteres * 6 = 30 de ancho
});

test('tabulación decimal: el separador decimal cae en la parada', () => {
  const { segs } = lineaConTabs([tabAtomo(), atomo('12,50')], 0, 50, 250, { ...BASE, stops: [stop(150, 'decimal')] }, medir);
  const n = textoEn(segs, '12,50');
  expect(n.xPt + 2 * 6).toBe(150); // "12" delante de la coma
});

test('líder de puntos: rellena el hueco entre el texto y la parada derecha con puntos y el número acaba en la parada', () => {
  const { segs } = lineaConTabs([atomo('Capítulo'), tabAtomo(), atomo('3')], 0, 50, 250, { ...BASE, stops: [stop(250, 'right', 'dot')] }, medir);
  const puntos = segs.find((s) => /^\.+$/.test(s.text))!;
  expect(puntos).toBeDefined();
  expect(puntos.text.length).toBeGreaterThan(10);
  const fin = puntos.xPt + puntos.text.length * 6;
  const tres = textoEn(segs, '3');
  expect(fin).toBeLessThanOrEqual(tres.xPt + 0.001);
  expect(puntos.xPt).toBeGreaterThanOrEqual(50 + 8 * 6 - 0.001);
  expect(tres.xPt + 6).toBe(250);
});

test('sin paradas propias, una tabulación salta a la siguiente parada por defecto (múltiplo de 36 pt desde el margen)', () => {
  const { segs } = lineaConTabs([atomo('ab'), tabAtomo(), atomo('c')], 0, 50, 250, { ...BASE, stops: [] }, medir);
  expect(textoEn(segs, 'c').xPt).toBe(50 + 36);
});

test('pasada la última parada propia, vuelven las paradas por defecto', () => {
  const { segs } = lineaConTabs([atomo('ab'), tabAtomo(), atomo('c'), tabAtomo(), atomo('d')], 0, 50, 400, { ...BASE, stops: [stop(100, 'left')] }, medir);
  expect(textoEn(segs, 'c').xPt).toBe(100);
  expect(textoEn(segs, 'd').xPt).toBe(50 + 72); // 122: primer múltiplo de 36 desde el margen que supera 106
});

test('una palabra que no cabe tras la tabulación pasa a la línea siguiente (`siguiente` marca dónde sigue)', () => {
  const r = lineaConTabs([atomo('a'), tabAtomo(), atomo('b'), atomo('palabralarguisima')], 0, 50, 140, { ...BASE, stops: [stop(100, 'left')] }, medir);
  expect(r.siguiente).toBe(3);
});

test('el párrafo flexible con tabulación deja el número de página alineado a la derecha en una sola línea', () => {
  const p = parrafoFlex({ atoms: [atomo('Pie'), tabAtomo(), atomo('7')], xNormalPt: 50, xPrimeraPt: 50, wPt: 200, align: 'left', alturaLinea: () => 20, tabs: { ...BASE, stops: [stop(250, 'right')] }, medir });
  const res = paginar([p], GEO, 0.28);
  const siete = res.trazos.find((t) => t.text === '7')!;
  expect(siete.xPt + 6).toBe(250);
  expect(new Set(res.trazos.map((t) => t.yPt)).size).toBe(1);
});

test('colocarZona con un pie de tabulación derecha coloca el número en la parada y cerca del borde inferior', () => {
  const p = parrafoFlex({ atoms: [atomo('Pie'), tabAtomo(), atomo('7')], xNormalPt: 50, xPrimeraPt: 50, wPt: 200, align: 'left', alturaLinea: () => 20, tabs: { ...BASE, stops: [stop(250, 'right')] }, medir });
  const z = colocarZona([p], { widthPt: 300, heightPt: 400 }, 'abajo', 30, 2, 0.28);
  const siete = z.trazos.find((t) => t.text === '7')!;
  expect(siete.page).toBe(2);
  expect(siete.xPt + 6).toBe(250);
  expect(siete.yPt).toBeLessThan(60);
});

test('colocarZona coloca una imagen flotante de la zona respecto a la página real', () => {
  const items: FlowItem[] = [
    { kind: 'floatImage', imgId: 'logo', wPt: 40, hPt: 20, h: { rel: 'page', offsetPt: 10 }, v: { rel: 'page', offsetPt: 5 } },
    linea('x')
  ];
  const z = colocarZona(items, { widthPt: 300, heightPt: 400 }, 'arriba', 20, 0, 0.28, GEO);
  expect(z.imagenes).toHaveLength(1);
  expect(z.imagenes[0]!.xPt).toBe(10);
  expect(z.imagenes[0]!.yPt).toBe(400 - 5 - 20);
});
