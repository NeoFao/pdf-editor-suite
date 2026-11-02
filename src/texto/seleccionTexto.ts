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
export const tieneCaja = (c: CharBox): boolean => c.boxPt.wPt > 0 && c.boxPt.hPt > 0;

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
 * Orden de lectura de los caracteres de una página (E-122). En una página con `/Rotate 90` PDFium entrega las
 * LÍNEAS en orden inverso (la última de abajo primero: L4, L3, L2, L1, cada una por dentro en su orden) porque
 * ordena el texto en el espacio girado, donde el texto normal queda vertical. Con 0, 180 y 270 el orden ya es
 * el natural. La selección, la copia y el marcado trabajan con rangos de ÍNDICES, así que con ese orden un
 * arrastre de la línea 1 a la 3 seleccionaba el tramo complementario (cola de la 3, la 2, cabeza de la 1).
 *
 * Solo se actúa si (a) la página está girada 90, (b) todas las líneas (bloques separados por saltos de línea sin
 * caja) son horizontales en el espacio de usuario (texto contragirado, que PDFium ya ordena bien, no se toca) y
 * (c) el primer bloque queda DEBAJO del último (el orden ya natural no se toca). Entonces se invierte el orden de
 * los bloques, no el de los caracteres dentro de cada uno. Pura: devuelve el mismo array si no hay nada que hacer.
 */
export function ordenLecturaCaracteres(chars: CharBox[], rotation: 0 | 90 | 180 | 270): CharBox[] {
  if (rotation !== 90) return chars;
  const esSalto = (c: CharBox): boolean => !tieneCaja(c) && /[\r\n]/.test(c.ch);
  const bloques: CharBox[][] = [[]];
  let separador: CharBox[] | null = null; // el primer grupo de saltos (p. ej. \r\n) que aparezca
  let capturando = false, enSalto = false;
  for (const c of chars) {
    if (esSalto(c)) {
      if (!enSalto) { bloques.push([]); capturando = separador === null; if (capturando) separador = []; }
      if (capturando) separador!.push(c);
      enSalto = true;
    } else { enSalto = false; capturando = false; bloques[bloques.length - 1]!.push(c); }
  }
  const llenos = bloques.filter((b) => b.some(tieneCaja));
  if (llenos.length < 2) return chars;
  const caja = (b: CharBox[]): { x0: number; x1: number; y0: number; y1: number } => {
    const bs = b.filter(tieneCaja).map((c) => c.boxPt);
    return { x0: Math.min(...bs.map((r) => r.xPt)), x1: Math.max(...bs.map((r) => r.xPt + r.wPt)), y0: Math.min(...bs.map((r) => r.yPt)), y1: Math.max(...bs.map((r) => r.yPt + r.hPt)) };
  };
  const cajas = llenos.map(caja);
  // (b) alguna línea de varios caracteres más alta que ancha en el espacio de usuario: escritura vertical, no se toca.
  if (llenos.some((b, i) => b.filter(tieneCaja).length > 1 && cajas[i]!.x1 - cajas[i]!.x0 < cajas[i]!.y1 - cajas[i]!.y0)) return chars;
  // (c) el orden natural empieza arriba (y mayor).
  const primera = cajas[0]!, ultima = cajas[cajas.length - 1]!;
  if (primera.y0 + primera.y1 >= ultima.y0 + ultima.y1) return chars;
  const sep = separador !== null && separador.length > 0 ? separador : [{ ch: '\r', boxPt: { xPt: 0, yPt: 0, wPt: 0, hPt: 0 } }, { ch: '\n', boxPt: { xPt: 0, yPt: 0, wPt: 0, hPt: 0 } }];
  const out: CharBox[] = [];
  llenos.reverse().forEach((b, i) => { if (i > 0) out.push(...sep); out.push(...b); });
  return out;
}

/**
 * Quads de un rango de caracteres [a, b] (inclusive, en cualquier orden): UNO
 * POR LÍNEA VISUAL, recortados al tramo. Cada carácter con caja se entrega a
 * `quadsPorLinea` con el identificador de su línea (agrupada en pt de usuario, E-122);
 * nunca se trocea como multilínea.
 */
export function quadsDeRango(chars: readonly CharBox[], a: number, b: number, geo: PageGeometry): QuadPt[] {
  const desde = Math.max(0, Math.min(a, b)), hasta = Math.min(chars.length - 1, Math.max(a, b));
  const banda = bandasDeLinea(chars);
  const cajas = [];
  for (let i = desde; i <= hasta; i++) {
    const c = chars[i]!;
    if (!tieneCaja(c)) continue;
    // Along: la del propio carácter (recorte exacto). Across: la de su LÍNEA entera, porque la caja de un
    // glifo depende de su forma ("a" baja, "l" alta) y un marcado debe tener el grosor de la línea, no el
    // del glifo. Todo en pt de usuario; `rectPtToCss` solo se usa para medir el tamaño visual.
    const bd = banda[i]!, bx = c.boxPt;
    const boxPt = bd.vertical
      ? { xPt: bd.ini, yPt: bx.yPt, wPt: bd.fin - bd.ini, hPt: bx.hPt }
      : { xPt: bx.xPt, yPt: bd.ini, wPt: bx.wPt, hPt: bd.fin - bd.ini };
    const r = geo.rectPtToCss(boxPt);
    // `sizePt` grande a propósito: la caja de un carácter nunca es multilínea (no se trocea en bandas).
    cajas.push({ boxPt, sizePt: Math.max(r.width, r.height), linea: bd.id });
  }
  return quadsPorLinea(cajas, geo);
}

/** Banda de una línea de texto en pt de usuario: su rango en el eje perpendicular a la escritura. */
interface BandaLinea {
  /** Identificador de la línea (los caracteres de una misma línea comparten la banda). */
  id: number;
  /** Escritura vertical en el espacio de usuario (la línea avanza en Y): la banda es un rango de X; si no, de Y. */
  vertical: boolean;
  ini: number;
  fin: number;
}

/** Solape (pt) de dos rangos [a0,a1] y [b0,b1]. */
const solape = (a0: number, a1: number, b0: number, b1: number): number => Math.min(a1, b1) - Math.max(a0, b0);

/**
 * Para cada carácter con caja: la banda de su línea, es decir, la envolvente de los caracteres consecutivos (en
 * orden de lectura) que solapan con ella más de la mitad del grosor del menor.
 *
 * La agrupación se hace en pt de USUARIO (sin girar), no en el espacio visual girado (E-122): en una página
 * /Rotate 90/270 el texto normal queda vertical en pantalla y agrupar por solape vertical visual dejaba cada
 * carácter en su propia banda (un rectángulo por carácter). La dirección de la línea sale de cada par de
 * caracteres consecutivos: avanzan en X (línea horizontal, banda en Y) o en Y (línea vertical, banda en X);
 * así vale con cualquier /Rotate y también con texto contragirado.
 */
function bandasDeLinea(chars: readonly CharBox[]): (BandaLinea | undefined)[] {
  const out: (BandaLinea | undefined)[] = new Array(chars.length);
  let grupo: number[] = [];
  let banda: BandaLinea | null = null;
  let prev: CharBox | null = null;
  let siguienteId = 0;
  const cerrar = (): void => { if (banda) for (const i of grupo) out[i] = banda; grupo = []; banda = null; }; // misma referencia = misma línea
  chars.forEach((c, i) => {
    if (!tieneCaja(c)) return;
    const { xPt: x, yPt: y, wPt: w, hPt: h } = c.boxPt;
    if (banda && prev) {
      const p = prev.boxPt;
      if (grupo.length === 1) { // la dirección de la línea se decide con el primer par
        const oy = solape(y, y + h, p.yPt, p.yPt + p.hPt) / Math.min(h, p.hPt);
        const ox = solape(x, x + w, p.xPt, p.xPt + p.wPt) / Math.min(w, p.wPt);
        const vertical = ox > oy && ox > 0.5;
        if (vertical || oy > 0.5) {
          banda.vertical = vertical;
          banda.ini = vertical ? Math.min(p.xPt, x) : Math.min(p.yPt, y);
          banda.fin = vertical ? Math.max(p.xPt + p.wPt, x + w) : Math.max(p.yPt + p.hPt, y + h);
          grupo.push(i); prev = c; return;
        }
        cerrar();
      } else {
        const vertical = banda.vertical;
        const a0 = vertical ? x : y, a1 = vertical ? x + w : y + h;
        if (solape(banda.ini, banda.fin, a0, a1) > 0.5 * Math.min(banda.fin - banda.ini, a1 - a0)) {
          banda.ini = Math.min(banda.ini, a0); banda.fin = Math.max(banda.fin, a1); grupo.push(i); prev = c; return;
        }
        cerrar();
      }
    }
    banda = { id: siguienteId++, vertical: false, ini: y, fin: y + h };
    grupo = [i];
    prev = c;
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

/** Líneas visuales de una página (caracteres con caja consecutivos de la misma banda) y sus medidas en px CSS a escala 1. */
function estructuraLineas(chars: readonly CharBox[], geo: PageGeometry): {
  idxCaja: number[]; lineas: number[][]; izq: (i: number) => number; der: (i: number) => number;
} {
  const banda = bandasDeLinea(chars);
  const idxCaja: number[] = [];
  chars.forEach((c, i) => { if (tieneCaja(c)) idxCaja.push(i); });
  // Líneas: caracteres con caja consecutivos que comparten la misma banda (misma referencia).
  const lineas: number[][] = [];
  for (const i of idxCaja) {
    const ult = lineas[lineas.length - 1];
    if (ult && banda[ult[0]!] === banda[i]) ult.push(i); else lineas.push([i]);
  }
  const izq = (i: number): number => geo.rectPtToCss(chars[i]!.boxPt).left;
  const der = (i: number): number => { const r = geo.rectPtToCss(chars[i]!.boxPt); return r.left + r.width; };
  return { idxCaja, lineas, izq, der };
}

/** Caret de la línea `l` (índices de carácter) más cercano a la columna `x` (px CSS), incluido su final. */
function caretEnColumna(l: readonly number[], x: number, izq: (i: number) => number, der: (i: number) => number): number {
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
 * Línea visual (índice y total) y columna (x en px CSS a escala 1) de un caret, o `null` si la página no tiene
 * caracteres con caja. Es la base de Mayús+↓/↑ y de cruzar a la página contigua conservando la x (E-115).
 */
export function lineaYColumnaDeCaret(chars: readonly CharBox[], caret: number, geo: PageGeometry): { linea: number; total: number; x: number } | null {
  const { idxCaja, lineas, izq, der } = estructuraLineas(chars, geo);
  if (idxCaja.length === 0) return null;
  // Carácter de referencia del caret: el que tiene justo delante; si no hay (fin de línea), el de detrás.
  if (caret < chars.length && tieneCaja(chars[caret]!)) return { linea: lineas.findIndex((l) => l.includes(caret)), total: lineas.length, x: izq(caret) };
  let k = caret - 1;
  while (k >= 0 && !tieneCaja(chars[k]!)) k--;
  if (k < 0) return null;
  return { linea: lineas.findIndex((l) => l.includes(k)), total: lineas.length, x: der(k) };
}

/** Caret de la línea visual `linea` (0 = primera; negativo = última) más cercano a la columna `x` (px CSS a escala 1); -1 si no hay líneas. */
export function caretEnLineaPorX(chars: readonly CharBox[], linea: number, x: number, geo: PageGeometry): number {
  const { lineas, izq, der } = estructuraLineas(chars, geo);
  if (lineas.length === 0) return -1;
  const l = lineas[linea < 0 ? lineas.length - 1 : linea];
  return l ? caretEnColumna(l, x, izq, der) : -1;
}

/**
 * Caret tras mover el foco UNA línea visual arriba (`dir` -1) o abajo (+1) conservando la columna
 * (x visual en px CSS). Sin línea siguiente/anterior va al final/inicio del texto, como un campo de
 * texto. La agrupación en líneas es la de `bandasDeLinea` (espacio de usuario, E-122), y `geo` es la
 * geometría a escala 1 (px CSS = pt visuales).
 */
export function caretLinea(chars: readonly CharBox[], caret: number, dir: 1 | -1, geo: PageGeometry): number {
  const pos = lineaYColumnaDeCaret(chars, caret, geo);
  if (!pos) return caret;
  const { idxCaja, lineas, izq, der } = estructuraLineas(chars, geo);
  const destino = pos.linea + dir;
  if (destino < 0) return idxCaja[0]!;
  if (destino >= lineas.length) return idxCaja[idxCaja.length - 1]! + 1;
  return caretEnColumna(lineas[destino]!, pos.x, izq, der);
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
