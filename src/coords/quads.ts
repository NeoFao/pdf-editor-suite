import type { RectPt } from '../engine/PdfEngine';
import type { PageGeometry } from './PageGeometry';

/**
 * Un QuadPoints de anotación: 4 esquinas (x1,y1 .. x4,y4), en PUNTOS PDF de
 * espacio de usuario (origen abajo-izquierda, Y arriba, SIN girar), en el orden
 * que usa Acrobat: sup-izq, sup-der, inf-izq, inf-der.
 */
export type QuadPt = readonly [number, number, number, number, number, number, number, number];

/** Rectángulo en pt de usuario → quad (sup-izq, sup-der, inf-izq, inf-der). */
export function rectToQuad(r: RectPt): QuadPt {
  const l = r.xPt, rr = r.xPt + r.wPt, b = r.yPt, t = r.yPt + r.hPt;
  return [l, t, rr, t, l, b, rr, b];
}

/** Una caja de texto a marcar: `boxPt` en pt de usuario; `sizePt` es el cuerpo de la fuente (pt). */
export interface CajaMarcable { boxPt: RectPt; sizePt: number }

interface Banda { left: number; top: number; right: number; bottom: number } // px CSS visuales (escala 1)

/**
 * Quads de un marcado: UNO POR LÍNEA VISUAL, no una caja gorda.
 *
 * Trabaja en el espacio visual (px CSS con escala 1 = pt visuales, ya girado por
 * /Rotate vía `geo`, E-053): ahí el texto es horizontal aunque en el espacio de
 * usuario esté girado. Pasos: (1) una caja mucho más alta que su cuerpo es
 * multilínea y se parte en bandas; (2) las bandas que comparten línea (solapan
 * más de la mitad de su alto) se funden en una; (3) cada línea vuelve a pt de
 * usuario con `cssToPt` y se emite como quad.
 *
 * `geo` debe tener `scale === 1`.
 */
export function quadsPorLinea(cajas: readonly CajaMarcable[], geo: PageGeometry): QuadPt[] {
  const bandas: Banda[] = [];
  for (const c of cajas) {
    const r = geo.rectPtToCss(c.boxPt);
    const alto = r.height;
    const cuerpo = Math.max(1, c.sizePt);
    const n = alto > cuerpo * 1.7 ? Math.max(2, Math.round(alto / (cuerpo * 1.2))) : 1;
    for (let i = 0; i < n; i++) {
      bandas.push({ left: r.left, right: r.left + r.width, top: r.top + (alto * i) / n, bottom: r.top + (alto * (i + 1)) / n });
    }
  }
  bandas.sort((a, b) => a.top - b.top || a.left - b.left);

  const lineas: Banda[] = [];
  for (const b of bandas) {
    const l = lineas.find((x) => {
      const solape = Math.min(x.bottom, b.bottom) - Math.max(x.top, b.top);
      return solape > 0.5 * Math.min(x.bottom - x.top, b.bottom - b.top);
    });
    if (l) {
      l.left = Math.min(l.left, b.left); l.right = Math.max(l.right, b.right);
      l.top = Math.min(l.top, b.top); l.bottom = Math.max(l.bottom, b.bottom);
    } else lineas.push({ ...b });
  }
  lineas.sort((a, b) => a.top - b.top);

  return lineas.map((l) => {
    const si = geo.cssToPt(l.left, l.top);      // visual sup-izq
    const sd = geo.cssToPt(l.right, l.top);     // visual sup-der
    const ii = geo.cssToPt(l.left, l.bottom);   // visual inf-izq
    const id = geo.cssToPt(l.right, l.bottom);  // visual inf-der
    return [si.xPt, si.yPt, sd.xPt, sd.yPt, ii.xPt, ii.yPt, id.xPt, id.yPt] as const;
  });
}

/**
 * ¿El punto (x, y) cae dentro del quad? TODO en pt PDF de usuario (Y arriba, sin
 * girar: el punto sale de `geom.cssToPt`, que ya deshace /Rotate, E-053).
 *
 * No supone un orden de vértices (Acrobat escribe sup-izq, sup-der, inf-izq,
 * inf-der pero otros productores usan el orden cíclico) ni que el quad esté
 * alineado con los ejes (texto girado): se ordenan las 4 esquinas por ángulo
 * alrededor del centroide y se comprueba que el punto queda del mismo lado de
 * las 4 aristas. Un quad degenerado (área 0) no contiene ningún punto.
 */
export function puntoEnQuad(x: number, y: number, q: QuadPt): boolean {
  const v = [0, 2, 4, 6].map((k) => ({ x: q[k]!, y: q[k + 1]! }));
  const cx = (v[0]!.x + v[1]!.x + v[2]!.x + v[3]!.x) / 4;
  const cy = (v[0]!.y + v[1]!.y + v[2]!.y + v[3]!.y) / 4;
  v.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let area2 = 0;
  for (let i = 0; i < 4; i++) { const a = v[i]!, b = v[(i + 1) % 4]!; area2 += a.x * b.y - b.x * a.y; }
  if (Math.abs(area2) < 1e-9) return false;
  const eps = 1e-6 * Math.sqrt(Math.abs(area2));
  let positivos = 0, negativos = 0;
  for (let i = 0; i < 4; i++) {
    const a = v[i]!, b = v[(i + 1) % 4]!;
    const cruz = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cruz > eps) positivos++; else if (cruz < -eps) negativos++;
  }
  return positivos === 0 || negativos === 0;
}

/** Lo que `marcadoBajoPunto` necesita de una anotación de la página. */
export interface MarcadoHit {
  index: number;
  kind: 'note' | 'highlight' | 'underline' | 'strikeout';
  /** QuadPoints (pt de usuario); vacío en una nota. */
  quads: readonly QuadPt[];
  rectPt: RectPt;
}

/**
 * La anotación de marcado (resaltado, subrayado, tachado) o nota bajo el punto
 * (pt de usuario), o `null`. Un marcado se acierta con SUS QUADS (un subrayado de
 * dos líneas no responde en el hueco entre ellas, que sí está dentro de su /Rect);
 * una nota, con su /Rect. Si varias coinciden gana la de mayor índice (la última
 * dibujada, la de encima).
 */
export function marcadoBajoPunto<T extends MarcadoHit>(items: readonly T[], xPt: number, yPt: number): T | null {
  let mejor: T | null = null;
  for (const it of items) {
    const dentro = it.kind === 'note' || it.quads.length === 0
      ? xPt >= it.rectPt.xPt && xPt <= it.rectPt.xPt + it.rectPt.wPt && yPt >= it.rectPt.yPt && yPt <= it.rectPt.yPt + it.rectPt.hPt
      : it.quads.some((q) => puntoEnQuad(xPt, yPt, q));
    if (dentro && (!mejor || it.index > mejor.index)) mejor = it;
  }
  return mejor;
}
