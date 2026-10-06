import type { RectPt, TextRun } from '../engine/PdfEngine';

/**
 * «Líneas editables» (N1): agrupa los objetos de texto de una página en las líneas que ve el usuario.
 *
 * Chrome/Skia escriben UN `Tj` por glifo y PDFium crea UN objeto de texto por `Tj`: una línea visual son decenas de
 * objetos de 1-2 caracteres. Este módulo PURO (sin DOM ni motor) reconstruye la línea a partir de los `TextRun`
 * (con matriz, avance y texto real). Criterios medidos en el diseño (`.orquestacion/N1-diseno.md` §2.2):
 *
 *  1. Segmentos contiguos EN EL ORDEN DEL CONTENT STREAM: el objeto `b` continúa el segmento de `a` si tienen la misma
 *     dirección y escala (C1), la misma visibilidad (C2), la misma línea base (C3, o regla de índice C3′) y un salto
 *     horizontal pequeño (C4). Las columnas y las celdas comparten línea base y su hueco (0,6-0,8 em) es del orden del
 *     espacio de justificación (0,3-0,6 em): un umbral de hueco solo no basta, lo que las separa es que Chrome escribe una
 *     columna entera y después la otra.
 *  2. Fusión de segmentos NO contiguos (escritores que emiten la negrita al final): C1-C3 y un hueco de −0,1 a 0,5 em.
 *  3. Dentro de la línea, el orden visual es por `u` (a lo largo del texto).
 *
 * Unidades: pt de página SIN girar (las de PDFium). `u` = coordenada a lo largo del texto, `v` = perpendicular (línea
 * base), ambas en pt, en el marco de la dirección del objeto (θ = atan2(b, a) de su matriz). «em» = tamaño EFECTIVO
 * del objeto, `Tf × hypot(a, b)`, en pt (E-080).
 */

/** Dirección compatible: diferencia máxima de ángulo (grados) entre dos objetos de la misma línea. */
export const ANGULO_MAX_GRADOS = 1;
/** Escala compatible: diferencia máxima relativa de `hypot(a, b)` (fracción de la escala del primero). */
export const ESCALA_REL_MAX = 0.01;
/** Misma línea base: diferencia máxima de `v` (en em del mayor de los dos). Absorbe el redondeo de Chrome (≤ 0,01 em). */
export const BASE_MAX_EM = 0.2;
/** Super/subíndice: fracción mínima de su franja [v−0,25 em, v+0,75 em] que debe solapar con la de la línea. */
export const INDICE_SOLAPE_MIN = 0.5;
/** Salto horizontal máximo (em) entre dos objetos de la misma línea si el anterior NO acaba en espacio. */
export const SALTO_MAX_EM = 0.6;
/** Salto horizontal máximo (em) si el anterior acaba en un espacio real (justificación). */
export const SALTO_TRAS_ESPACIO_MAX_EM = 2.0;
/** Salto horizontal mínimo (em): solape tolerado entre objetos consecutivos (kerning, cursiva). */
export const SALTO_MIN_EM = -0.5;
/** Fusión de segmentos no contiguos: hueco máximo (em); menor que la columna más estrecha medida (0,77 em). */
export const FUSION_MAX_EM = 0.5;
/** Fusión de segmentos no contiguos: solape máximo tolerado (em). */
export const FUSION_MIN_EM = -0.1;
/** Modo de render de texto invisible (capa OCR): no se mezcla con texto visible. */
const RENDER_INVISIBLE = 3;

/** Un tramo de la línea que viene de un solo objeto de texto: `[inicio, fin)` son índices sobre `LineaEditable.text`. */
export interface TramoObjeto { runId: number; inicio: number; fin: number }

/** Un tramo de estilo uniforme (misma fuente, tamaño efectivo y color): `[inicio, fin)` sobre `LineaEditable.text`. */
export interface TramoEstilo {
  inicio: number;
  fin: number;
  fontName: string;
  /** Tamaño EFECTIVO en pt (E-080). */
  sizeEfectivoPt: number;
  color: [number, number, number, number];
}

export interface LineaEditable {
  /** `${pageIndex}:${runIds[0]}`: estable hasta el siguiente `refreshPage`. */
  lineaId: string;
  /** `runId` de los objetos en ORDEN VISUAL (`u` creciente). */
  runIds: number[];
  /** Mapa carácter → objeto. Un espacio que PDFium genera entre dos objetos no pertenece a ninguno. */
  tramos: TramoObjeto[];
  /** Tramos de estilo uniforme, en orden. */
  estilos: TramoEstilo[];
  /** Texto real de la línea; los espacios que PDFium genera entre objetos entran como ' '. */
  text: string;
  /** Unión de las cajas ORIGINALES de los objetos con caja (máscara de E-002), en pt. */
  boxPt: RectPt;
  /** Origen de la línea base del primer objeto (E-030), en pt. */
  originPt: { xPt: number; yPt: number };
  /** Dirección de la línea, grados antihorarios 0..359 (E-063). */
  anguloDeg: number;
}

/** Objeto de texto ya medido en el marco de su propia dirección. */
interface Obj {
  run: TextRun;
  texto: string;
  em: number;
  /** θ en grados. */
  ang: number;
  /** hypot(a, b). */
  escala: number;
  u: number;
  v: number;
  uFin: number;
  invisible: boolean;
}

function medir(run: TextRun): Obj {
  const [a, b, , , e, f] = run.matriz;
  const theta = Math.atan2(b, a);
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const u = e * cos + f * sin;
  return {
    run,
    texto: run.textoReal,
    em: run.sizeEfectivoPt,
    ang: (theta * 180) / Math.PI,
    escala: Math.hypot(a, b),
    u,
    v: -e * sin + f * cos,
    uFin: u + run.avancePt,
    invisible: run.renderMode === RENDER_INVISIBLE
  };
}

/** Diferencia angular en grados, módulo 360. */
function difAngulo(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** C1 + C2: misma dirección, misma escala y misma visibilidad. */
function compatibles(a: Obj, b: Obj): boolean {
  return difAngulo(a.ang, b.ang) <= ANGULO_MAX_GRADOS
    && Math.abs(a.escala - b.escala) <= ESCALA_REL_MAX * a.escala
    && a.invisible === b.invisible;
}

/** Franja vertical (en v, pt) que ocupa un objeto de cuerpo `em` con la línea base en `v`. */
function franja(v: number, em: number): [number, number] {
  return [v - 0.25 * em, v + 0.75 * em];
}

/** C3 / C3′: `b` está en la línea base de `ref` (el primer objeto del segmento) o es un super/subíndice de ella. */
function mismaBase(ref: Obj, emMax: number, b: Obj): boolean {
  if (Math.abs(ref.v - b.v) <= BASE_MAX_EM * Math.max(emMax, b.em)) return true;
  if (b.em >= ref.em) return false;
  const [b0, b1] = franja(b.v, b.em);
  const [l0, l1] = franja(ref.v, ref.em);
  return Math.min(b1, l1) - Math.max(b0, l0) >= INDICE_SOLAPE_MIN * (b1 - b0);
}

/** Salto horizontal de `a` a `b`, en em del mayor de los dos. */
function salto(a: Obj, b: Obj): number {
  const em = Math.max(a.em, b.em);
  return em > 0 ? (b.u - a.uFin) / em : Infinity;
}

interface Segmento {
  objs: Obj[];
  /** Mayor em visto hasta ahora (para C3). */
  emMax: number;
}

function nuevoSegmento(o: Obj): Segmento {
  return { objs: [o], emMax: o.em };
}

/** El objeto del segmento que acaba más a la derecha y el que empieza más a la izquierda. */
function extremos(s: Segmento): { ultimo: Obj; primero: Obj } {
  let ultimo = s.objs[0]!, primero = s.objs[0]!;
  for (const o of s.objs) {
    if (o.uFin > ultimo.uFin) ultimo = o;
    if (o.u < primero.u) primero = o;
  }
  return { ultimo, primero };
}

function continuaSegmento(s: Segmento, o: Obj): boolean {
  const a = s.objs[s.objs.length - 1]!;
  if (!compatibles(a, o) || !mismaBase(s.objs[0]!, s.emMax, o)) return false;
  const j = salto(a, o);
  return j >= SALTO_MIN_EM && j <= (/\s$/.test(a.texto) ? SALTO_TRAS_ESPACIO_MAX_EM : SALTO_MAX_EM);
}

/** Une los rectángulos con área; si ninguno la tiene, devuelve el del primero. */
function unirCajas(runs: TextRun[]): RectPt {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of runs) {
    const b = r.boxPt;
    if (!(b.wPt > 0) || !(b.hPt > 0)) continue;
    x0 = Math.min(x0, b.xPt); y0 = Math.min(y0, b.yPt);
    x1 = Math.max(x1, b.xPt + b.wPt); y1 = Math.max(y1, b.yPt + b.hPt);
  }
  if (!Number.isFinite(x0)) return { ...runs[0]!.boxPt };
  return { xPt: x0, yPt: y0, wPt: x1 - x0, hPt: y1 - y0 };
}

function mismoColor(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function construirLinea(objs: Obj[], pageIndex: number): LineaEditable {
  const ordenados = objs.slice().sort((x, y) => x.u - y.u);
  const runIds: number[] = [];
  const tramos: TramoObjeto[] = [];
  const estilos: TramoEstilo[] = [];
  let text = '';
  for (const o of ordenados) {
    if (o.run.espacioVirtualAntes && text !== '' && !/\s$/.test(text) && !/^\s/.test(o.texto)) text += ' ';
    const inicio = text.length;
    text += o.texto;
    runIds.push(o.run.runId);
    tramos.push({ runId: o.run.runId, inicio, fin: text.length });
    const ultimo = estilos[estilos.length - 1];
    if (ultimo && ultimo.fontName === o.run.fontName && ultimo.sizeEfectivoPt === o.run.sizeEfectivoPt && mismoColor(ultimo.color, o.run.color)) {
      ultimo.fin = text.length;
    } else {
      estilos.push({ inicio, fin: text.length, fontName: o.run.fontName, sizeEfectivoPt: o.run.sizeEfectivoPt, color: o.run.color });
    }
  }
  const primero = ordenados[0]!.run;
  const anguloDeg = primero.anguloDeg ?? (((Math.round(ordenados[0]!.ang) % 360) + 360) % 360);
  return {
    lineaId: `${pageIndex}:${runIds[0]}`,
    runIds,
    tramos,
    estilos,
    text,
    boxPt: unirCajas(ordenados.map((o) => o.run)),
    originPt: { ...primero.originPt },
    anguloDeg
  };
}

/**
 * Agrupa los objetos de texto de una página en líneas editables. `runs` son los `TextRun` de `getPageText` (su
 * `runId` es el índice del objeto, así que el orden de `runId` es el del content stream). Los objetos sin texto real
 * se ignoran. El resultado sale en el orden del content stream de la primera pieza de cada línea.
 */
export function agruparLineasEditables(runs: TextRun[], pageIndex = 0): LineaEditable[] {
  const objs = runs
    .filter((r) => r.textoReal !== '')
    .slice()
    .sort((a, b) => a.runId - b.runId)
    .map(medir);

  // Paso 1: segmentos contiguos en el orden del content stream.
  const segs: Segmento[] = [];
  let actual: Segmento | null = null;
  for (const o of objs) {
    if (actual && continuaSegmento(actual, o)) {
      actual.objs.push(o);
      actual.emMax = Math.max(actual.emMax, o.em);
    } else {
      actual = nuevoSegmento(o);
      segs.push(actual);
    }
  }

  // Paso 2: fusión de segmentos no contiguos. Un barrido por segmento; tras cada fusión se vuelve a mirar el mismo.
  for (let i = 0; i < segs.length; i++) {
    let cambio = true;
    while (cambio) {
      cambio = false;
      const A = segs[i]!;
      const { ultimo } = extremos(A);
      for (let j = 0; j < segs.length; j++) {
        if (j === i) continue;
        const B = segs[j]!;
        const { primero } = extremos(B);
        if (!compatibles(ultimo, primero) || !mismaBase(A.objs[0]!, Math.max(A.emMax, B.emMax), primero)) continue;
        const h = salto(ultimo, primero);
        if (h < FUSION_MIN_EM || h > FUSION_MAX_EM) continue;
        A.objs = A.objs.concat(B.objs);
        A.emMax = Math.max(A.emMax, B.emMax);
        segs.splice(j, 1);
        if (j < i) i--;
        cambio = true;
        break;
      }
    }
  }

  // Paso 3: orden visual y mapa.
  return segs.map((s) => construirLinea(s.objs, pageIndex));
}

/** La línea editable que contiene el objeto `runId` (cualquiera de sus objetos), o `null` si ese objeto no tiene texto real. */
export function lineaDeRun(runs: TextRun[], pageIndex: number, runId: number): LineaEditable | null {
  return agruparLineasEditables(runs, pageIndex).find((l) => l.runIds.includes(runId)) ?? null;
}
