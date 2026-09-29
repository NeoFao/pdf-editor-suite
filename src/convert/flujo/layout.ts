/**
 * Maquetador de flujo COMÚN, generalizado a partir de `../markdown/layout.ts`
 * (§9 fila #4 y fila #32). Ambos conversores (Markdown y DOCX) construyen su
 * propio árbol de "ítems de flujo" (líneas, huecos, reglas) a partir de su
 * modelo de documento respectivo, y este módulo hace las dos partes que NO
 * dependen de qué formato de origen se trate: el ajuste de línea (con
 * alineación) y la paginación.
 *
 * PURO a propósito (igual que el módulo del que viene): no toca el motor ni
 * el DOM. `medir` sigue siendo una función inyectada.
 *
 * Alineación: `left` coloca cada línea pegada al margen izquierdo (igual que
 * el comportamiento previo, sin cambios). `center`/`right` desplazan la línea
 * ya maquetada según el ancho natural que ocupa. `justify` reparte el espacio
 * sobrante entre las palabras de la línea (excepto la ÚLTIMA línea del
 * párrafo, que Word e InDesign dejan alineada a la izquierda — así lo pide
 * el spec) — por eso NO fusiona palabras consecutivas del mismo estilo en un
 * solo trazo como sí hace `left`/`center`/`right`: cada hueco entre palabras
 * puede tener un ancho distinto, así que cada palabra necesita su propia
 * coordenada x.
 */

export type RGB = [number, number, number];

/** Ancho en puntos PDF de `text` en la fuente `fontName` al tamaño `sizePt`. Inyectada por quien llama. */
export type Medir = (fontName: string, sizePt: number, text: string) => number;

export type Align = 'left' | 'center' | 'right' | 'justify';

export interface Atom {
  text: string; font: string; sizePt: number; color: RGB;
  /**
   * `true` si este átomo va PEGADO al anterior, sin espacio entre ambos —
   * p. ej. un documento DOCX donde una palabra y la coma que la sigue vienen
   * en dos `w:r` (runs) distintos por tener formato distinto (uno en
   * negrita, la coma sin formato) pero SIN espacio real entre ellos en el
   * texto original. Sin esto, el ajuste de línea (pensado para palabras de
   * Markdown, siempre separadas por espacio) insertaría un espacio de más
   * entre la palabra y la coma. Markdown nunca lo usa (siempre `undefined`,
   * equivalente a `false`): mismo comportamiento de siempre.
   */
  pegado?: boolean;
}

export interface Trazo {
  page: number;
  xPt: number;
  /** Línea base, en puntos PDF (origen abajo-izquierda de la página). */
  yPt: number;
  text: string;
  font: string;
  sizePt: number;
  color: RGB;
}

/** Rectángulo relleno: regla horizontal, fondo de código, barra de cita o de lista. */
export interface Barra {
  page: number;
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
  color: RGB;
}

export interface ResultadoLayout {
  totalPaginas: number;
  trazos: Trazo[];
  barras: Barra[];
}

export interface Seg { xPt: number; text: string; font: string; sizePt: number; color: RGB }
export interface BarSeg { xPt: number; wPt: number; color: RGB }
export interface BgSeg { xPt: number; wPt: number; color: RGB }

export interface FlowLine { kind: 'line'; height: number; segs: Seg[]; bars: BarSeg[]; bg?: BgSeg; keepWithNextHeight?: number }
export interface FlowGap { kind: 'gap'; height: number; bars: BarSeg[] }
export interface FlowRule { kind: 'rule'; height: number; xPt: number; wPt: number; color: RGB; bars: BarSeg[] }
/** Salto de página explícito (`w:br w:type="page"` o `w:pageBreakBefore` en DOCX). Markdown no lo usa. */
export interface FlowPageBreak { kind: 'pagebreak' }
export type FlowItem = FlowLine | FlowGap | FlowRule | FlowPageBreak;

/** Tamaño y márgenes de una página, en puntos PDF. */
export interface PageGeometry {
  widthPt: number;
  heightPt: number;
  marginTopPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
  marginRightPt: number;
}

export function sameColor(a: RGB, b: RGB): boolean { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }

/**
 * Empaqueta átomos en líneas sin superar `maxWidthPt`, midiendo con `medir`.
 * Una palabra más ancha que `maxWidthPt` por sí sola ocupa su propia línea
 * igualmente (esta fase no parte palabras).
 */
export function wrapAtoms(atoms: Atom[], maxWidthPt: number, medir: Medir): Atom[][] {
  const lines: Atom[][] = [];
  let current: Atom[] = [];
  let width = 0;
  for (const atom of atoms) {
    const wordWidth = medir(atom.font, atom.sizePt, atom.text);
    const spaceWidth = current.length > 0 && !atom.pegado ? medir(atom.font, atom.sizePt, ' ') : 0;
    if (current.length > 0 && width + spaceWidth + wordWidth > maxWidthPt) {
      lines.push(current);
      current = [atom];
      width = wordWidth;
    } else {
      current.push(atom);
      width += spaceWidth + wordWidth;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * Convierte una línea ya envuelta (un array de átomos) en su `FlowLine`
 * final, con la alineación pedida. `xStartPt` es el margen izquierdo del
 * bloque (margen de página + sangría); `maxWidthPt` el ancho disponible
 * (para centrar/justificar/alinear a la derecha). `isLastLine` desactiva
 * `justify` (cae a `left`) para la última línea de un párrafo.
 */
export function lineToFlowLine(
  atoms: Atom[], xStartPt: number, maxWidthPt: number, align: Align, isLastLine: boolean, height: number, medir: Medir
): FlowLine {
  if (atoms.length === 0) return { kind: 'line', height, segs: [], bars: [] };

  const efectiva: Align = align === 'justify' && (isLastLine || atoms.length === 1) ? 'left' : align;

  if (efectiva === 'justify') {
    const anchos = atoms.map((a) => medir(a.font, a.sizePt, a.text));
    // Un hueco "pegado" (el átomo siguiente no lleva espacio real delante)
    // no cuenta como hueco distribuible ni lleva el espacio normal — si no,
    // el justificado separaría una palabra de la coma que la sigue.
    const espacios = atoms.slice(0, -1).map((a, i) => (atoms[i + 1]!.pegado ? 0 : medir(a.font, a.sizePt, ' ')));
    const anchoNatural = anchos.reduce((s, w) => s + w, 0) + espacios.reduce((s, w) => s + w, 0);
    const huecosDistribuibles = atoms.slice(1).filter((a) => !a.pegado).length;
    const extraPorHueco = huecosDistribuibles > 0 ? Math.max(0, (maxWidthPt - anchoNatural) / huecosDistribuibles) : 0;
    const segs: Seg[] = [];
    let x = xStartPt;
    atoms.forEach((a, i) => {
      segs.push({ xPt: x, text: a.text, font: a.font, sizePt: a.sizePt, color: a.color });
      x += anchos[i]!;
      if (i < atoms.length - 1) x += espacios[i]! + (atoms[i + 1]!.pegado ? 0 : extraPorHueco);
    });
    return { kind: 'line', height, segs, bars: [] };
  }

  // left/center/right: fusiona palabras consecutivas del mismo estilo en un
  // solo trazo (menos objetos de texto en el PDF final — ver el comentario
  // de `lineToFlowLine` original en markdown/layout.ts para la justificación
  // de rendimiento).
  const segs: Seg[] = [];
  let x = 0;
  let i = 0;
  while (i < atoms.length) {
    const a = atoms[i]!;
    let text = a.text;
    let j = i + 1;
    // La fusión por MISMO estilo sigue igual, pero un átomo "pegado" se
    // concatena SIN el espacio de unión (sigue siendo un solo trazo porque
    // comparte estilo con `a` — un átomo pegado de OTRO estilo, como una
    // coma normal tras una palabra en negrita, no se fusiona aquí: rompe el
    // bucle por estilo distinto y se resuelve más abajo, sin espacio entre
    // ambos trazos).
    while (j < atoms.length && atoms[j]!.font === a.font && atoms[j]!.sizePt === a.sizePt && sameColor(atoms[j]!.color, a.color)) {
      text += (atoms[j]!.pegado ? '' : ' ') + atoms[j]!.text;
      j++;
    }
    segs.push({ xPt: x, text, font: a.font, sizePt: a.sizePt, color: a.color });
    x += medir(a.font, a.sizePt, text);
    if (j < atoms.length && !atoms[j]!.pegado) x += medir(a.font, a.sizePt, ' ');
    i = j;
  }
  const anchoNatural = x;
  const offset = efectiva === 'center' ? (maxWidthPt - anchoNatural) / 2
    : efectiva === 'right' ? maxWidthPt - anchoNatural
      : 0;
  const desplazar = xStartPt + Math.max(0, offset);
  for (const s of segs) s.xPt += desplazar;
  return { kind: 'line', height, segs, bars: [] };
}

/**
 * Reparte los ítems de flujo en páginas de tamaño `geo`, saltando de página
 * cuando un ítem (más su posible "no huérfano") no cabe en lo que queda, o
 * cuando aparece un `FlowPageBreak` explícito (solo si ya se pintó algo en
 * la página actual — un salto de página al principio del documento, sin
 * contenido previo, no genera una página en blanco de más).
 */
export function paginar(items: FlowItem[], geo: PageGeometry, baselineFraction: number): ResultadoLayout {
  const trazos: Trazo[] = [];
  const barras: Barra[] = [];
  let page = 0;
  const topPt = geo.heightPt - geo.marginTopPt;
  const bottomPt = geo.marginBottomPt;
  let cursor = topPt;
  let skipLeadingGaps = false;
  let pintadoEnPagina = false;

  for (const item of items) {
    if (item.kind === 'pagebreak') {
      if (pintadoEnPagina) {
        page++;
        cursor = topPt;
        skipLeadingGaps = true;
        pintadoEnPagina = false;
      }
      continue;
    }

    if (skipLeadingGaps) {
      if (item.kind === 'gap') continue;
      skipLeadingGaps = false;
    }

    const extra = item.kind === 'line' ? (item.keepWithNextHeight ?? 0) : 0;
    const needed = item.height + extra;
    if (cursor - needed < bottomPt && cursor < topPt) {
      page++;
      cursor = topPt;
      skipLeadingGaps = true;
      pintadoEnPagina = false;
      if (item.kind === 'gap') continue;
    }

    const bottom = cursor - item.height;

    if (item.kind === 'line') {
      const baseline = bottom + item.height * baselineFraction;
      for (const seg of item.segs) { trazos.push({ page, xPt: seg.xPt, yPt: baseline, text: seg.text, font: seg.font, sizePt: seg.sizePt, color: seg.color }); pintadoEnPagina = true; }
      if (item.bg) { barras.push({ page, xPt: item.bg.xPt, yPt: bottom, wPt: item.bg.wPt, hPt: item.height, color: item.bg.color }); pintadoEnPagina = true; }
      for (const bar of item.bars) { barras.push({ page, xPt: bar.xPt, yPt: bottom, wPt: bar.wPt, hPt: item.height, color: bar.color }); pintadoEnPagina = true; }
    } else if (item.kind === 'rule') {
      barras.push({ page, xPt: item.xPt, yPt: bottom + (item.height - 1) / 2, wPt: item.wPt, hPt: 1, color: item.color });
      for (const bar of item.bars) barras.push({ page, xPt: bar.xPt, yPt: bottom, wPt: bar.wPt, hPt: item.height, color: bar.color });
      pintadoEnPagina = true;
    } else {
      for (const bar of item.bars) { barras.push({ page, xPt: bar.xPt, yPt: bottom, wPt: bar.wPt, hPt: item.height, color: bar.color }); pintadoEnPagina = true; }
    }

    cursor = bottom;
  }

  return { totalPaginas: page + 1, trazos, barras };
}
