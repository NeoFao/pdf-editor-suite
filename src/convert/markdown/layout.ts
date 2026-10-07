import type { Block, Inline, ListBlock } from './ast';
import { validarUrlEnlace } from '../../engine/validarUrlEnlace';
import {
  wrapAtoms, lineToFlowLine, paginar as paginarFlujo,
  type Atom, type RGB, type Medir, type FlowItem, type FlowLine, type BarSeg, type BgSeg, type ResultadoLayout, type PageGeometry
} from '../flujo/layout';

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
 * El ajuste de línea y la paginación en sí (empaquetar átomos, repartir en
 * páginas, encabezados no huérfanos) viven en `../flujo/layout.ts`, un
 * maquetador genérico compartido con el conversor DOCX (§9 fila #4): este
 * módulo solo aporta lo específico de Markdown (estilos de encabezado,
 * listas, citas, código) y siempre pide alineación `left` — el
 * comportamiento y los números que produce son IDÉNTICOS a antes de esa
 * generalización (mismos tests, sin tocar ninguno).
 *
 * Estilo (fijado por el dueño, no configurable en esta fase): cuerpo
 * Helvetica 11pt/interlineado 1.4; H1 22, H2 17, H3 14, H4-H6 12, todos
 * Helvetica-Bold; código Courier 10 con fondo gris; cita con sangría y barra
 * gris; listas con viñeta/número y sangría francesa; enlaces en azul con su
 * URL como anotación `/Link` clicable (fase 2a: el nodo `link` del AST lleva
 * su `url` hasta el átomo y `paginar` la deja en `ResultadoLayout.enlaces`,
 * que `ConversorMarkdownNavegador` traduce a `addLink`).
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

export type { RGB, Medir, Trazo, Barra, ResultadoLayout, EnlaceColocado } from '../flujo/layout';

// --- Geometría de página y estilo (constantes del dueño, no configurables) ---

export const PAGE_WIDTH_PT = 595;
export const PAGE_HEIGHT_PT = 842;
export const MARGIN_PT = 56;
export const CONTENT_WIDTH_PT = PAGE_WIDTH_PT - MARGIN_PT * 2;

const PAGE_GEOMETRY: PageGeometry = {
  widthPt: PAGE_WIDTH_PT, heightPt: PAGE_HEIGHT_PT,
  marginTopPt: MARGIN_PT, marginBottomPt: MARGIN_PT, marginLeftPt: MARGIN_PT, marginRightPt: MARGIN_PT
};

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
      // Fase 2a: la URL viaja en el átomo y `paginar` (flujo/layout.ts) la
      // convierte en una anotación /Link real (validada con
      // validarUrlEnlace.ts en el conversor, que también filtra el esquema
      // ANTES de llamar a addLink — ver ConversorMarkdownNavegador).
      // Enlace válido: azul + subrayado + url (misma presentación que DOCX). Rechazado
      // (esquema no permitido o URL no absoluta): texto plano — no se pinta como enlace
      // algo que no lo es; el conversor avisa con `urlsRechazadas`.
      const url = validarUrlEnlace(node.url);
      for (const w of node.text.split(/\s+/)) if (w !== '') atoms.push(url ? { text: w, font, sizePt, color: LINK_BLUE, url, underline: true } : { text: w, font, sizePt, color });
    }
  }
  return atoms;
}

// ---------------------------------------------------------------------------
// Bloques -> ítems de flujo vertical (independientes de página)
// ---------------------------------------------------------------------------

function renderParagraphLike(
  inlines: Inline[], sizePt: number, indentPt: number, color: RGB, medir: Medir, lockFont: string | undefined, lineHeightFactor: number
): FlowLine[] {
  const atoms = flattenInline(inlines, sizePt, color, false, false, lockFont);
  const maxWidth = Math.max(CONTENT_WIDTH_PT - indentPt, 20);
  const wrapped = atoms.length > 0 ? wrapAtoms(atoms, maxWidth, medir) : [[]];
  const height = sizePt * lineHeightFactor;
  const xStart = MARGIN_PT + indentPt;
  return wrapped.map((linea, i) => lineToFlowLine(linea, xStart, maxWidth, 'left', i === wrapped.length - 1, height, medir));
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
    const wrapped = atoms.length > 0 ? wrapAtoms(atoms, maxWidth, medir) : [[]];
    const height = BODY_SIZE_PT * LINE_HEIGHT_FACTOR;
    const xStart = MARGIN_PT + textIndent;
    wrapped.forEach((linea, li) => {
      const flow = lineToFlowLine(linea, xStart, maxWidth, 'left', li === wrapped.length - 1, height, medir);
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
    const segs = l.length > 0
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
      // Markdown nunca produce imagen/tabla: solo line/gap/rule (con `bars`) o pagebreak.
      return inner.map((it) => (it.kind === 'line' || it.kind === 'gap' || it.kind === 'rule' ? { ...it, bars: [...it.bars, bar] } : it));
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
        // Markdown nunca produce imagen/tabla, así que solo line/gap/rule tienen `height` aquí en la práctica;
        // la comprobación explícita evita depender de que TS lo infiera desde `FlowItem` entero.
        const tieneAltura = nextFirst && (nextFirst.kind === 'line' || nextFirst.kind === 'gap' || nextFirst.kind === 'rule' || nextFirst.kind === 'image' || nextFirst.kind === 'tableRow');
        const extra = nextGap + (tieneAltura ? nextFirst.height : 0);
        const last = blockItems[blockItems.length - 1]!;
        if (last.kind === 'line') last.keepWithNextHeight = (last.keepWithNextHeight ?? 0) + extra;
      }
    }
    items.push(...blockItems);
  }
  return items;
}

/** URLs de enlaces del documento que NO se pueden convertir en enlace clicable (esquema no permitido o no absoluta), en orden de aparición. */
export function urlsRechazadas(blocks: Block[]): string[] {
  const out: string[] = [];
  const inlines = (nodes: Inline[]): void => {
    for (const n of nodes) {
      if (n.type === 'link') { if (!validarUrlEnlace(n.url)) out.push(n.url); }
      else if (n.type === 'strong' || n.type === 'em') inlines(n.children);
    }
  };
  const lista = (l: ListBlock): void => { for (const it of l.items) { inlines(it.children); if (it.sublist) lista(it.sublist); } };
  const bloques = (bs: Block[]): void => {
    for (const b of bs) {
      if (b.type === 'heading' || b.type === 'paragraph') inlines(b.children);
      else if (b.type === 'list') lista(b);
      else if (b.type === 'blockquote') bloques(b.children);
    }
  };
  bloques(blocks);
  return out;
}

export function layoutMarkdown(blocks: Block[], medir: Medir): ResultadoLayout {
  if (blocks.length === 0) return { totalPaginas: 1, trazos: [], barras: [], imagenes: [], enlaces: [], enlacesAncla: [], marcadores: new Map(), advertencias: [], paginas: [{ geo: PAGE_GEOMETRY, seccion: 0 }] };
  const items = renderBlocksFlat(blocks, 0, medir, true, BLACK);
  return paginarFlujo(items, PAGE_GEOMETRY, BASELINE_FRACTION);
}

/** Color usado para el texto dentro de una cita — exportado solo para los tests de sangría/estilo. */
export const QUOTE_TEXT_COLOR = QUOTE_GRAY_TEXT;
