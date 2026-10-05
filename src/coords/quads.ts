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
