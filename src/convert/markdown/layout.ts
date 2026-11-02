import type { Block, Inline, ListBlock, TablaAlineacion } from './ast';
import { validarUrlEnlace } from '../../engine/validarUrlEnlace';
import { aproximado, omitido, type Advertencia } from '../advertencia';
import { textoPlano, slugTitulo } from './texto';
import {
  wrapAtoms, lineToFlowLine, paginar as paginarFlujo,
  type Atom, type RGB, type Medir, type FlowItem, type FlowLine, type FlowTableRow, type RelBarra, type RelLinea,
  type BarSeg, type BgSeg, type Seg, type ResultadoLayout, type PageGeometry
} from '../flujo/layout';

/**
 * Maquetador PURO: del AST de `parse.ts` a páginas A4 con una lista plana de
 * "trazos de texto" (uno por palabra o marcador de lista) y "barras"
 * (rectángulos rellenos: reglas horizontales, fondo de bloques de código,
 * barra de cita, bordes y fondo de tablas) en puntos PDF, listos para
 * `insertText`/`fillRect`.
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
 * módulo solo aporta lo específico de Markdown y siempre pide alineación
 * `left` (salvo las celdas de tabla, que siguen la alineación de su columna).
 *
 * Estilo (fijado por el dueño, no configurable en esta fase): cuerpo
 * Helvetica 11pt/interlineado 1.4; H1 22, H2 17, H3 14, H4-H6 12, todos
 * Helvetica-Bold; código Courier 10 con fondo gris; cita con sangría y barra
 * gris; listas con viñeta/número y sangría francesa; enlaces en azul.
 *
 * E-119 (fidelidad): enlaces externos (anotación `/Link`, URI validada con
 * `validarUrlEnlace`) e internos `#titulo` (resueltos a la página y altura del
 * título); títulos con su identificador (`slug`) para el outline del PDF;
 * tablas GFM; imágenes `data:` incrustadas; tachado; saltos duros; notas al
 * pie al final del documento; y NADA se pierde en silencio: lo que las fuentes
 * estándar no pueden pintar (emoji, CJK), el HTML en línea, las imágenes no
 * incrustables y los enlaces que no se pueden convertir salen en
 * `ResultadoMarkdown.advertencias`.
 *
 * Limitaciones conocidas:
 * - La línea base se aproxima con `BASELINE_FRACTION` (fracción fija de la
 *   altura de línea), no con el ascenso/descenso real de la fuente.
 * - Un ítem de lista es una sola línea lógica (más su sublista).
 * - Dentro de un encabezado, la negrita/cursiva del Markdown original se
 *   ignora (el encabezado entero se pinta en Helvetica-Bold al tamaño de su
 *   nivel).
 * - Las imágenes solo se incrustan como bloque propio de un párrafo (no
 *   dentro de listas, tablas ni encabezados: ahí se muestra su texto
 *   alternativo y se avisa).
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

const TABLA_PAD_X_PT = 5;
const TABLA_PAD_Y_PT = 3;
const TABLA_LINE_HEIGHT_FACTOR = 1.3;
const TABLA_BORDE_PT = 0.5;

const BLACK: RGB = [0, 0, 0];
const LINK_BLUE: RGB = [37, 99, 235];
const QUOTE_GRAY_TEXT: RGB = [90, 90, 90];
const QUOTE_BAR_GRAY: RGB = [170, 170, 170];
const HR_GRAY: RGB = [190, 190, 190];
const CODE_BG_GRAY: RGB = [240, 240, 240];
const CODE_TEXT_GRAY: RGB = [40, 40, 40];
const TABLA_BORDE_GRIS: RGB = [180, 180, 180];
const TABLA_CABECERA_GRIS: RGB = [235, 235, 235];

// ---------------------------------------------------------------------------
// Resultado, contexto y texto representable
// ---------------------------------------------------------------------------

export interface TituloColocado { nivel: 1 | 2 | 3 | 4 | 5 | 6; texto: string; id: string; page: number; yPt: number }
/** Enlace interno ya resuelto: caja del texto (pt PDF) y destino (página 0-based + altura del borde superior del título). */
export interface EnlaceInternoMd { page: number; xPt: number; yPt: number; wPt: number; hPt: number; destPage: number; destYPt: number }
/** `layoutMarkdown` devuelve el resultado genérico más lo propio de Markdown; `advertencias` ya contiene TODOS los avisos del documento. */
export type ResultadoMarkdown = ResultadoLayout & { titulos: TituloColocado[]; enlacesInternos: EnlaceInternoMd[] };
export interface OpcionesLayoutMarkdown {
  /** Imágenes incrustables por `src` (data: ya decodificada por el conversor): tamaño intrínseco en px. Sin entrada = no se incrusta. */
  imagenes?: Map<string, { width: number; height: number }>;
}

interface Ctx {
  medir: Medir;
  imagenes: Map<string, { width: number; height: number }>;
  /** Caracteres sin glifo en las fuentes estándar → sustituidos por "?". */
  sinGlifo: Set<string>;
  rechazadas: string[];
  htmlEtiquetas: number;
  imagenesOmitidas: string[];
  idDeTitulo: WeakMap<object, string>;
  titulos: { nivel: 1 | 2 | 3 | 4 | 5 | 6; texto: string; id: string }[];
  /** id de nota → número (orden de primera referencia). */
  numeroNota: Map<string, number>;
  refsVistas: Set<number>;
  avisos: Advertencia[];
}

/** Caracteres fuera de Latin-1 que WinAnsi (las fuentes estándar del PDF) sí representa. */
const WINANSI_EXTRA = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);
/** Marcas invisibles (unión de emoji, selectores de variación...): se descartan sin aviso. */
function esInvisible(cp: number): boolean {
  return (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x2060 || cp === 0xfeff || cp === 0x00ad;
}

/**
 * Deja solo lo que las fuentes estándar saben pintar. Lo demás (emoji, CJK, símbolos...) se sustituye por UN "?" por
 * racha y se anota en `ctx.sinGlifo` para avisar: sin esto el motor lo escribe truncado a un carácter cualquiera
 * (p. ej. un emoji salía como "ÿ"), una corrupción silenciosa.
 */
function limpiarTexto(ctx: Ctx, s: string): string {
  let out = '';
  let enRacha = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (esInvisible(cp)) continue;
    if (cp === 0x09) { out += ' '; enRacha = false; continue; }
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRA.has(cp)) { out += ch; enRacha = false; continue; }
    if (cp < 0x20 || cp === 0x7f) continue;
    ctx.sinGlifo.add(ch);
    if (!enRacha) out += '?';
    enRacha = true;
  }
  return out;
}

const RE_HTML = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>|<!--/g;

// ---------------------------------------------------------------------------
// Inline -> átomos (palabras con su propio estilo)
// ---------------------------------------------------------------------------

function bodyFontFor(bold: boolean, italic: boolean): string {
  if (bold && italic) return 'Helvetica-BoldOblique';
  if (bold) return 'Helvetica-Bold';
  if (italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

interface Estilo {
  sizePt: number; color: RGB; bold: boolean; italic: boolean; lockFont?: string; strike?: boolean;
  /** Enlace que cubre estos nodos: externo (`url`) o interno (`ancla`). */
  url?: string; ancla?: string; underline?: boolean;
  /** Marcadores a colgar del PRIMER átomo (títulos). */
  marcas?: string[];
}

/** Acumulador: líneas "duras" (separadas por `br`) de átomos, y si lo último emitido terminó en blanco (para decidir `pegado`). */
interface Acum { tramos: Atom[][]; finBlanco: boolean; marcasPend: string[] | undefined; permitirImagenes: boolean }

function nuevoAcum(marcas: string[] | undefined): Acum {
  return { tramos: [[]], finBlanco: true, marcasPend: marcas, permitirImagenes: false };
}

function empujar(acc: Acum, a: Atom): void {
  const tramo = acc.tramos[acc.tramos.length - 1]!;
  if (acc.marcasPend) { a.marcas = acc.marcasPend; acc.marcasPend = undefined; }
  tramo.push(a);
}

function estiloLink(ctx: Ctx, node: Extract<Inline, { type: 'link' }>, est: Estilo): Estilo {
  if (node.url.startsWith('#')) {
    let frag = node.url.slice(1);
    try { frag = decodeURIComponent(frag); } catch { /* se deja tal cual */ }
    return { ...est, color: LINK_BLUE, underline: true, ancla: frag.toLowerCase(), url: undefined };
  }
  const url = validarUrlEnlace(node.url);
  if (url) return { ...est, color: LINK_BLUE, underline: true, url, ancla: undefined };
  ctx.rechazadas.push(node.url);
  return est;
}

function marcadorImagen(ctx: Ctx, node: Extract<Inline, { type: 'image' }>): string {
  if (!ctx.imagenesOmitidas.includes(node.src)) ctx.imagenesOmitidas.push(node.src);
  return node.alt ? `[${node.alt}]` : '[imagen]';
}

/**
 * Aplana el árbol de inlines en palabras sueltas con su fuente/color ya resueltos, repartidas en "tramos" (cada `br`
 * abre uno). Una palabra que sigue a otra SIN espacio en el original (`**negrita**,`) se marca `pegado`.
 */
function aplanar(ctx: Ctx, nodes: Inline[], est: Estilo, acc: Acum): void {
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'code') {
      const crudo = node.text;
      if (node.type === 'text') { const m = crudo.match(RE_HTML); if (m) ctx.htmlEtiquetas += m.length; }
      const font = node.type === 'code' ? 'Courier' : (est.lockFont ?? bodyFontFor(est.bold, est.italic));
      const texto = limpiarTexto(ctx, crudo);
      const empiezaBlanco = /^\s/.test(texto);
      const palabras = texto.split(/\s+/).filter((w) => w !== '');
      palabras.forEach((w, k) => {
        const pegado = k === 0 ? (!empiezaBlanco && !acc.finBlanco) : false;
        const a: Atom = { text: w, font, sizePt: est.sizePt, color: est.color };
        if (pegado) a.pegado = true;
        if (est.url) a.url = est.url;
        if (est.ancla !== undefined) a.ancla = est.ancla;
        if (est.underline) a.underline = true;
        if (est.strike) a.strike = 1;
        empujar(acc, a);
      });
      if (palabras.length > 0) acc.finBlanco = /\s$/.test(texto);
      else if (texto.length > 0) acc.finBlanco = true; // solo blancos
    } else if (node.type === 'strong') {
      aplanar(ctx, node.children, { ...est, bold: true }, acc);
    } else if (node.type === 'em') {
      aplanar(ctx, node.children, { ...est, italic: true }, acc);
    } else if (node.type === 'del') {
      aplanar(ctx, node.children, { ...est, strike: true }, acc);
    } else if (node.type === 'link') {
      aplanar(ctx, node.children ?? [{ type: 'text', text: node.text }], estiloLink(ctx, node, est), acc);
    } else if (node.type === 'br') {
      acc.tramos.push([]);
      acc.finBlanco = true;
    } else if (node.type === 'image') {
      aplanar(ctx, [{ type: 'text', text: marcadorImagen(ctx, node) }], { ...est, italic: true }, acc);
    } else if (node.type === 'footnote') {
      const n = ctx.numeroNota.get(node.id);
      if (n === undefined) continue;
      const a: Atom = { text: String(n), font: 'Helvetica', sizePt: est.sizePt * 0.7, color: LINK_BLUE, pegado: true, dyPt: est.sizePt * 0.35, sizeLineaPt: est.sizePt, ancla: `\u0000nota-${n}` };
      if (!ctx.refsVistas.has(n)) { ctx.refsVistas.add(n); a.marcas = [`\u0000ref-${n}`]; }
      if (acc.marcasPend) { a.marcas = [...(a.marcas ?? []), ...acc.marcasPend]; acc.marcasPend = undefined; }
      acc.tramos[acc.tramos.length - 1]!.push(a);
      acc.finBlanco = false;
    }
  }
}

/** Parte en trozos las palabras más anchas que `maxWidthPt` (URL largas...): `wrapAtoms` no parte palabras y se saldrían del margen. */
function trocear(atoms: Atom[], maxWidthPt: number, medir: Medir): Atom[] {
  const out: Atom[] = [];
  for (const a of atoms) {
    if (a.text.length < 2 || medir(a.font, a.sizePt, a.text) <= maxWidthPt) { out.push(a); continue; }
    const chars = Array.from(a.text);
    let desde = 0;
    let primero = true;
    while (desde < chars.length) {
      let hasta = desde + 1;
      while (hasta < chars.length && medir(a.font, a.sizePt, chars.slice(desde, hasta + 1).join('')) <= maxWidthPt) hasta++;
      const trozo: Atom = { ...a, text: chars.slice(desde, hasta).join('') };
      // Los trozos siguientes van pegados al anterior (si cambian de línea el espacio no cuenta) y no repiten los marcadores.
      if (!primero) { trozo.pegado = true; delete trozo.marcas; }
      primero = false;
      out.push(trozo);
      desde = hasta;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bloques -> ítems de flujo vertical (independientes de página)
// ---------------------------------------------------------------------------

/** Líneas de un texto en línea (con saltos duros), ajustado a `maxWidth` desde `xStart`. `marcas` cuelgan del primer átomo (o de la primera línea si no hay texto). */
function lineasDeInline(
  ctx: Ctx, inlines: Inline[], est: Estilo, xStart: number, maxWidth: number, lineHeight: number
): FlowLine[] {
  const acc = nuevoAcum(est.marcas);
  aplanar(ctx, inlines, { ...est, marcas: undefined }, acc);
  const out: FlowLine[] = [];
  for (const tramo of acc.tramos) {
    const atoms = trocear(tramo, maxWidth, ctx.medir);
    const wrapped = atoms.length > 0 ? wrapAtoms(atoms, maxWidth, ctx.medir) : [[]];
    wrapped.forEach((linea, i) => out.push(lineToFlowLine(linea, xStart, maxWidth, 'left', i === wrapped.length - 1, lineHeight, ctx.medir)));
  }
  if (acc.marcasPend && out[0]) out[0].marcas = [...(out[0].marcas ?? []), ...acc.marcasPend]; // sin texto: la marca cae en la línea
  return out;
}

function renderParagraphLike(
  ctx: Ctx, inlines: Inline[], sizePt: number, indentPt: number, color: RGB, lockFont: string | undefined, lineHeightFactor: number, marcas?: string[]
): FlowLine[] {
  const maxWidth = Math.max(CONTENT_WIDTH_PT - indentPt, 20);
  return lineasDeInline(ctx, inlines, { sizePt, color, bold: false, italic: false, lockFont, marcas }, MARGIN_PT + indentPt, maxWidth, sizePt * lineHeightFactor);
}

function renderParagraph(ctx: Ctx, children: Inline[], indentPt: number, color: RGB): FlowItem[] {
  // Las imágenes sueltas de un párrafo son bloques propios: el texto antes y después se maqueta como párrafos aparte.
  const items: FlowItem[] = [];
  let tramo: Inline[] = [];
  const vaciar = (): void => {
    if (tramo.length === 0) return;
    if (tramo.some((n) => !(n.type === 'text' && n.text.trim() === ''))) items.push(...renderParagraphLike(ctx, tramo, BODY_SIZE_PT, indentPt, color, undefined, LINE_HEIGHT_FACTOR));
    tramo = [];
  };
  for (const n of children) {
    const dim = n.type === 'image' ? ctx.imagenes.get(n.src) : undefined;
    if (n.type === 'image' && dim) {
      vaciar();
      const maxW = CONTENT_WIDTH_PT - indentPt;
      const maxH = PAGE_HEIGHT_PT - MARGIN_PT * 2 - 4;
      const escala = Math.min(1, (0.75 * dim.width) > 0 ? maxW / (0.75 * dim.width) : 1, (0.75 * dim.height) > 0 ? maxH / (0.75 * dim.height) : 1);
      const wPt = Math.max(1, 0.75 * dim.width * escala);
      const hPt = Math.max(1, 0.75 * dim.height * escala);
      if (items.length > 0) items.push({ kind: 'gap', height: 4, bars: [] });
      items.push({ kind: 'image', height: hPt, xPt: MARGIN_PT + indentPt, wPt, imgId: n.src });
    } else {
      tramo.push(n);
    }
  }
  vaciar();
  return items.length > 0 ? items : [lineToFlowLine([], MARGIN_PT + indentPt, 20, 'left', true, BODY_SIZE_PT * LINE_HEIGHT_FACTOR, ctx.medir)];
}

function renderList(ctx: Ctx, list: ListBlock, indentPt: number, color: RGB, marcasDeItem?: (idx: number) => string[] | undefined, tam: number = BODY_SIZE_PT): FlowItem[] {
  const items: FlowItem[] = [];
  let n = list.start ?? 1;
  list.items.forEach((item, idx) => {
    if (idx > 0) items.push({ kind: 'gap', height: list.loose ? 8 : 2, bars: [] });
    const marker = item.task !== undefined ? (item.task ? '[x]' : '[ ]') : list.ordered ? `${n}.` : '•';
    n++;
    const textIndent = indentPt + HANGING_INDENT_PT;
    const maxWidth = Math.max(CONTENT_WIDTH_PT - textIndent, 20);
    const lineas = lineasDeInline(ctx, item.children, { sizePt: tam, color, bold: false, italic: false }, MARGIN_PT + textIndent, maxWidth, tam * LINE_HEIGHT_FACTOR);
    const marcas = marcasDeItem?.(idx);
    const seg: Seg = { xPt: MARGIN_PT + indentPt, text: marker, font: 'Helvetica', sizePt: tam, color };
    if (marcas) seg.marcas = marcas;
    if (lineas.length === 0) lineas.push(lineToFlowLine([], MARGIN_PT + textIndent, maxWidth, 'left', true, tam * LINE_HEIGHT_FACTOR, ctx.medir));
    lineas[0]!.segs.unshift(seg);
    items.push(...lineas);
    if (item.sublist) {
      items.push({ kind: 'gap', height: 3, bars: [] });
      items.push(...renderList(ctx, item.sublist, indentPt + LIST_INDENT_PT, color, undefined, tam));
    }
  });
  return items;
}

function renderCode(ctx: Ctx, block: { text: string }, indentPt: number): FlowItem[] {
  const height = CODE_SIZE_PT * LINE_HEIGHT_FACTOR;
  const bg: BgSeg = { xPt: MARGIN_PT + indentPt, wPt: CONTENT_WIDTH_PT - indentPt, color: CODE_BG_GRAY };
  // Courier es monoespaciada: las líneas más anchas que el recuadro se parten por caracteres en vez de salirse del margen.
  const charW = ctx.medir('Courier', CODE_SIZE_PT, 'M');
  const maxChars = charW > 0 ? Math.max(8, Math.floor((CONTENT_WIDTH_PT - indentPt - CODE_PAD_X_PT * 2) / charW)) : 80;
  const lines: string[] = [];
  for (const cruda of (block.text.length > 0 ? block.text.split('\n') : [''])) {
    const l = limpiarTexto(ctx, cruda.replace(/\t/g, '    '));
    if (l.length <= maxChars) { lines.push(l); continue; }
    for (let i = 0; i < l.length; i += maxChars) lines.push(l.slice(i, i + maxChars));
  }
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

/** Tabla GFM: filas atómicas con borde de rejilla, cabecera sombreada y repetida en cada página, columna alineada según el delimitador. */
function renderTable(ctx: Ctx, block: Extract<Block, { type: 'table' }>, indentPt: number, color: RGB): FlowItem[] {
  const n = block.align.length;
  const x0 = MARGIN_PT + indentPt;
  const ancho = CONTENT_WIDTH_PT - indentPt;
  const tam = BODY_SIZE_PT;
  const alto = tam * TABLA_LINE_HEIGHT_FACTOR;
  const hoja = (celdas: Inline[][], esCab: boolean): Atom[][][] => celdas.map((c) => {
    const acc = nuevoAcum(undefined);
    aplanar(ctx, c, { sizePt: tam, color, bold: false, italic: false, lockFont: esCab ? 'Helvetica-Bold' : undefined }, acc);
    return acc.tramos;
  });
  const filas: { celdas: Atom[][][]; esCab: boolean }[] = [{ celdas: hoja(block.header, true), esCab: true }, ...block.rows.map((r) => ({ celdas: hoja(r, false), esCab: false }))];

  // Anchos: el natural (texto en una línea) si todo cabe; si no, reparto proporcional a lo que cada columna "puede ceder" sobre su mínimo (palabra más larga).
  const natural = new Array<number>(n).fill(0);
  const minimo = new Array<number>(n).fill(0);
  const espacio = (a: Atom): number => ctx.medir(a.font, a.sizePt, ' ');
  for (const f of filas) f.celdas.forEach((tramos, k) => {
    for (const t of tramos) {
      let w = 0;
      t.forEach((a, i) => { w += ctx.medir(a.font, a.sizePt, a.text) + (i > 0 && !a.pegado ? espacio(a) : 0); minimo[k] = Math.max(minimo[k]!, ctx.medir(a.font, a.sizePt, a.text)); });
      natural[k] = Math.max(natural[k]!, w);
    }
  });
  const pad = TABLA_PAD_X_PT * 2;
  let anchos = natural.map((w) => Math.max(24, w + pad));
  const suma = anchos.reduce((s, w) => s + w, 0);
  if (suma > ancho) {
    const mins = minimo.map((w) => Math.max(24, Math.min(w + pad, ancho / n)));
    const sumaMins = mins.reduce((s, w) => s + w, 0);
    if (sumaMins >= ancho) anchos = mins.map((w) => (w / sumaMins) * ancho);
    else {
      const sobra = ancho - sumaMins;
      const cede = anchos.map((w, k) => Math.max(0, w - mins[k]!));
      const totalCede = cede.reduce((s, w) => s + w, 0) || 1;
      anchos = mins.map((w, k) => w + (cede[k]! / totalCede) * sobra);
    }
  }
  const xCol: number[] = [x0];
  for (const w of anchos) xCol.push(xCol[xCol.length - 1]! + w);
  const xFin = xCol[n]!;

  const maxFilaPt = PAGE_HEIGHT_PT - MARGIN_PT * 2 - 8;
  const maxLineas = Math.max(1, Math.floor((maxFilaPt - TABLA_PAD_Y_PT * 2) / alto));
  const filasFlow: FlowTableRow[] = [];
  let partidas = 0;

  const armar = (cel: FlowLine[][], esCab: boolean, esPrimera: boolean, esUltima: boolean): FlowTableRow => {
    const nLineas = Math.max(1, ...cel.map((l) => l.length));
    const altura = nLineas * alto + TABLA_PAD_Y_PT * 2;
    const lineas: RelLinea[] = [];
    cel.forEach((ls) => ls.forEach((l, i) => lineas.push({ relYPt: TABLA_PAD_Y_PT + i * alto + alto * (1 - BASELINE_FRACTION), segs: l.segs })));
    const bordes: RelBarra[] = [];
    if (esPrimera) bordes.push({ relYPt: 0, hPt: TABLA_BORDE_PT, xPt: x0, wPt: xFin - x0, color: TABLA_BORDE_GRIS });
    if (esUltima) bordes.push({ relYPt: altura - TABLA_BORDE_PT, hPt: TABLA_BORDE_PT, xPt: x0, wPt: xFin - x0, color: TABLA_BORDE_GRIS });
    for (let k = 0; k <= n; k++) bordes.push({ relYPt: 0, hPt: altura, xPt: Math.min(xCol[k]!, xFin - TABLA_BORDE_PT), wPt: TABLA_BORDE_PT, color: TABLA_BORDE_GRIS });
    const fondos: RelBarra[] = esCab ? [{ relYPt: 0, hPt: altura, xPt: x0, wPt: xFin - x0, color: TABLA_CABECERA_GRIS }] : [];
    return { kind: 'tableRow', height: altura, lineas, fondos, bordes, esEncabezado: esCab };
  };

  const alineacion = (a: TablaAlineacion): 'left' | 'center' | 'right' => a ?? 'left';
  const cabeceras: FlowTableRow[] = [];
  filas.forEach((f, i) => {
    const celdas: FlowLine[][] = f.celdas.map((tramos, k) => {
      const maxW = Math.max(10, anchos[k]! - pad);
      const out: FlowLine[] = [];
      for (const t of tramos) {
        const atoms = trocear(t, maxW, ctx.medir);
        const wrapped = atoms.length > 0 ? wrapAtoms(atoms, maxW, ctx.medir) : [[]];
        wrapped.forEach((linea) => out.push(lineToFlowLine(linea, xCol[k]! + TABLA_PAD_X_PT, maxW, alineacion(block.align[k] ?? null), true, alto, ctx.medir)));
      }
      return out;
    });
    const esUltimaFila = i === filas.length - 1;
    const max = Math.max(1, ...celdas.map((l) => l.length));
    if (max > maxLineas) {
      partidas++;
      const trozos = Math.ceil(max / maxLineas);
      for (let t = 0; t < trozos; t++) {
        const parte = celdas.map((l) => l.slice(t * maxLineas, (t + 1) * maxLineas));
        filasFlow.push(armar(parte, false, t === 0 && i === 0, t === trozos - 1 && esUltimaFila));
      }
      return;
    }
    const fila = armar(celdas, f.esCab, i === 0, esUltimaFila);
    filasFlow.push(fila);
    if (f.esCab) cabeceras.push(fila);
  });
  if (partidas > 0) ctx.avisos.push(aproximado(partidas === 1 ? 'Una fila de tabla era más alta que una página y se partió por líneas entre páginas.' : `${partidas} filas de tabla eran más altas que una página y se partieron por líneas entre páginas.`));
  return [{ kind: 'tableStart', headerRows: cabeceras }, ...filasFlow, { kind: 'tableEnd' }];
}

/** Separación vertical (pt) antes de `type`, sabiendo el tipo del bloque anterior (`null` si es el primero del documento). */
function spacingBefore(prevType: Block['type'] | null, type: Block['type']): number {
  if (prevType === null) return 0;
  if (type === 'footnotes') return 18;
  if (type === 'heading') return 16;
  if (prevType === 'heading') return 6;
  return 8;
}

function renderBlock(ctx: Ctx, block: Block, indentPt: number, color: RGB): FlowItem[] {
  switch (block.type) {
    case 'heading': {
      const id = ctx.idDeTitulo.get(block) ?? '';
      ctx.titulos.push({ nivel: block.level, texto: textoPlano(block.children), id });
      return renderParagraphLike(ctx, block.children, HEADING_SIZES_PT[block.level], indentPt, color, 'Helvetica-Bold', HEADING_LINE_HEIGHT_FACTOR, id ? [id] : undefined);
    }
    case 'paragraph':
      return renderParagraph(ctx, block.children, indentPt, color);
    case 'list':
      return renderList(ctx, block, indentPt, color);
    case 'blockquote': {
      const inner = renderBlocksFlat(ctx, block.children, indentPt + QUOTE_INDENT_PT, false, QUOTE_GRAY_TEXT);
      const bar: BarSeg = { xPt: MARGIN_PT + indentPt, wPt: QUOTE_BAR_WIDTH_PT, color: QUOTE_BAR_GRAY };
      return inner.map((it) => (it.kind === 'line' || it.kind === 'gap' || it.kind === 'rule' ? { ...it, bars: [...it.bars, bar] } : it));
    }
    case 'code':
      return renderCode(ctx, block, indentPt);
    case 'hr':
      return [{ kind: 'rule', height: HR_BLOCK_HEIGHT_PT, xPt: MARGIN_PT + indentPt, wPt: CONTENT_WIDTH_PT - indentPt, color: HR_GRAY, bars: [] }];
    case 'table':
      return renderTable(ctx, block, indentPt, color);
    case 'footnotes': {
      const lista: ListBlock = { type: 'list', ordered: true, items: block.items.map((it) => ({ children: it.children })) };
      const regla: FlowItem = { kind: 'rule', height: HR_BLOCK_HEIGHT_PT, xPt: MARGIN_PT + indentPt, wPt: (CONTENT_WIDTH_PT - indentPt) / 3, color: HR_GRAY, bars: [] };
      return [regla, ...renderList(ctx, lista, indentPt, color, (idx) => [`\u0000nota-${idx + 1}`], 10)];
    }
  }
}

/**
 * Renderiza una secuencia de bloques al flujo vertical, con la separación
 * entre bloques ya insertada. `widowGuard`: si es `true` (solo el nivel
 * superior del documento), ata a la ÚLTIMA línea de cada encabezado cuánta
 * altura extra hace falta detrás (separación + primer ítem del bloque
 * siguiente) para que `paginar` no lo deje huérfano al pie de página.
 */
function renderBlocksFlat(ctx: Ctx, blocks: Block[], indentPt: number, widowGuard: boolean, color: RGB = BLACK): FlowItem[] {
  const items: FlowItem[] = [];
  // Cada bloque se renderiza UNA sola vez, en orden (el render anota avisos, títulos y primeras referencias de notas).
  const renderizados = blocks.map((b) => renderBlock(ctx, b, indentPt, color));
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (i > 0) items.push({ kind: 'gap', height: spacingBefore(blocks[i - 1]!.type, block.type), bars: [] });
    const blockItems = renderizados[i]!;
    if (widowGuard && block.type === 'heading' && blockItems.length > 0) {
      const next = blocks[i + 1];
      if (next) {
        const nextGap = spacingBefore(block.type, next.type);
        const nextFirst = renderizados[i + 1]![0];
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

/** URLs de enlaces del documento que NO se pueden convertir en enlace clicable (esquema no permitido o no absoluta; los `#ancla` internos no cuentan), en orden de aparición. */
export function urlsRechazadas(blocks: Block[]): string[] {
  const out: string[] = [];
  const inlines = (nodes: Inline[]): void => {
    for (const n of nodes) {
      if (n.type === 'link') { if (!n.url.startsWith('#') && !validarUrlEnlace(n.url)) out.push(n.url); if (n.children) inlines(n.children); }
      else if (n.type === 'strong' || n.type === 'em' || n.type === 'del') inlines(n.children);
    }
  };
  const lista = (l: ListBlock): void => { for (const it of l.items) { inlines(it.children); if (it.sublist) lista(it.sublist); } };
  const bloques = (bs: Block[]): void => {
    for (const b of bs) {
      if (b.type === 'heading' || b.type === 'paragraph') inlines(b.children);
      else if (b.type === 'list') lista(b);
      else if (b.type === 'blockquote') bloques(b.children);
      else if (b.type === 'table') { b.header.forEach(inlines); b.rows.forEach((r) => r.forEach(inlines)); }
      else if (b.type === 'footnotes') b.items.forEach((it) => inlines(it.children));
    }
  };
  bloques(blocks);
  return out;
}

/** Asigna a cada encabezado su identificador único (estilo GitHub: `hola-mundo`, `hola-mundo-1`...), en orden de documento. */
function asignarIds(blocks: Block[], ids: WeakMap<object, string>, usados: Map<string, number>): void {
  for (const b of blocks) {
    if (b.type === 'heading') {
      const base = slugTitulo(textoPlano(b.children)) || 'titulo';
      const veces = usados.get(base) ?? 0;
      usados.set(base, veces + 1);
      ids.set(b, veces === 0 ? base : `${base}-${veces}`);
    } else if (b.type === 'blockquote') {
      asignarIds(b.children, ids, usados);
    }
  }
}

const resumirSrc = (s: string): string => (s.length > 48 ? `${s.slice(0, 45)}...` : s);

export function layoutMarkdown(blocks: Block[], medir: Medir, opciones?: OpcionesLayoutMarkdown): ResultadoMarkdown {
  const vacio = (): ResultadoMarkdown => ({ totalPaginas: 1, trazos: [], barras: [], imagenes: [], enlaces: [], enlacesAncla: [], marcadores: new Map(), advertencias: [], paginas: [{ geo: PAGE_GEOMETRY, seccion: 0 }], titulos: [], enlacesInternos: [] });
  if (blocks.length === 0) return vacio();
  const ctx: Ctx = {
    medir, imagenes: opciones?.imagenes ?? new Map(), sinGlifo: new Set(), rechazadas: [], htmlEtiquetas: 0, imagenesOmitidas: [],
    idDeTitulo: new WeakMap(), titulos: [], numeroNota: new Map(), refsVistas: new Set(), avisos: []
  };
  asignarIds(blocks, ctx.idDeTitulo, new Map());
  for (const b of blocks) if (b.type === 'footnotes') b.items.forEach((it, k) => ctx.numeroNota.set(it.id, k + 1));
  const items = renderBlocksFlat(ctx, blocks, 0, true, BLACK);
  const res = paginarFlujo(items, PAGE_GEOMETRY, BASELINE_FRACTION);

  // Enlaces internos: con los marcadores ya colocados, cada `#ancla` se resuelve a la página y altura del título.
  const enlacesInternos: EnlaceInternoMd[] = [];
  const rotos: string[] = [];
  for (const e of res.enlacesAncla) {
    const m = res.marcadores.get(e.ancla);
    if (m) enlacesInternos.push({ page: e.page, xPt: e.xPt, yPt: e.yPt, wPt: e.wPt, hPt: e.hPt, destPage: m.page, destYPt: m.yPt });
    else if (!rotos.includes(e.ancla)) rotos.push(e.ancla);
  }
  const titulos: TituloColocado[] = ctx.titulos.map((t) => {
    const pos = res.marcadores.get(t.id);
    return { ...t, page: pos?.page ?? 0, yPt: pos?.yPt ?? PAGE_HEIGHT_PT - MARGIN_PT };
  });

  // Avisos: nada se pierde en silencio.
  const avisos: Advertencia[] = [...ctx.avisos];
  if (ctx.sinGlifo.size > 0) {
    const lista = [...ctx.sinGlifo];
    const mostrados = lista.slice(0, 12).join(' ');
    avisos.push(aproximado(`${lista.length === 1 ? 'Un carácter no existe' : `${lista.length} caracteres no existen`} en las fuentes estándar del PDF (emoji, CJK u otros símbolos) y se sustituyeron por "?": ${mostrados}${lista.length > 12 ? ` y ${lista.length - 12} más` : ''}.`));
  }
  if (ctx.htmlEtiquetas > 0) avisos.push(aproximado(`El documento contiene HTML en línea (${ctx.htmlEtiquetas} ${ctx.htmlEtiquetas === 1 ? 'etiqueta' : 'etiquetas'}): no se interpreta, se muestra como texto.`));
  const urls = [...new Set(ctx.rechazadas)];
  for (const u of urls) avisos.push(aproximado(`El enlace "${u}" no se convirtió en enlace clicable (solo se admiten http:, https: y mailto:, o #título dentro del documento); el texto se conserva.`));
  for (const a of rotos) avisos.push(aproximado(`El enlace interno "#${a}" no apunta a ningún título del documento; el texto se conserva sin enlace.`));
  const noIncrustadas = ctx.imagenesOmitidas.filter((s) => !ctx.imagenes.has(s) || !res.imagenes.some((i) => i.imgId === s));
  if (noIncrustadas.length > 0) {
    avisos.push(omitido(`${noIncrustadas.length === 1 ? 'Una imagen no se incrustó' : `${noIncrustadas.length} imágenes no se incrustaron`} (solo se incrustan imágenes data: PNG o JPEG válidas, como bloque propio de un párrafo; no se descargan ni se leen archivos externos): ${noIncrustadas.slice(0, 5).map((s) => `"${resumirSrc(s)}"`).join(', ')}${noIncrustadas.length > 5 ? ` y ${noIncrustadas.length - 5} más` : ''}. Se muestra su texto alternativo.`));
  }
  return { ...res, advertencias: [...avisos, ...res.advertencias], titulos, enlacesInternos };
}

/** Color usado para el texto dentro de una cita — exportado solo para los tests de sangría/estilo. */
export const QUOTE_TEXT_COLOR = QUOTE_GRAY_TEXT;
