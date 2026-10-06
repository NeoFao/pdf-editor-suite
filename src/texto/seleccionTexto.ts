import type { CharBox } from '../engine/PdfEngine';
import type { PageGeometry } from '../coords/PageGeometry';
import { quadsPorLinea, type QuadPt } from '../coords/quads';

/**
 * Selección de texto por carácter (T12). Funciones PURAS: no tocan el DOM ni el
 * motor. Todas las cajas y puntos están en PUNTOS PDF de espacio de usuario
 * (origen abajo-izquierda, SIN girar), el mismo espacio que `boxPt`; la
 * rotación de página solo interviene en `quadsDeRango`, y siempre a través de
 * `PageGeometry` (E-053).
 *
 * Un "carácter con caja" es el que tiene ancho y alto > 0; los saltos de línea
 * (\r, \n) que PDFium genera entre líneas no tienen caja y solo cuentan para el
 * texto copiado, no para apuntar ni para marcar.
 */
const tieneCaja = (c: CharBox): boolean => c.boxPt.wPt > 0 && c.boxPt.hPt > 0;

/**
 * Índice del carácter con caja más cercano al punto (pt PDF). Distancia
 * euclídea del punto al rectángulo (0 si está dentro): un punto a la derecha de
 * una línea elige su último carácter, uno debajo del texto elige el de la última
 * línea. `-1` si no hay ningún carácter con caja.
 */
export function indiceCaracterMasCercano(chars: readonly CharBox[], xPt: number, yPt: number): number {
  let mejor = -1;
  let mejorD = Infinity;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (!tieneCaja(c)) continue;
    const { xPt: x, yPt: y, wPt: w, hPt: h } = c.boxPt;
    const dx = xPt < x ? x - xPt : xPt > x + w ? xPt - (x + w) : 0;
    const dy = yPt < y ? y - yPt : yPt > y + h ? yPt - (y + h) : 0;
    const d = dx * dx + dy * dy;
    if (d < mejorD) { mejorD = d; mejor = i; }
  }
  return mejor;
}

/**
 * Quads de un rango de caracteres [a, b] (inclusive, en cualquier orden): UNO
 * POR LÍNEA VISUAL, recortados al tramo. Cada carácter con caja se entrega a
 * `quadsPorLinea` (que agrupa por línea visual en el espacio ya girado, E-053);
 * su `sizePt` es su propio alto VISUAL, así que nunca se trocea como multilínea.
 */
export function quadsDeRango(chars: readonly CharBox[], a: number, b: number, geo: PageGeometry): QuadPt[] {
  const desde = Math.max(0, Math.min(a, b)), hasta = Math.min(chars.length - 1, Math.max(a, b));
  const banda = bandasDeLinea(chars, geo);
  const cajas = [];
  for (let i = desde; i <= hasta; i++) {
    const c = chars[i]!;
    if (!tieneCaja(c)) continue;
    // Horizontal: la del propio carácter (recorte exacto). Vertical: la de su LÍNEA entera,
    // porque la caja de un glifo depende de su forma ("a" baja, "l" alta) y un marcado
    // debe tener la altura de la línea, no la del glifo.
    const r = geo.rectPtToCss(c.boxPt);
    const [top, bottom] = banda[i]!;
    const p = geo.cssToPt(r.left, top), q = geo.cssToPt(r.left + r.width, bottom);
    cajas.push({
      boxPt: { xPt: Math.min(p.xPt, q.xPt), yPt: Math.min(p.yPt, q.yPt), wPt: Math.abs(q.xPt - p.xPt), hPt: Math.abs(q.yPt - p.yPt) },
      sizePt: bottom - top
    });
  }
  return quadsPorLinea(cajas, geo);
}

/**
 * Para cada carácter con caja: [top, bottom] en px CSS visuales de su línea,
 * es decir, la envolvente vertical de los caracteres consecutivos (en orden de
 * lectura) que solapan con ella más de la mitad del alto del menor. En espacio
 * visual (ya girado, E-053) el texto es horizontal aunque la página esté girada.
 */
function bandasDeLinea(chars: readonly CharBox[], geo: PageGeometry): ([number, number] | undefined)[] {
  const out: ([number, number] | undefined)[] = new Array(chars.length);
  let grupo: number[] = [];
  let top = 0, bottom = 0;
  const cerrar = (): void => { for (const i of grupo) out[i] = [top, bottom]; grupo = []; };
  chars.forEach((c, i) => {
    if (!tieneCaja(c)) return;
    const r = geo.rectPtToCss(c.boxPt);
    const t = r.top, bo = r.top + r.height;
    if (grupo.length > 0) {
      const solape = Math.min(bottom, bo) - Math.max(top, t);
      if (solape > 0.5 * Math.min(bottom - top, bo - t)) { top = Math.min(top, t); bottom = Math.max(bottom, bo); grupo.push(i); return; }
      cerrar();
    }
    top = t; bottom = bo; grupo = [i];
  });
  cerrar();
  return out;
}

/** Texto del rango [a, b] (inclusive), con los saltos de línea de PDFium (\r\n) normalizados a \n. */
export function textoDeRango(chars: readonly CharBox[], a: number, b: number): string {
  const desde = Math.max(0, Math.min(a, b)), hasta = Math.min(chars.length - 1, Math.max(a, b));
  let s = '';
  for (let i = desde; i <= hasta; i++) s += chars[i]!.ch;
  return s.replace(/\r\n?/g, '\n');
}
