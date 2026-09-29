import type { RectPt } from '../engine/PdfEngine';

/** Segmento recto entre dos puntos, en las mismas unidades que las llamadas (esta app siempre lo usa en puntos PDF). */
export interface Segment { ax: number; ay: number; bx: number; by: number }

/** Un path candidato del borrador: su objIndex en el motor y las aristas de su contorno. */
export interface PathCandidate { objIndex: number; segments: Segment[] }

/**
 * Distancia mínima de un punto a un segmento (no a la recta que lo contiene):
 * proyecta el punto sobre el segmento y recorta el parámetro a [0,1], así que
 * un punto "más allá" de un extremo usa la distancia a ese extremo, no a la
 * prolongación infinita de la recta. Segmento degenerado (A === B): distancia
 * al punto.
 */
export function distanciaPuntoSegmento(px: number, py: number, seg: Segment): number {
  const dx = seg.bx - seg.ax, dy = seg.by - seg.ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - seg.ax, py - seg.ay);
  let t = ((px - seg.ax) * dx + (py - seg.ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = seg.ax + t * dx, cy = seg.ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Elige, de entre varios paths candidatos, el que tiene la arista más
 * cercana al punto — nunca por caja envolvente. Si la distancia a la arista
 * más cercana de TODOS los paths supera `maxDist`, no hay candidato: `null`.
 * Así un clic en el hueco interior de un rectángulo grande no encuentra nada
 * (todas sus aristas quedan lejos), aunque el punto caiga dentro de su caja.
 */
export function pathMasCercano(px: number, py: number, paths: PathCandidate[], maxDist: number): number | null {
  let mejor: { objIndex: number; dist: number } | null = null;
  for (const path of paths) {
    let distPath = Infinity;
    for (const seg of path.segments) {
      const d = distanciaPuntoSegmento(px, py, seg);
      if (d < distPath) distPath = d;
    }
    if (distPath <= maxDist && (!mejor || distPath < mejor.dist)) mejor = { objIndex: path.objIndex, dist: distPath };
  }
  return mejor ? mejor.objIndex : null;
}

/**
 * Normaliza dos esquinas de un arrastre (en cualquier dirección/orden) a un
 * `RectPt` con `wPt`/`hPt` siempre positivos y `(xPt, yPt)` la esquina
 * mínima. Unidades: las que traigan `x0..y1` (esta app siempre llama con
 * puntos PDF).
 */
export function normalizeRect(x0: number, y0: number, x1: number, y1: number): RectPt {
  return {
    xPt: Math.min(x0, x1),
    yPt: Math.min(y0, y1),
    wPt: Math.abs(x1 - x0),
    hPt: Math.abs(y1 - y0)
  };
}
