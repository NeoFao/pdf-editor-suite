import type { PageGeometry } from '../coords/PageGeometry';
import type { CharBox } from '../engine/PdfEngine';
import { caretEnLineaPorX, caretLinea, caretSiguiente, lineaYColumnaDeCaret, tieneCaja } from './seleccionTexto';

/**
 * Movimiento del foco de la selección por TECLADO a través de varias páginas (E-115). Funciones PURAS: no
 * tocan el DOM; los caracteres de cada página los pide quien llama (al modelo, no al DOM: la página destino
 * puede no estar pintada). Un caret es una posición ENTRE caracteres de la página `pagina` (ver T16).
 * La x que se conserva al cruzar con ↓/↑ está en px CSS a escala 1 (= pt visuales), válida entre páginas
 * de distinto tamaño porque cada página se mide con su propia geometría.
 */
export interface PosTexto { pagina: number; caret: number }

export interface ContextoTexto {
  numPaginas: number;
  chars(pagina: number): readonly CharBox[];
  /** Geometría a escala 1 (px CSS = pt visuales) de la página. */
  geo(pagina: number): PageGeometry;
}

/** Selección con el modelo del visor: caracteres inclusivos y página de cada extremo. */
export interface RangoMultipagina {
  paginaAncla: number; ancla: number; paginaFoco: number; foco: number;
  /** Con UN solo carácter el rango no dice si el foco quedó detrás o delante del ancla: lo guarda el teclado (la selección del ratón no lo necesita). */
  inversa?: boolean;
}

const cmp = (a: PosTexto, b: PosTexto): number => (a.pagina !== b.pagina ? a.pagina - b.pagina : a.caret - b.caret);

/** Rango de caracteres → carets (ancla y foco), con la regla de T16 extendida a páginas. */
export function caretsDeRango(r: RangoMultipagina): { ancla: PosTexto; foco: PosTexto } {
  const directo = r.inversa !== undefined ? !r.inversa : r.paginaAncla < r.paginaFoco || (r.paginaAncla === r.paginaFoco && r.ancla <= r.foco);
  return directo
    ? { ancla: { pagina: r.paginaAncla, caret: r.ancla }, foco: { pagina: r.paginaFoco, caret: r.foco + 1 } }
    : { ancla: { pagina: r.paginaAncla, caret: r.ancla + 1 }, foco: { pagina: r.paginaFoco, caret: r.foco } };
}

/** Primer carácter con caja en o tras el caret (cruzando páginas); `{ pagina: n, caret: 0 }` si no queda ninguno. */
function siguienteVisible(ctx: ContextoTexto, pos: PosTexto): PosTexto {
  for (let p = pos.pagina, desde = pos.caret; p < ctx.numPaginas; p++, desde = 0) {
    const cs = ctx.chars(p);
    for (let j = desde; j < cs.length; j++) if (tieneCaja(cs[j]!)) return { pagina: p, caret: j };
  }
  return { pagina: ctx.numPaginas, caret: 0 };
}

/** Último carácter con caja antes del caret (cruzando páginas); `null` si no hay ninguno. */
function anteriorVisible(ctx: ContextoTexto, pos: PosTexto): PosTexto | null {
  for (let p = pos.pagina; p >= 0; p--) {
    const cs = ctx.chars(p);
    for (let j = p === pos.pagina ? pos.caret - 1 : cs.length - 1; j >= 0; j--) if (tieneCaja(cs[j]!)) return { pagina: p, caret: j };
  }
  return null;
}

/**
 * Carets (ancla, foco) → rango de caracteres inclusivos; `null` si entre ambos no hay ningún carácter visible
 * (selección vacía). Dos carets en el borde entre páginas (final de la N, principio de la N+1) son la misma posición.
 */
export function rangoDeCarets(ctx: ContextoTexto, ancla: PosTexto, foco: PosTexto): RangoMultipagina | null {
  const a = siguienteVisible(ctx, ancla), f = siguienteVisible(ctx, foco);
  const k = cmp(a, f);
  if (k === 0) return null;
  if (k < 0) {
    const fin = anteriorVisible(ctx, foco);
    return fin ? { paginaAncla: a.pagina, ancla: a.caret, paginaFoco: fin.pagina, foco: fin.caret, inversa: false } : null;
  }
  const ini = anteriorVisible(ctx, ancla);
  return ini ? { paginaAncla: ini.pagina, ancla: ini.caret, paginaFoco: f.pagina, foco: f.caret, inversa: true } : null;
}

/**
 * Mueve el foco un carácter (`caracter`) o una línea (`linea`). Al agotar el texto de la página pasa a la
 * contigua con caracteres (las vacías se saltan): hacia delante tras el primer carácter de la siguiente, hacia
 * atrás ante el último de la anterior (una pulsación siempre salta sobre un carácter visible). Con ↓/↑ desde la
 * última/primera línea cae en la primera/última de la página contigua conservando la columna. Sin página contigua,
 * se comporta como dentro de una sola página.
 */
export function moverFoco(ctx: ContextoTexto, pos: PosTexto, mov: 'caracter' | 'linea', dir: 1 | -1): PosTexto {
  const chars = ctx.chars(pos.pagina);
  const contigua = (): number => {
    for (let p = pos.pagina + dir; p >= 0 && p < ctx.numPaginas; p += dir) if (ctx.chars(p).some(tieneCaja)) return p;
    return -1;
  };
  if (mov === 'caracter') {
    const c = caretSiguiente(chars, pos.caret, dir);
    if (c !== pos.caret) return { pagina: pos.pagina, caret: c };
    const p = contigua();
    if (p < 0) return pos;
    const cs = ctx.chars(p);
    let ultimo = cs.length - 1;
    while (ultimo > 0 && !tieneCaja(cs[ultimo]!)) ultimo--;
    return dir > 0 ? { pagina: p, caret: cs.findIndex(tieneCaja) + 1 } : { pagina: p, caret: ultimo };
  }
  const info = lineaYColumnaDeCaret(chars, pos.caret, ctx.geo(pos.pagina));
  const enBorde = info !== null && (dir > 0 ? info.linea >= info.total - 1 : info.linea <= 0);
  if (info && enBorde) {
    const p = contigua();
    if (p >= 0) {
      const c = caretEnLineaPorX(ctx.chars(p), dir > 0 ? 0 : -1, info.x, ctx.geo(p));
      if (c >= 0) return { pagina: p, caret: c };
    }
  }
  return { pagina: pos.pagina, caret: caretLinea(chars, pos.caret, dir, ctx.geo(pos.pagina)) };
}
