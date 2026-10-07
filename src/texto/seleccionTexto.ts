import type { CharBox } from '../engine/PdfEngine';
import type { PageGeometry } from '../coords/PageGeometry';
import { puntoEnQuad, quadsPorLinea, rectToQuad, type QuadPt } from '../coords/quads';

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
  const cerrar = (): void => { const b: [number, number] = [top, bottom]; for (const i of grupo) out[i] = b; grupo = []; }; // misma referencia = misma línea
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

// ---------------------------------------------------------------------------------------------
// Selección por TECLADO (T16). Un "caret" es una posición ENTRE caracteres: el caret `c` está justo
// antes de `chars[c]` (0 = inicio del texto, `chars.length` = final). Con Mayús+flecha se mueve el
// FOCO (un caret) y el ANCLA (otro caret) se queda quieta; los caracteres seleccionados son los que
// quedan entre ambos. El modelo guardado sigue siendo el de T12 (índices de carácter inclusivos,
// `Seleccion.ancla`/`foco`); estas funciones convierten de un modelo al otro.
// ---------------------------------------------------------------------------------------------

/** Caracteres [ancla, foco] (inclusive, en cualquier orden) → carets (ancla, foco). */
export function rangoACarets(r: { ancla: number; foco: number }): { ancla: number; foco: number } {
  return r.ancla <= r.foco ? { ancla: r.ancla, foco: r.foco + 1 } : { ancla: r.ancla + 1, foco: r.foco };
}

/** Carets (ancla, foco) → caracteres seleccionados (inclusive); `null` si coinciden (selección vacía). */
export function caretsARango(ancla: number, foco: number): { ancla: number; foco: number } | null {
  if (ancla === foco) return null;
  return foco > ancla ? { ancla, foco: foco - 1 } : { ancla: ancla - 1, foco };
}

/**
 * Caret tras mover el foco UN carácter. Los caracteres sin caja (\r\n entre líneas) se atraviesan
 * sin detenerse: una pulsación siempre mueve el foco sobre un carácter visible. Al final/inicio del
 * texto no se mueve.
 */
export function caretSiguiente(chars: readonly CharBox[], caret: number, dir: 1 | -1): number {
  if (dir > 0) {
    let j = caret;
    while (j < chars.length && !tieneCaja(chars[j]!)) j++;
    return j >= chars.length ? caret : j + 1;
  }
  let j = caret - 1;
  if (j >= 0 && tieneCaja(chars[j]!)) return j;
  while (j >= 0 && !tieneCaja(chars[j]!)) j--;
  return j < 0 ? caret : j + 1; // justo detrás del último carácter visible anterior
}

/**
 * Caret tras mover el foco UNA línea visual arriba (`dir` -1) o abajo (+1) conservando la columna
 * (x visual en px CSS). Sin línea siguiente/anterior va al final/inicio del texto, como un campo de
 * texto. La agrupación en líneas es la de `bandasDeLinea` (espacio visual, E-053), y `geo` es la
 * geometría a escala 1 (px CSS = pt visuales).
 */
export function caretLinea(chars: readonly CharBox[], caret: number, dir: 1 | -1, geo: PageGeometry): number {
  const banda = bandasDeLinea(chars, geo);
  const idxCaja: number[] = [];
  chars.forEach((c, i) => { if (tieneCaja(c)) idxCaja.push(i); });
  if (idxCaja.length === 0) return caret;
  // Líneas: caracteres con caja consecutivos que comparten la misma banda (misma referencia).
  const lineas: number[][] = [];
  for (const i of idxCaja) {
    const ult = lineas[lineas.length - 1];
    if (ult && banda[ult[0]!] === banda[i]) ult.push(i); else lineas.push([i]);
  }
  const izq = (i: number): number => geo.rectPtToCss(chars[i]!.boxPt).left;
  const der = (i: number): number => { const r = geo.rectPtToCss(chars[i]!.boxPt); return r.left + r.width; };
  // Carácter de referencia del caret: el que tiene justo delante; si no hay (fin de línea), el de detrás.
  let x: number, linea: number;
  if (caret < chars.length && tieneCaja(chars[caret]!)) {
    x = izq(caret);
    linea = lineas.findIndex((l) => l.includes(caret));
  } else {
    let k = caret - 1;
    while (k >= 0 && !tieneCaja(chars[k]!)) k--;
    if (k < 0) return caret;
    x = der(k);
    linea = lineas.findIndex((l) => l.includes(k));
  }
  const destino = linea + dir;
  if (destino < 0) return idxCaja[0]!;
  if (destino >= lineas.length) return idxCaja[idxCaja.length - 1]! + 1;
  const l = lineas[destino]!;
  let mejor = l[0]!, mejorD = Math.abs(izq(l[0]!) - x);
  for (const i of l) {
    const d = Math.abs(izq(i) - x);
    if (d < mejorD) { mejorD = d; mejor = i; }
  }
  const fin = l[l.length - 1]! + 1;
  if (Math.abs(der(fin - 1) - x) < mejorD) mejor = fin;
  return mejor;
}

/**
 * Caret al `inicio` o al `final` de la línea cuya caja es `caja` (pt de usuario): el primer/último
 * carácter con caja cuyo centro cae dentro. `-1` si ninguno (la línea no tiene caracteres con caja).
 */
export function caretInicioDe(chars: readonly CharBox[], caja: { xPt: number; yPt: number; wPt: number; hPt: number }, donde: 'inicio' | 'final'): number {
  const dentro = (c: CharBox): boolean => {
    const cx = c.boxPt.xPt + c.boxPt.wPt / 2, cy = c.boxPt.yPt + c.boxPt.hPt / 2;
    return cx >= caja.xPt - 0.5 && cx <= caja.xPt + caja.wPt + 0.5 && cy >= caja.yPt - 0.5 && cy <= caja.yPt + caja.hPt + 0.5;
  };
  let primero = -1, ultimo = -1;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (!tieneCaja(c) || !dentro(c)) continue;
    if (primero < 0) primero = i;
    ultimo = i;
  }
  if (primero < 0) return -1;
  return donde === 'inicio' ? primero : ultimo + 1;
}

/**
 * Texto bajo una anotación de marcado: los caracteres cuyo centro (pt de usuario) cae dentro de alguno de sus quads.
 * B3: entre dos líneas se une con UN espacio. PDFium separa las líneas con CR+LF sin caja (que aquí se saltan) y,
 * en algunos PDF, ni eso: por eso también separa un salto vertical mayor que una línea entre dos caracteres
 * consecutivos. Los blancos se normalizan (`\s+` → un espacio) porque el resultado se anuncia y se muestra en una línea.
 */
export function textoDeMarcado(chars: readonly CharBox[], hit: { quads: readonly QuadPt[]; rectPt: { xPt: number; yPt: number; wPt: number; hPt: number } }): string {
  const quads = hit.quads.length > 0 ? hit.quads : [rectToQuad(hit.rectPt)];
  let s = '';
  let separar = false;
  let previo: CharBox | null = null;
  for (const c of chars) {
    if (!tieneCaja(c)) {
      if (/\s/.test(c.ch)) separar = true; // CR, LF o espacio sin caja entre líneas
      continue;
    }
    const cx = c.boxPt.xPt + c.boxPt.wPt / 2, cy = c.boxPt.yPt + c.boxPt.hPt / 2;
    if (!quads.some((q) => puntoEnQuad(cx, cy, q))) continue;
    if (previo) {
      const pcy = previo.boxPt.yPt + previo.boxPt.hPt / 2; // pt de usuario, mismo espacio que cy
      if (separar || Math.abs(cy - pcy) > Math.max(previo.boxPt.hPt, c.boxPt.hPt)) s += ' ';
    }
    separar = false;
    s += c.ch;
    previo = c;
  }
  return s.replace(/\s+/g, ' ').trim();
}
