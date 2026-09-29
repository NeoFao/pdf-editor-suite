import type { Block, Inline, ListBlock } from './ast';

/**
 * Maquetador PURO: del AST de `parse.ts` a páginas A4 con una lista plana de
 * "trazos de texto" (uno por palabra o marcador de lista) y "barras"
 * (rectángulos rellenos: reglas horizontales, fondo de bloques de código y
 * barra de cita) en puntos PDF, listos para `insertText`/`fillRect`.
 *
 * PURO a propósito (§9 fila #32 del spec): no toca el motor ni el DOM. El
 * ancho de cada palabra se obtiene de `medir`, una función INYECTADA — quien
 * llama (`ConversorMarkdownNavegador`) la implementa con
 * `PdfEngine.measureText`. Esto es lo que permite testear el ajuste de línea,
 * los saltos de página y las sangrías con un `medir` falso (ancho fijo por
 * carácter) sin arrancar el motor WASM.
 *
 * Estilo (fijado por el dueño, no configurable en esta fase): cuerpo
 * Helvetica 11pt/interlineado 1.4; H1 22, H2 17, H3 14, H4-H6 12, todos
 * Helvetica-Bold; código Courier 10 con fondo gris; cita con sangría y barra
 * gris; listas con viñeta/número y sangría francesa; enlaces en azul (el
 * texto — la URL como anotación clicable queda para una fase posterior, ver
 * nota en `ConversorMarkdownNavegador`).
 *
 * Limitaciones conocidas de esta fase:
 * - La línea base se aproxima con `BASELINE_FRACTION` (fracción fija de la
 *   altura de línea), no con el ascenso/descenso real de la fuente — `medir`
 *   solo da anchos, no métricas verticales. Suficiente para un resultado
 *   profesional a simple vista; no es una línea base "exacta" como la que
 *   usa la capa de edición en pantalla (`measureFontAscent.ts`, que sí puede
 *   preguntarle al canvas).
 * - Los bloques de código NO reajustan línea (se respeta el salto de línea
 *   original tal cual, como cualquier bloque de código de CommonMark): una
 *   línea de código más ancha que el margen se sale del margen.
 * - Un ítem de lista es una sola línea lógica (más su sublista); no admite
 *   párrafos múltiples dentro del ítem.
 * - Dentro de un encabezado, la negrita/cursiva del Markdown original se
 *   ignora (el encabezado entero se pinta en Helvetica-Bold al tamaño de su
 *   nivel): evita mezclar dos negritas visualmente iguales.
 * - La protección contra "encabezado huérfano" solo opera en el nivel
 *   superior del documento (no dentro de una cita), y si un encabezado en
 *   sí mismo ocupa más de una línea envuelta, el salto de página puede caer
 *   entre esas líneas en vez de antes de todo el encabezado — caso raro
 *   (encabezados casi nunca envuelven) y no cubierto por los tests.
 */

export type RGB = [number, number, number];

/** Ancho en puntos PDF de `text` en la fuente estándar `fontName` al tamaño `sizePt`. Inyectada por quien llama (ver PdfEngine.measureText). */
export type Medir = (fontName: string, sizePt: number, text: string) => number;

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

/** Rectángulo relleno: regla horizontal, fondo de código o barra de cita. */
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

// --- Geometría de página y estilo (constantes del dueño, no configurables) ---

export const PAGE_WIDTH_PT = 595;
export const PAGE_HEIGHT_PT = 842;
export const MARGIN_PT = 56;
export const CONTENT_WIDTH_PT = PAGE_WIDTH_PT - MARGIN_PT * 2;

export const BODY_SIZE_PT = 11;
export const LINE_HEIGHT_FACTOR = 1.4;
export const HEADING_LINE_HEIGHT_FACTOR = 1.25;
export const HEADING_SIZES_PT: Record<1 | 2 | 3 | 4 | 5 | 6, number> = { 1: 22, 2: 17, 3: 14, 4: 12, 5: 12, 6: 12 };
export const CODE_SIZE_PT = 10;

export const LIST_INDENT_PT = 18;
export const HANGING_INDENT_PT = 20;
export const QUOTE_INDENT_PT = 16;
export const QUOTE_BAR_WIDTH_PT = 2.5;
export const CODE_PAD_X_PT = 6;
export const HR_BLOCK_HEIGHT_PT = 14;

/** Fracción de la altura de línea, medida desde su base, donde cae la línea base del texto (ver limitación en el comentario de módulo). */
export const BASELINE_FRACTION = 0.28;

const BLACK: RGB = [0, 0, 0];
const LINK_BLUE: RGB = [37, 99, 235];
const QUOTE_GRAY_TEXT: RGB = [90, 90, 90];
const QUOTE_BAR_GRAY: RGB = [170, 170, 170];
const HR_GRAY: RGB = [190, 190, 190];
const CODE_BG_GRAY: RGB = [240, 240, 240];
const CODE_TEXT_GRAY: RGB = [40, 40, 40];

// ---------------------------------------------------------------------------
// Inline -> átomos (palabras con su propio estilo)
// ---------------------------------------------------------------------------

interface Atom { text: string; font: string; sizePt: number; color: RGB }

function bodyFontFor(bold: boolean, italic: boolean): string {
  if (bold && italic) return 'Helvetica-BoldOblique';
  if (bold) return 'Helvetica-Bold';
  if (italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

/**
 * Aplana el árbol de inlines en palabras sueltas con su fuente/color ya
 * resueltos. `lockFont`, si se da, fuerza esa fuente en todo el tramo
 * (encabezados: siempre Helvetica-Bold, ver limitaciones del módulo).
 */
function flattenInline(nodes: Inline[], sizePt: number, color: RGB, bold: boolean, italic: boolean, lockFont?: string): Atom[] {
  const atoms: Atom[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      const font = lockFont ?? bodyFontFor(bold, italic);
      for (const w of node.text.split(/\s+/)) if (w !== '') atoms.push({ text: w, font, sizePt, color });
    } else if (node.type === 'strong') {
      atoms.push(...flattenInline(node.children, sizePt, color, true, italic, lockFont));
    } else if (node.type === 'em') {
      atoms.push(...flattenInline(node.children, sizePt, color, bold, true, lockFont));
    } else if (node.type === 'code') {
      for (const w of node.text.split(/\s+/)) if (w !== '') atoms.push({ text: w, font: 'Courier', sizePt, color });
    } else if (node.type === 'link') {
      const font = lockFont ?? bodyFontFor(bold, italic);
      for (const w of node.text.split(/\s+/)) if (w !== '') atoms.push({ text: w, font, sizePt, color: LINK_BLUE });
    }
  }
  return atoms;
}

// ---------------------------------------------------------------------------
// Ajuste de línea
// ---------------------------------------------------------------------------

interface WrappedLine { atoms: Atom[] }

/**
 * Empaqueta átomos en líneas sin superar `maxWidthPt`, midiendo con
 * `medir`. Una palabra más ancha que `maxWidthPt` por sí sola ocupa su
 * propia línea igualmente (esta fase no parte palabras).
 */
function wrapAtoms(atoms: Atom[], maxWidthPt: number, medir: Medir): WrappedLine[] {
  const lines: WrappedLine[] = [];
  let current: Atom[] = [];
  let width = 0;
  for (const atom of atoms) {
    const wordWidth = medir(atom.font, atom.sizePt, atom.text);
    const spaceWidth = current.length > 0 ? medir(atom.font, atom.sizePt, ' ') : 0;
    if (current.length > 0 && width + spaceWidth + wordWidth > maxWidthPt) {
      lines.push({ atoms: current });
      current = [atom];
      width = wordWidth;
    } else {
      current.push(atom);
      width += spaceWidth + wordWidth;
    }
  }
  if (current.length > 0) lines.push({ atoms: current });
  return lines;
}

// ---------------------------------------------------------------------------
// Líneas -> ítems de flujo vertical (independientes de página)
// ---------------------------------------------------------------------------

interface Seg { xPt: number; text: string; font: string; sizePt: number; color: RGB }
interface BarSeg { xPt: number; wPt: number; color: RGB }
interface BgSeg { xPt: number; wPt: number; color: RGB }

interface FlowLine { kind: 'line'; height: number; segs: Seg[]; bars: BarSeg[]; bg?: BgSeg; keepWithNextHeight?: number }
interface FlowGap { kind: 'gap'; height: number; bars: BarSeg[] }
interface FlowRule { kind: 'rule'; height: number; xPt: number; wPt: number; color: RGB; bars: BarSeg[] }
type FlowItem = FlowLine | FlowGap | FlowRule;

function sameColor(a: RGB, b: RGB): boolean { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }

/**
 * Convierte una línea ya envuelta en sus trazos finales, FUSIONANDO palabras
 * consecutivas que comparten fuente/tamaño/color en un solo trazo (con un
 * espacio literal entre ellas) en vez de un trazo por palabra. No es solo
 * una optimización cosmética: `PdfEngine.insertText`/`fillRect` reabren y
 * regeneran el contenido de la página en CADA llamada (coste que crece con
 * el número de objetos ya insertados) — con un trazo por palabra, un
 * documento de unos cientos de palabras tarda muchos segundos, todos en el
 * hilo principal (medido: ~500 trazos, ~16s). Fusionar por tramo de estilo
 * (que es exactamente "cada tramo es un trazo" del spec — un tramo de texto
 * normal es tan válido como uno en negrita) reduce las llamadas al motor a
 * una por línea en el caso común. El ancho total no cambia: `medir` de un
 * texto fusionado es la misma suma de anchos por carácter que medir cada
 * palabra y cada espacio por separado.
 */
function lineToFlowLine(line: WrappedLine, indentPt: number, height: number, medir: Medir): FlowLine {
  const segs: Seg[] = [];
  let x = MARGIN_PT + indentPt;
  let i = 0;
  while (i < line.atoms.length) {
    const a = line.atoms[i]!;
    let text = a.text;
    let j = i + 1;
    while (j < line.atoms.length && line.atoms[j]!.font === a.font && line.atoms[j]!.sizePt === a.sizePt && sameColor(line.atoms[j]!.color, a.color)) {
      text += ' ' + line.atoms[j]!.text;
      j++;
    }
    segs.push({ xPt: x, text, font: a.font, sizePt: a.sizePt, color: a.color });
    x += medir(a.font, a.sizePt, text);
    if (j < line.atoms.length) x += medir(a.font, a.sizePt, ' ');
    i = j;
  }
  return { kind: 'line', height, segs, bars: [] };
}

function renderParagraphLike(
  inlines: Inline[], sizePt: number, indentPt: number, color: RGB, medir: Medir, lockFont: string | undefined, lineHeightFactor: number
): FlowLine[] {
  const atoms = flattenInline(inlines, sizePt, color, false, false, lockFont);
  const maxWidth = Math.max(CONTENT_WIDTH_PT - indentPt, 20);
  const wrapped = atoms.length > 0 ? wrapAtoms(atoms, maxWidth, medir) : [{ atoms: [] }];
  const height = sizePt * lineHeightFactor;
  return wrapped.map((l) => lineToFlowLine(l, indentPt, height, medir));
}

function renderList(list: ListBlock, indentPt: number, medir: Medir, color: RGB): FlowItem[] {
  const items: FlowItem[] = [];
  let n = list.start ?? 1;
  list.items.forEach((item, idx) => {
    if (idx > 0) items.push({ kind: 'gap', height: 2, bars: [] });
    const marker = list.ordered ? `${n}.` : '•';
    n++;
    const atoms = flattenInline(item.children, BODY_SIZE_PT, color, false, false);
    const textIndent = indentPt + HANGING_INDENT_PT;
    const maxWidth = Math.max(CONTENT_WIDTH_PT - textIndent, 20);
    const wrapped = atoms.length > 0 ? wrapAtoms(atoms, maxWidth, medir) : [{ atoms: [] }];
    const height = BODY_SIZE_PT * LINE_HEIGHT_FACTOR;
    wrapped.forEach((line, li) => {
      const flow = lineToFlowLine(line, textIndent, height, medir);
      if (li === 0) flow.segs.unshift({ xPt: MARGIN_PT + indentPt, text: marker, font: 'Helvetica', sizePt: BODY_SIZE_PT, color });
      items.push(flow);
    });
    if (item.sublist) {
      items.push({ kind: 'gap', height: 3, bars: [] });
      items.push(...renderList(item.sublist, indentPt + LIST_INDENT_PT, medir, color));
    }
  });
  return items;
}

function renderCode(block: { text: string }, indentPt: number): FlowItem[] {
  const lines = block.text.length > 0 ? block.text.split('\n') : [''];
  const height = CODE_SIZE_PT * LINE_HEIGHT_FACTOR;
  const bg: BgSeg = { xPt: MARGIN_PT + indentPt, wPt: CONTENT_WIDTH_PT - indentPt, color: CODE_BG_GRAY };
  const pad = height * 0.4;
  const items: FlowItem[] = [];
  items.push({ kind: 'line', height: pad, segs: [], bars: [], bg });
  for (const l of lines) {
    const segs: Seg[] = l.length > 0
      ? [{ xPt: MARGIN_PT + indentPt + CODE_PAD_X_PT, text: l, font: 'Courier', sizePt: CODE_SIZE_PT, color: CODE_TEXT_GRAY }]
      : [];
    items.push({ kind: 'line', height, segs, bars: [], bg });
  }
  items.push({ kind: 'line', height: pad, segs: [], bars: [], bg });
  return items;
}

/** Separación vertical (pt) antes de `type`, sabiendo el tipo del bloque anterior (`null` si es el primero del documento). */
function spacingBefore(prevType: Block['type'] | null, type: Block['type']): number {
  if (prevType === null) return 0;
  if (type === 'heading') return 16;
  if (prevType === 'heading') return 6;
  return 8;
}

function renderBlock(block: Block, indentPt: number, medir: Medir, color: RGB): FlowItem[] {
  switch (block.type) {
    case 'heading':
      return renderParagraphLike(block.children, HEADING_SIZES_PT[block.level], indentPt, color, medir, 'Helvetica-Bold', HEADING_LINE_HEIGHT_FACTOR);
    case 'paragraph':
      return renderParagraphLike(block.children, BODY_SIZE_PT, indentPt, color, medir, undefined, LINE_HEIGHT_FACTOR);
    case 'list':
      return renderList(block, indentPt, medir, color);
    case 'blockquote': {
      const inner = renderBlocksFlat(block.children, indentPt + QUOTE_INDENT_PT, medir, false, QUOTE_GRAY_TEXT);
      const bar: BarSeg = { xPt: MARGIN_PT + indentPt, wPt: QUOTE_BAR_WIDTH_PT, color: QUOTE_BAR_GRAY };
      return inner.map((it) => ({ ...it, bars: [...it.bars, bar] }));
    }
    case 'code':
      return renderCode(block, indentPt);
    case 'hr':
      return [{ kind: 'rule', height: HR_BLOCK_HEIGHT_PT, xPt: MARGIN_PT + indentPt, wPt: CONTENT_WIDTH_PT - indentPt, color: HR_GRAY, bars: [] }];
  }
}

/**
 * Renderiza una secuencia de bloques al flujo vertical, con la separación
 * entre bloques ya insertada. `widowGuard`: si es `true` (solo el nivel
 * superior del documento), ata a la ÚLTIMA línea de cada encabezado cuánta
 * altura extra hace falta detrás (separación + primer ítem del bloque
 * siguiente) para que `paginar` no lo deje huérfano al pie de página.
 */
function renderBlocksFlat(blocks: Block[], indentPt: number, medir: Medir, widowGuard: boolean, color: RGB = BLACK): FlowItem[] {
  const items: FlowItem[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (i > 0) items.push({ kind: 'gap', height: spacingBefore(blocks[i - 1]!.type, block.type), bars: [] });
    const blockItems = renderBlock(block, indentPt, medir, color);
    if (widowGuard && block.type === 'heading' && blockItems.length > 0) {
      const next = blocks[i + 1];
      if (next) {
        const nextGap = spacingBefore(block.type, next.type);
        const nextItems = renderBlock(next, indentPt, medir, color);
        const nextFirst = nextItems[0];
        const extra = nextGap + (nextFirst ? nextFirst.height : 0);
        const last = blockItems[blockItems.length - 1]!;
        if (last.kind === 'line') last.keepWithNextHeight = (last.keepWithNextHeight ?? 0) + extra;
      }
    }
    items.push(...blockItems);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Paginación
// ---------------------------------------------------------------------------

/** Reparte los ítems de flujo en páginas A4, saltando de página cuando un ítem (más su posible "no huérfano") no cabe en lo que queda. */
function paginar(items: FlowItem[]): ResultadoLayout {
  const trazos: Trazo[] = [];
  const barras: Barra[] = [];
  let page = 0;
  const topPt = PAGE_HEIGHT_PT - MARGIN_PT;
  const bottomPt = MARGIN_PT;
  let cursor = topPt;
  let skipLeadingGaps = false;

  for (const item of items) {
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
      if (item.kind === 'gap') continue;
    }

    const bottom = cursor - item.height;

    if (item.kind === 'line') {
      const baseline = bottom + item.height * BASELINE_FRACTION;
      for (const seg of item.segs) trazos.push({ page, xPt: seg.xPt, yPt: baseline, text: seg.text, font: seg.font, sizePt: seg.sizePt, color: seg.color });
      if (item.bg) barras.push({ page, xPt: item.bg.xPt, yPt: bottom, wPt: item.bg.wPt, hPt: item.height, color: item.bg.color });
      for (const bar of item.bars) barras.push({ page, xPt: bar.xPt, yPt: bottom, wPt: bar.wPt, hPt: item.height, color: bar.color });
    } else if (item.kind === 'rule') {
      barras.push({ page, xPt: item.xPt, yPt: bottom + (item.height - 1) / 2, wPt: item.wPt, hPt: 1, color: item.color });
      for (const bar of item.bars) barras.push({ page, xPt: bar.xPt, yPt: bottom, wPt: bar.wPt, hPt: item.height, color: bar.color });
    } else {
      for (const bar of item.bars) barras.push({ page, xPt: bar.xPt, yPt: bottom, wPt: bar.wPt, hPt: item.height, color: bar.color });
    }

    cursor = bottom;
  }

  return { totalPaginas: page + 1, trazos, barras };
}

export function layoutMarkdown(blocks: Block[], medir: Medir): ResultadoLayout {
  if (blocks.length === 0) return { totalPaginas: 1, trazos: [], barras: [] };
  const items = renderBlocksFlat(blocks, 0, medir, true, BLACK);
  return paginar(items);
}

/** Color usado para el texto dentro de una cita — exportado solo para los tests de sangría/estilo. */
export const QUOTE_TEXT_COLOR = QUOTE_GRAY_TEXT;
