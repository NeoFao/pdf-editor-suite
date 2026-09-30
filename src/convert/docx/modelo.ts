import { DocxError } from './DocxError';
import { parseXml, hijosElemento, primerHijo, textoDirecto, buscarDescendiente, type XmlElemento } from './xml';
import { classifyFont } from '../../engine/fontClassify';
import { leerRelaciones, rutaMediaDesdeWord, type Relacion } from './rels';
import { validarUrlEnlace } from '../../engine/validarUrlEnlace';

/**
 * Modelo del documento DOCX (§9 fila #4): de `word/document.xml` +
 * `word/styles.xml` (+ `word/numbering.xml`/`word/_rels/document.xml.rels`
 * si existen) a una lista plana de BLOQUES (párrafos y tablas) con su
 * formato ya resuelto (herencia de estilos incluida) y la geometría de
 * página. PURO: no toca el motor ni el DOM, igual que `../markdown/parse.ts`
 * — tampoco decodifica píxeles de imagen, solo deja la referencia
 * (`ParteParrafo` de tipo `'imagen'`, `refId` = ruta dentro del ZIP) para que
 * `ConversorDocxNavegador` la resuelva de forma asíncrona con
 * `decodificarImagenDocx`. `render.ts` convierte este modelo en `FlowItem`
 * para el maquetador común (`../flujo/layout.ts`).
 *
 * Unidades DOCX, documentadas aquí porque se mezclan en todo el módulo
 * (AGENTS.md §1: "escribe en el comentario en qué unidad está cada número"):
 * - Twips (1/20 pt): `w:ind`, `w:spacing`, `w:pgSz`, `w:pgMar`, `w:tblGrid`. `twipsAPt()`.
 * - Medios puntos: `w:sz` de fuente (`w:rPr`). `mediosPuntosAPt()`.
 * - Octavos de punto: `w:sz` de BORDE (`w:tblBorders`) — unidad distinta de
 *   la de fuente pese al mismo nombre de atributo; dividir entre 8 (no 2).
 * - EMU (1/914400 de pulgada = 1/12700 de punto): `wp:extent` (tamaño de
 *   imagen inline). `EMU_POR_PUNTO`.
 *
 * Simplificaciones deliberadas de esta FASE 2a (documentadas también en el
 * spec y en la fila #4 de la tabla §9):
 * - Solo se usa la geometría de página de la ÚLTIMA sección del documento
 *   (`w:sectPr`) para TODO el documento — un .docx con secciones de tamaño
 *   distinto (algo raro) se aplana a una sola geometría.
 * - El ajuste de línea usa el ancho de sangría NORMAL del párrafo para
 *   TODAS sus líneas, incluida la primera — el efecto de
 *   `w:firstLine`/`w:hanging` se aplica solo a la posición X de la primera
 *   línea (y del marcador de lista), no al ancho disponible para ajustar.
 *   Diferencia mínima en la práctica (la sangría de primera línea suele ser
 *   pequeña) y evita maquetar dos veces con anchos distintos.
 * - La indentación de un párrafo con lista (`w:numPr`) usa la sangría del
 *   NIVEL de numeración solo si el párrafo no trae su propio `w:ind`
 *   explícito; si lo trae, gana el `w:ind` directo — aproximación
 *   razonable, no la cascada completa de OOXML.
 * - El texto de control de cambios (`w:ins`/`w:del`) se resuelve aceptando
 *   las inserciones y descartando las eliminaciones (no hay UI de revisión
 *   en esta fase); se avisa en `advertencias` si aparece alguno.
 * - Sin protección de "encabezado huérfano" (si el título Markdown no la
 *   tuviera tampoco sería difícil de justificar, pero aquí se omite para
 *   acotar el alcance): un `Heading1` puede quedar solo al pie de página.
 * - Los saltos de columna (`w:br` sin `w:type` o `w:type="column"`, fuera de
 *   `w:type="page"`) se tratan como saltos de línea simples (esta fase no
 *   admite columnas).
 * - Tablas: bordes a nivel de TABLA únicamente (`w:tblBorders`), nunca por
 *   celda (`w:tcBorders`); una celda es un único flujo lógico (varios `w:p`
 *   se unen con salto de línea); `w:vMerge` "continue" se renderiza en
 *   blanco (no se reconstruye el contenido combinado verticalmente a través
 *   de varias filas, ver `CeldaTabla`); sin tablas anidadas.
 * - Imágenes: solo `wp:inline` (en el flujo de texto) — `wp:anchor`
 *   (flotante, con ajuste de texto) se cuenta en advertencias, igual que
 *   EMF/WMF y cualquier formato que ni el decodificador PNG propio
 *   (`decodificarPng.ts`) ni `createImageBitmap` del navegador entiendan.
 * - Enlaces: solo `w:hyperlink` EXTERNO (`r:id` con `TargetMode="External"`);
 *   un enlace interno a un marcador del propio documento (`w:anchor`) se
 *   trata como texto plano, sin aviso (navegación interna fuera de alcance).
 */

export type RGB = [number, number, number];
export type Alineacion = 'left' | 'center' | 'right' | 'justify';

export interface RunFormato {
  /** Una de las 14 fuentes estándar PDF (ver `standardFontFor`), ya con negrita/cursiva resueltas. */
  font: string;
  sizePt: number;
  color: RGB;
  underline: boolean;
}

export type ParteParrafo =
  /** `url`, cuando está presente, es la URL YA VALIDADA (`validarUrlEnlace`) de un `w:hyperlink` que envuelve este texto. */
  | { tipo: 'texto'; texto: string; formato: RunFormato; url?: string }
  | { tipo: 'tab' }
  | { tipo: 'saltoLinea' }
  | { tipo: 'saltoPagina' }
  /** Imagen inline (`w:drawing > wp:inline`, fase 2a). `refId` es la ruta dentro del ZIP del .docx (p. ej. `word/media/image1.png`); `wPt`/`hPt` son el tamaño DECLARADO por Word (`wp:extent`, EMU → pt), sin clampar todavía al ancho útil de página — eso lo hace `render.ts`, que conoce la geometría. */
  | { tipo: 'imagen'; refId: string; wPt: number; hPt: number };

export interface InfoLista { textoMarcador: string }

export interface Parrafo {
  tipo: 'parrafo';
  partes: ParteParrafo[];
  alineacion: Alineacion;
  /** Sangría izquierda del cuerpo del párrafo (todas las líneas salvo el efecto de primera línea), en puntos PDF. */
  sangriaIzqPt: number;
  sangriaDerPt: number;
  /** Desplazamiento adicional de la PRIMERA línea respecto a `sangriaIzqPt`: positivo = sangría de primera línea, negativo = sangría francesa/colgante. */
  sangriaPrimeraLineaPt: number;
  espacioAntesPt: number;
  espacioDespuesPt: number;
  /** Factor × tamaño de fuente para la altura de línea, cuando `interlineadoExactoPt` es `null` (w:lineRule="auto"). */
  interlineadoFactor: number;
  /** Altura de línea FIJA en puntos PDF (w:lineRule="exact"/"atLeast"), o `null` para usar `interlineadoFactor`. */
  interlineadoExactoPt: number | null;
  saltoPaginaAntes: boolean;
  nivelEncabezado: number | null;
  lista: InfoLista | null;
  /** Tamaño de fuente de referencia del párrafo (primer run, o el de la marca de párrafo si no hay texto) — usado para la altura de las líneas en blanco. */
  tamanoBasePt: number;
}

/**
 * Celda de tabla (fase 2a). Simplificación deliberada: el contenido de una
 * celda se aplana a UN solo flujo lógico de `partes` (varios `w:p` de la
 * celda se unen con `saltoLinea` entre medias) — mismo límite que ya
 * declara este módulo para los ítems de lista ("una sola línea lógica").
 * Bordes: solo a nivel de TABLA (`w:tblBorders`), no por celda
 * (`w:tcBorders`) — un `w:tcBorders` que anule el borde de una celda
 * concreta no se respeta en esta fase.
 */
export interface CeldaTabla {
  partes: ParteParrafo[];
  /** Columnas que ocupa esta celda (`w:gridSpan`), 1 si no se combina horizontalmente. */
  gridSpan: number;
  /** `'restart'`/`'continue'` (`w:vMerge`) para una combinación vertical, `null` si la celda no se combina. `'continue'` se renderiza en blanco (ver `docx/render.ts`) — aproximación documentada en el spec: no se reconstruye el contenido combinado a través de varias filas. */
  vMerge: 'restart' | 'continue' | null;
  /** Color de sombreado (`w:shd w:fill`), o `null` sin sombreado. */
  colorFondo: RGB | null;
  alineacion: Alineacion;
}

export interface FilaTabla {
  celdas: CeldaTabla[];
  /** `w:tblHeader`: esta fila se repite al principio de cada página nueva mientras dure la tabla. */
  esEncabezado: boolean;
}

export interface Tabla {
  tipo: 'tabla';
  /** Ancho de cada columna (`w:tblGrid`/`w:gridCol`, twips → pt), en el mismo orden que las celdas de cada fila (sumando `gridSpan`). */
  anchosColPt: number[];
  filas: FilaTabla[];
  /** `null` = sin bordes visibles. Un único color/grosor para TODA la tabla (simplificación de fase 2a, ver comentario de `CeldaTabla`). */
  bordeColor: RGB | null;
  bordeGrosorPt: number;
}

/** Bloque de nivel superior del documento: párrafo o tabla, en el orden en que aparecen. */
export type BloqueDocx = Parrafo | Tabla;

export function esParrafo(b: BloqueDocx): b is Parrafo { return b.tipo === 'parrafo'; }
export function esTabla(b: BloqueDocx): b is Tabla { return b.tipo === 'tabla'; }

export interface ModeloDocx {
  paginaAnchoPt: number;
  paginaAltoPt: number;
  margenSupPt: number;
  margenInfPt: number;
  margenIzqPt: number;
  margenDerPt: number;
  bloques: BloqueDocx[];
  advertencias: string[];
}

function twipsAPt(v: number): number { return v / 20; }
function mediosPuntosAPt(v: number): number { return v / 2; }

function hexAColor(hex: string): RGB {
  const limpio = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(limpio)) return [0, 0, 0];
  return [parseInt(limpio.slice(0, 2), 16), parseInt(limpio.slice(2, 4), 16), parseInt(limpio.slice(4, 6), 16)];
}

/** Fuente estándar PDF para un run, combinando la FAMILIA del nombre original (`classifyFont`, igual criterio que la UI) con negrita/cursiva del propio run (que en DOCX son flags aparte, no parte del nombre). */
function fuenteEstandarPara(nombreOriginal: string | undefined, bold: boolean, italic: boolean): string {
  const familia = nombreOriginal ? classifyFont(nombreOriginal).family : 'sans-serif';
  if (familia === 'serif') {
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }
  if (familia === 'monospace') {
    if (bold && italic) return 'Courier-BoldOblique';
    if (bold) return 'Courier-Bold';
    if (italic) return 'Courier-Oblique';
    return 'Courier';
  }
  if (bold && italic) return 'Helvetica-BoldOblique';
  if (bold) return 'Helvetica-Bold';
  if (italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

function leerToggle(el: XmlElemento): boolean {
  const v = el.atributos['w:val'];
  if (v === undefined) return true;
  const low = v.toLowerCase();
  return !(low === '0' || low === 'false' || low === 'off');
}

// ---------------------------------------------------------------------------
// Estilos (word/styles.xml)
// ---------------------------------------------------------------------------

interface EstiloDef {
  styleId: string;
  name: string | null;
  type: string;
  basedOn: string | null;
  pPr: XmlElemento | null;
  rPr: XmlElemento | null;
}

/** Cadena de estilos de RAÍZ (más base) a HOJA (`styleId`), siguiendo `w:basedOn`. Cota anti-ciclo: 50 saltos. */
function cadenaEstilo(styleId: string, estilos: Map<string, EstiloDef>): EstiloDef[] {
  const pila: EstiloDef[] = [];
  const visitados = new Set<string>();
  let actual: string | null = styleId;
  let profundidad = 0;
  while (actual && !visitados.has(actual) && profundidad < 50) {
    const est = estilos.get(actual);
    if (!est) break;
    pila.push(est);
    visitados.add(actual);
    actual = est.basedOn;
    profundidad++;
  }
  pila.reverse();
  return pila;
}

function nivelEncabezadoDeEstilo(styleId: string | null, estilos: Map<string, EstiloDef>): number | null {
  if (!styleId) return null;
  let actual = estilos.get(styleId) ?? null;
  let profundidad = 0;
  const visitados = new Set<string>();
  while (actual && profundidad < 50 && !visitados.has(actual.styleId)) {
    visitados.add(actual.styleId);
    const m = /^(?:heading|t[ií]tulo)\s*([1-6])\b/i.exec(actual.name ?? '');
    if (m) return Number(m[1]);
    actual = actual.basedOn ? estilos.get(actual.basedOn) ?? null : null;
    profundidad++;
  }
  return null;
}

function leerEstilos(root: XmlElemento): {
  estilos: Map<string, EstiloDef>; docDefaultsPPr: XmlElemento | null; docDefaultsRPr: XmlElemento | null; estiloParrafoPorDefecto: string | null;
} {
  const estilos = new Map<string, EstiloDef>();
  let docDefaultsPPr: XmlElemento | null = null;
  let docDefaultsRPr: XmlElemento | null = null;
  let estiloParrafoPorDefecto: string | null = null;

  const dd = primerHijo(root, 'w:docDefaults');
  if (dd) {
    const rPrDefault = primerHijo(dd, 'w:rPrDefault');
    if (rPrDefault) docDefaultsRPr = primerHijo(rPrDefault, 'w:rPr');
    const pPrDefault = primerHijo(dd, 'w:pPrDefault');
    if (pPrDefault) docDefaultsPPr = primerHijo(pPrDefault, 'w:pPr');
  }

  for (const est of hijosElemento(root, 'w:style')) {
    const styleId = est.atributos['w:styleId'];
    if (!styleId) continue;
    const type = est.atributos['w:type'] ?? 'paragraph';
    const nameEl = primerHijo(est, 'w:name');
    const basedOnEl = primerHijo(est, 'w:basedOn');
    estilos.set(styleId, {
      styleId, name: nameEl?.atributos['w:val'] ?? null, type,
      basedOn: basedOnEl?.atributos['w:val'] ?? null,
      pPr: primerHijo(est, 'w:pPr'), rPr: primerHijo(est, 'w:rPr')
    });
    if (type === 'paragraph' && (est.atributos['w:default'] === '1' || est.atributos['w:default'] === 'true')) {
      estiloParrafoPorDefecto = styleId;
    }
  }

  return { estilos, docDefaultsPPr, docDefaultsRPr, estiloParrafoPorDefecto };
}

// ---------------------------------------------------------------------------
// Numeración (word/numbering.xml)
// ---------------------------------------------------------------------------

interface NivelListaDef { formato: string; sangriaIzqPt: number; sangriaColganteP: number }
interface AbstractNumDef { niveles: Map<number, NivelListaDef> }

function leerNumbering(root: XmlElemento): { numMap: Map<string, string>; abstractNums: Map<string, AbstractNumDef> } {
  const abstractNums = new Map<string, AbstractNumDef>();
  for (const an of hijosElemento(root, 'w:abstractNum')) {
    const id = an.atributos['w:abstractNumId'];
    if (id === undefined) continue;
    const niveles = new Map<number, NivelListaDef>();
    for (const lvl of hijosElemento(an, 'w:lvl')) {
      const ilvl = Number(lvl.atributos['w:ilvl'] ?? '0');
      const numFmt = primerHijo(lvl, 'w:numFmt')?.atributos['w:val'] ?? 'decimal';
      const pPr = primerHijo(lvl, 'w:pPr');
      const ind = pPr ? primerHijo(pPr, 'w:ind') : null;
      const left = ind?.atributos['w:left'] ?? ind?.atributos['w:start'];
      const hanging = ind?.atributos['w:hanging'];
      niveles.set(ilvl, {
        formato: numFmt,
        sangriaIzqPt: left !== undefined ? twipsAPt(Number(left)) : (ilvl + 1) * 18,
        sangriaColganteP: hanging !== undefined ? twipsAPt(Number(hanging)) : 18
      });
    }
    abstractNums.set(id, { niveles });
  }
  const numMap = new Map<string, string>();
  for (const num of hijosElemento(root, 'w:num')) {
    const numId = num.atributos['w:numId'];
    const abs = primerHijo(num, 'w:abstractNumId')?.atributos['w:val'];
    if (numId !== undefined && abs !== undefined) numMap.set(numId, abs);
  }
  return { numMap, abstractNums };
}

function obtenerNivelLista(numId: string, ilvl: number, ctx: Contexto): NivelListaDef | null {
  const absId = ctx.numMap.get(numId);
  if (absId === undefined) return null;
  return ctx.abstractNums.get(absId)?.niveles.get(ilvl) ?? null;
}

function letra(n: number, mayus: boolean): string {
  let s = '';
  let x = n;
  while (x > 0) { x--; s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26); }
  return mayus ? s.toUpperCase() : s;
}

function romano(n: number): string {
  const tabla: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let resto = n;
  let out = '';
  for (const [valor, simbolo] of tabla) { while (resto >= valor) { out += simbolo; resto -= valor; } }
  return out || 'I';
}

function formatearNumero(valor: number, formato: string): string {
  switch (formato) {
    case 'bullet': return '•';
    case 'decimal': return `${valor}.`;
    case 'lowerLetter': return `${letra(valor, false)}.`;
    case 'upperLetter': return `${letra(valor, true)}.`;
    case 'lowerRoman': return `${romano(valor).toLowerCase()}.`;
    case 'upperRoman': return `${romano(valor)}.`;
    default: return `${valor}.`;
  }
}

/** Numeración CORRELATIVA por lista y nivel: cada nivel lleva su propio contador, y avanzar un nivel más superficial reinicia los contadores de los niveles más profundos (igual que Word). Estado en `ctx.contadoresListas`, uno por documento. */
function siguienteMarcador(numId: string, ilvl: number, nivel: NivelListaDef, ctx: Contexto): string {
  let contadores = ctx.contadoresListas.get(numId);
  if (!contadores) { contadores = new Array(9).fill(0); ctx.contadoresListas.set(numId, contadores); }
  contadores[ilvl] = (contadores[ilvl] ?? 0) + 1;
  for (let i = ilvl + 1; i < contadores.length; i++) contadores[i] = 0;
  return formatearNumero(contadores[ilvl]!, nivel.formato);
}

function calcularInfoLista(numId: string, ilvl: number, ctx: Contexto): InfoLista | null {
  const nivel = obtenerNivelLista(numId, ilvl, ctx);
  if (!nivel) return null;
  return { textoMarcador: siguienteMarcador(numId, ilvl, nivel, ctx) };
}

// ---------------------------------------------------------------------------
// Propiedades de párrafo (w:pPr) y de run (w:rPr)
// ---------------------------------------------------------------------------

interface RPrAcum { bold: boolean; italic: boolean; underline: boolean; sizePt: number; color: RGB; fontName: string | undefined }

function rPrPorDefecto(): RPrAcum { return { bold: false, italic: false, underline: false, sizePt: 11, color: [0, 0, 0], fontName: undefined }; }

function aplicarRPr(acc: RPrAcum, el: XmlElemento): void {
  const b = primerHijo(el, 'w:b'); if (b) acc.bold = leerToggle(b);
  const i = primerHijo(el, 'w:i'); if (i) acc.italic = leerToggle(i);
  const u = primerHijo(el, 'w:u'); if (u) acc.underline = (u.atributos['w:val'] ?? 'single') !== 'none';
  const sz = primerHijo(el, 'w:sz'); if (sz?.atributos['w:val'] !== undefined) acc.sizePt = mediosPuntosAPt(Number(sz.atributos['w:val']));
  const color = primerHijo(el, 'w:color');
  if (color?.atributos['w:val'] !== undefined && color.atributos['w:val'] !== 'auto') acc.color = hexAColor(color.atributos['w:val']);
  const rFonts = primerHijo(el, 'w:rFonts');
  if (rFonts) { const nombre = rFonts.atributos['w:ascii'] ?? rFonts.atributos['w:hAnsi']; if (nombre) acc.fontName = nombre; }
}

interface PPrAcum {
  alineacion: Alineacion;
  sangriaIzqPt: number; sangriaDerPt: number; sangriaPrimeraLineaPt: number;
  espacioAntesPt: number; espacioDespuesPt: number;
  interlineadoFactor: number; interlineadoExactoPt: number | null;
  saltoPaginaAntes: boolean;
  numId: string | null; ilvl: number;
  outlineLvl: number | null;
}

function pPrPorDefecto(): PPrAcum {
  return {
    alineacion: 'left', sangriaIzqPt: 0, sangriaDerPt: 0, sangriaPrimeraLineaPt: 0,
    espacioAntesPt: 0, espacioDespuesPt: 8, interlineadoFactor: 1.15, interlineadoExactoPt: null,
    saltoPaginaAntes: false, numId: null, ilvl: 0, outlineLvl: null
  };
}

function mapAlineacion(v: string): Alineacion {
  if (v === 'center') return 'center';
  if (v === 'right' || v === 'end') return 'right';
  if (v === 'both' || v === 'distribute') return 'justify';
  return 'left';
}

function aplicarPPr(acc: PPrAcum, el: XmlElemento): void {
  const jc = primerHijo(el, 'w:jc'); if (jc?.atributos['w:val'] !== undefined) acc.alineacion = mapAlineacion(jc.atributos['w:val']);
  const ind = primerHijo(el, 'w:ind');
  if (ind) {
    const left = ind.atributos['w:left'] ?? ind.atributos['w:start'];
    const right = ind.atributos['w:right'] ?? ind.atributos['w:end'];
    const firstLine = ind.atributos['w:firstLine'];
    const hanging = ind.atributos['w:hanging'];
    if (left !== undefined) acc.sangriaIzqPt = twipsAPt(Number(left));
    if (right !== undefined) acc.sangriaDerPt = twipsAPt(Number(right));
    if (firstLine !== undefined) acc.sangriaPrimeraLineaPt = twipsAPt(Number(firstLine));
    else if (hanging !== undefined) acc.sangriaPrimeraLineaPt = -twipsAPt(Number(hanging));
  }
  const spacing = primerHijo(el, 'w:spacing');
  if (spacing) {
    const before = spacing.atributos['w:before']; if (before !== undefined) acc.espacioAntesPt = twipsAPt(Number(before));
    const after = spacing.atributos['w:after']; if (after !== undefined) acc.espacioDespuesPt = twipsAPt(Number(after));
    const line = spacing.atributos['w:line'];
    if (line !== undefined) {
      const rule = spacing.atributos['w:lineRule'] ?? 'auto';
      if (rule === 'auto') { acc.interlineadoFactor = Number(line) / 240; acc.interlineadoExactoPt = null; }
      else { acc.interlineadoExactoPt = twipsAPt(Number(line)); }
    }
  }
  const pbb = primerHijo(el, 'w:pageBreakBefore'); if (pbb) acc.saltoPaginaAntes = leerToggle(pbb);
  const outlineLvl = primerHijo(el, 'w:outlineLvl'); if (outlineLvl?.atributos['w:val'] !== undefined) acc.outlineLvl = Number(outlineLvl.atributos['w:val']);
  const numPr = primerHijo(el, 'w:numPr');
  if (numPr) {
    const ilvl = primerHijo(numPr, 'w:ilvl')?.atributos['w:val'];
    const numId = primerHijo(numPr, 'w:numId')?.atributos['w:val'];
    if (numId !== undefined) acc.numId = numId === '0' ? null : numId;
    if (ilvl !== undefined) acc.ilvl = Number(ilvl);
  }
}

// ---------------------------------------------------------------------------
// Cuerpo del documento
// ---------------------------------------------------------------------------

interface Contexto {
  estilos: Map<string, EstiloDef>;
  docDefaultsPPr: XmlElemento | null;
  docDefaultsRPr: XmlElemento | null;
  estiloParrafoPorDefecto: string | null;
  numMap: Map<string, string>;
  abstractNums: Map<string, AbstractNumDef>;
  contadoresListas: Map<string, number[]>;
  /** `word/_rels/document.xml.rels` ya parseado (`null` si el .docx no lo trae, p. ej. sin imágenes ni enlaces). */
  rels: Map<string, Relacion> | null;
  /**
   * Advertencias que solo se pueden generar AL RECORRER (imagen inline no
   * resuelta/flotante, enlace con esquema rechazado...) — a diferencia de
   * `construirAdvertencias`, que cuenta patrones estructurales escaneando
   * todo el árbol al final. Se combinan al construir el `ModeloDocx` final.
   */
  advertenciasExtra: string[];
}

/** Azul + subrayado por defecto de un hipervínculo (`w:hyperlink`) cuyo estilo no diga otra cosa — mismo tono que usa el conversor Markdown. */
const LINK_BLUE: RGB = [37, 99, 235];
/** EMU (English Metric Units) por punto PDF: 914400 EMU/pulgada ÷ 72 pt/pulgada = 12700 EMU/pt (`wp:extent`, spec fase 2a §3). */
const EMU_POR_PUNTO = 12700;

/** Aplana `w:sdt` (control de contenido) a su `w:sdtContent`: fase 1 no distingue un párrafo dentro de un control de contenido de uno normal. */
function aplanarCuerpo(cuerpo: XmlElemento): XmlElemento[] {
  const out: XmlElemento[] = [];
  for (const h of cuerpo.hijos) {
    if (h.tipo !== 'elemento') continue;
    if (h.nombre === 'w:sdt') {
      const contenido = primerHijo(h, 'w:sdtContent');
      if (contenido) out.push(...aplanarCuerpo(contenido));
      continue;
    }
    out.push(h);
  }
  return out;
}

function procesarRun(runEl: XmlElemento, baseRuns: RPrAcum, ctx: Contexto, partes: ParteParrafo[]): void {
  const rPrEl = primerHijo(runEl, 'w:rPr');
  const acc: RPrAcum = { ...baseRuns };
  if (rPrEl) {
    const rStyleId = primerHijo(rPrEl, 'w:rStyle')?.atributos['w:val'];
    if (rStyleId) for (const est of cadenaEstilo(rStyleId, ctx.estilos)) if (est.rPr) aplicarRPr(acc, est.rPr);
    aplicarRPr(acc, rPrEl);
  }
  const formato: RunFormato = { font: fuenteEstandarPara(acc.fontName, acc.bold, acc.italic), sizePt: acc.sizePt, color: acc.color, underline: acc.underline };

  for (const h of runEl.hijos) {
    if (h.tipo !== 'elemento') continue;
    if (h.nombre === 'w:t') { const t = textoDirecto(h); if (t.length > 0) partes.push({ tipo: 'texto', texto: t, formato }); }
    else if (h.nombre === 'w:tab') partes.push({ tipo: 'tab' });
    else if (h.nombre === 'w:br') partes.push({ tipo: h.atributos['w:type'] === 'page' ? 'saltoPagina' : 'saltoLinea' });
    else if (h.nombre === 'w:noBreakHyphen') partes.push({ tipo: 'texto', texto: '-', formato });
    else if (h.nombre === 'w:drawing') { const parte = resolverImagenDrawing(h, ctx); if (parte) partes.push(parte); }
    // w:pict (VML, Word <2007), w:footnoteReference, w:commentReference,
    // w:fldChar, w:instrText, w:delText...: contenido no soportado en esta
    // fase, contado aparte en `construirAdvertencias` (no se pierde en silencio).
  }
}

/**
 * Resuelve un `w:drawing` a su `ParteParrafo` de imagen, o `null` si no se
 * pudo (con la advertencia correspondiente ya empujada a
 * `ctx.advertenciasExtra` — nunca se pierde en silencio, AGENTS.md §3).
 * Solo `wp:inline` (imagen en el flujo de texto): `wp:anchor` (imagen
 * flotante, con ajuste de texto) queda fuera de esta fase.
 */
function resolverImagenDrawing(drawing: XmlElemento, ctx: Contexto): ParteParrafo | null {
  if (primerHijo(drawing, 'wp:anchor')) {
    ctx.advertenciasExtra.push('Se omitió una imagen flotante (con ajuste de texto); aún no soportada.');
    return null;
  }
  const inline = primerHijo(drawing, 'wp:inline');
  if (!inline) {
    ctx.advertenciasExtra.push('No se pudo insertar una imagen del documento (formato de dibujo no reconocido).');
    return null;
  }
  const extent = primerHijo(inline, 'wp:extent');
  const blip = buscarDescendiente(inline, 'a:blip');
  const embedId = blip?.atributos['r:embed'];
  if (!extent || !embedId) {
    ctx.advertenciasExtra.push('No se pudo insertar una imagen del documento (faltan sus datos de tamaño u origen).');
    return null;
  }
  const rel = ctx.rels?.get(embedId);
  if (!rel) {
    ctx.advertenciasExtra.push('No se pudo insertar una imagen del documento (no se encontró su relación en el paquete).');
    return null;
  }
  const cx = Number(extent.atributos['cx'] ?? '0');
  const cy = Number(extent.atributos['cy'] ?? '0');
  if (!(cx > 0) || !(cy > 0)) {
    ctx.advertenciasExtra.push('No se pudo insertar una imagen del documento (tamaño declarado inválido).');
    return null;
  }
  return { tipo: 'imagen', refId: rutaMediaDesdeWord(rel.target), wPt: cx / EMU_POR_PUNTO, hPt: cy / EMU_POR_PUNTO };
}

function recorrerContenidoParrafo(contenedor: XmlElemento, baseRuns: RPrAcum, ctx: Contexto, partes: ParteParrafo[]): void {
  for (const h of contenedor.hijos) {
    if (h.tipo !== 'elemento') continue;
    switch (h.nombre) {
      case 'w:r': procesarRun(h, baseRuns, ctx, partes); break;
      case 'w:hyperlink': procesarHyperlink(h, baseRuns, ctx, partes); break;
      case 'w:ins': recorrerContenidoParrafo(h, baseRuns, ctx, partes); break; // inserción de control de cambios: se acepta
      case 'w:smartTag': recorrerContenidoParrafo(h, baseRuns, ctx, partes); break;
      case 'w:del': break; // eliminación de control de cambios: se descarta (advertencia aparte)
      case 'w:pPr': break; // procesado aparte
      default: break; // bookmarkStart/End, proofErr...: ruido estructural
    }
  }
}

/**
 * `w:hyperlink r:id="rIdN"` (fase 2a). Solo enlaces EXTERNOS
 * (`TargetMode="External"`, siempre el caso de un hipervínculo a una URL —
 * un `w:anchor` en vez de `r:id` es un enlace INTERNO a un marcador del
 * propio documento, fuera de alcance de esta fase, se trata como texto
 * plano sin aviso). El esquema se valida con `validarUrlEnlace` (mismo
 * criterio que el motor, E-0NN de esta fase): un esquema no permitido dentro
 * del propio `.docx` NO crea un enlace clicable y se avisa — nunca en
 * silencio. Con enlace válido, el texto adopta azul+subrayado por DEFECTO
 * (seminario en `baseRuns` antes de recorrer: el run puede seguir
 * sobrescribiéndolo con su propio `w:rPr`, "si el estilo no dice otra cosa").
 */
function procesarHyperlink(h: XmlElemento, baseRuns: RPrAcum, ctx: Contexto, partes: ParteParrafo[]): void {
  const rId = h.atributos['r:id'];
  const rel = rId ? ctx.rels?.get(rId) : undefined;
  if (!rId || !rel || rel.targetMode !== 'External') {
    recorrerContenidoParrafo(h, baseRuns, ctx, partes); // enlace interno o no resuelto: texto plano, sin aviso
    return;
  }
  const url = validarUrlEnlace(rel.target);
  if (!url) {
    ctx.advertenciasExtra.push(`Se omitió un enlace con esquema no permitido ("${rel.target}").`);
    recorrerContenidoParrafo(h, baseRuns, ctx, partes);
    return;
  }
  const baseConEnlace: RPrAcum = { ...baseRuns, color: LINK_BLUE, underline: true };
  const antes = partes.length;
  recorrerContenidoParrafo(h, baseConEnlace, ctx, partes);
  for (let i = antes; i < partes.length; i++) { const p = partes[i]!; if (p.tipo === 'texto') p.url = url; }
}

function procesarParrafo(el: XmlElemento, ctx: Contexto): Parrafo {
  const pPr = primerHijo(el, 'w:pPr');
  const pStyleIdPropio = pPr ? primerHijo(pPr, 'w:pStyle')?.atributos['w:val'] ?? null : null;
  const estiloEfectivo = pStyleIdPropio ?? ctx.estiloParrafoPorDefecto;
  const cadena = estiloEfectivo ? cadenaEstilo(estiloEfectivo, ctx.estilos) : [];

  const acc = pPrPorDefecto();
  if (ctx.docDefaultsPPr) aplicarPPr(acc, ctx.docDefaultsPPr);
  for (const est of cadena) if (est.pPr) aplicarPPr(acc, est.pPr);
  if (pPr) aplicarPPr(acc, pPr);

  const indDirecto = pPr ? primerHijo(pPr, 'w:ind') : null;
  if (!indDirecto && acc.numId) {
    const nivel = obtenerNivelLista(acc.numId, acc.ilvl, ctx);
    if (nivel) { acc.sangriaIzqPt = nivel.sangriaIzqPt; acc.sangriaPrimeraLineaPt = -nivel.sangriaColganteP; }
  }

  const baseRuns = rPrPorDefecto();
  if (ctx.docDefaultsRPr) aplicarRPr(baseRuns, ctx.docDefaultsRPr);
  for (const est of cadena) if (est.rPr) aplicarRPr(baseRuns, est.rPr);
  const marcaRPr = pPr ? primerHijo(pPr, 'w:rPr') : null; // formato del carácter de fin de párrafo: baseline razonable para runs sin rPr propio
  if (marcaRPr) aplicarRPr(baseRuns, marcaRPr);

  const nivelEncabezado = nivelEncabezadoDeEstilo(estiloEfectivo, ctx.estilos) ?? (acc.outlineLvl !== null ? Math.min(6, acc.outlineLvl + 1) : null);

  const partes: ParteParrafo[] = [];
  recorrerContenidoParrafo(el, baseRuns, ctx, partes);

  let tamanoBasePt = baseRuns.sizePt;
  for (const p of partes) if (p.tipo === 'texto') { tamanoBasePt = p.formato.sizePt; break; }

  const lista = acc.numId ? calcularInfoLista(acc.numId, acc.ilvl, ctx) : null;

  return {
    tipo: 'parrafo', partes,
    alineacion: acc.alineacion,
    sangriaIzqPt: acc.sangriaIzqPt, sangriaDerPt: acc.sangriaDerPt, sangriaPrimeraLineaPt: acc.sangriaPrimeraLineaPt,
    espacioAntesPt: acc.espacioAntesPt, espacioDespuesPt: acc.espacioDespuesPt,
    interlineadoFactor: acc.interlineadoFactor, interlineadoExactoPt: acc.interlineadoExactoPt,
    saltoPaginaAntes: acc.saltoPaginaAntes, nivelEncabezado, lista, tamanoBasePt
  };
}

// ---------------------------------------------------------------------------
// Tablas (w:tbl) — fase 2a: tablas REALES (grid, spans, merges, bordes, sombreado)
// ---------------------------------------------------------------------------

/**
 * Borde de toda la tabla (`w:tblPr > w:tblBorders`). Simplificación de fase
 * 2a (ver `CeldaTabla`): un único color/grosor para toda la tabla, tomado
 * del PRIMER lado con borde visible que se encuentre (`w:top`/`w:bottom`/
 * `w:left`/`w:right`/`w:insideH`/`w:insideV`, en ese orden) — casi siempre
 * los seis coinciden en un documento real. `w:sz` viene en OCTAVOS DE PUNTO
 * (no twips): dividir entre 8 da puntos PDF directamente.
 */
function leerBordesTabla(tblBorders: XmlElemento | null): { color: RGB | null; grosorPt: number } {
  if (!tblBorders) return { color: null, grosorPt: 0 };
  for (const lado of ['w:top', 'w:bottom', 'w:left', 'w:right', 'w:insideH', 'w:insideV']) {
    const el = primerHijo(tblBorders, lado);
    const val = el?.atributos['w:val'];
    if (!el || !val || val === 'nil' || val === 'none') continue;
    const szRaw = el.atributos['w:sz'];
    const grosorPt = szRaw !== undefined ? Math.max(0.5, Number(szRaw) / 8) : 0.5;
    const colorRaw = el.atributos['w:color'];
    const color: RGB = colorRaw && colorRaw !== 'auto' ? hexAColor(colorRaw) : [0, 0, 0];
    return { color, grosorPt };
  }
  return { color: null, grosorPt: 0 };
}

/** Contenido de una celda: varios `w:p` se unen en un único flujo lógico con `saltoLinea` entre medias (ver el comentario de `CeldaTabla`). */
function procesarCelda(tc: XmlElemento, ctx: Contexto): CeldaTabla {
  const tcPr = primerHijo(tc, 'w:tcPr');
  const gridSpanVal = tcPr ? primerHijo(tcPr, 'w:gridSpan')?.atributos['w:val'] : undefined;
  const gridSpan = gridSpanVal !== undefined ? Math.max(1, Number(gridSpanVal)) : 1;
  const vMergeEl = tcPr ? primerHijo(tcPr, 'w:vMerge') : null;
  const vMerge: 'restart' | 'continue' | null = vMergeEl ? (vMergeEl.atributos['w:val'] === 'restart' ? 'restart' : 'continue') : null;
  const fill = tcPr ? primerHijo(tcPr, 'w:shd')?.atributos['w:fill'] : undefined;
  const colorFondo: RGB | null = fill && fill !== 'auto' && /^[0-9a-fA-F]{6}$/.test(fill) ? hexAColor(fill) : null;

  const partes: ParteParrafo[] = [];
  let alineacion: Alineacion = 'left';
  hijosElemento(tc, 'w:p').forEach((p, i) => {
    if (i > 0) partes.push({ tipo: 'saltoLinea' });
    const pPr = primerHijo(p, 'w:pPr');
    if (i === 0) {
      const jc = pPr ? primerHijo(pPr, 'w:jc') : null;
      if (jc?.atributos['w:val'] !== undefined) alineacion = mapAlineacion(jc.atributos['w:val']);
    }
    const baseRuns = rPrPorDefecto();
    if (ctx.docDefaultsRPr) aplicarRPr(baseRuns, ctx.docDefaultsRPr);
    recorrerContenidoParrafo(p, baseRuns, ctx, partes);
  });

  return { partes, gridSpan, vMerge, colorFondo, alineacion };
}

function procesarFila(fila: XmlElemento, ctx: Contexto): FilaTabla {
  const trPr = primerHijo(fila, 'w:trPr');
  const esEncabezado = !!(trPr && primerHijo(trPr, 'w:tblHeader'));
  return { celdas: hijosElemento(fila, 'w:tc').map((tc) => procesarCelda(tc, ctx)), esEncabezado };
}

/** Tabla REAL (fase 2a, §9 fila #4): grid, spans horizontales/verticales, bordes y sombreado — ver `Tabla` y `CeldaTabla` para las simplificaciones deliberadas de esta fase. */
function procesarTablaReal(tbl: XmlElemento, ctx: Contexto): Tabla {
  const tblGrid = primerHijo(tbl, 'w:tblGrid');
  let anchosColPt = tblGrid ? hijosElemento(tblGrid, 'w:gridCol').map((gc) => twipsAPt(Number(gc.atributos['w:w'] ?? '0'))) : [];
  const tblPr = primerHijo(tbl, 'w:tblPr');
  const { color: bordeColor, grosorPt: bordeGrosorPt } = leerBordesTabla(tblPr ? primerHijo(tblPr, 'w:tblBorders') : null);
  const filas = hijosElemento(tbl, 'w:tr').map((fila) => procesarFila(fila, ctx));
  if (anchosColPt.length === 0) {
    // Sin w:tblGrid (raro en un .docx real: Word siempre lo escribe): ancho
    // de 1" por columna como valor por defecto razonable, mejor que fallar.
    const numCols = filas.reduce((max, f) => Math.max(max, f.celdas.reduce((s, c) => s + c.gridSpan, 0)), 1);
    anchosColPt = new Array(numCols).fill(72);
  }
  return { tipo: 'tabla', anchosColPt, filas, bordeColor, bordeGrosorPt };
}

function leerGeometriaPagina(sectPr: XmlElemento | null): { anchoPt: number; altoPt: number; margenSup: number; margenInf: number; margenIzq: number; margenDer: number } {
  // Sin w:sectPr (o sin w:pgSz/w:pgMar): tamaño Carta US con 1" de margen —
  // el valor por defecto que usa el propio Word cuando faltan.
  let anchoPt = 612, altoPt = 792;
  let margenSup = 72, margenInf = 72, margenIzq = 72, margenDer = 72;
  if (sectPr) {
    const pgSz = primerHijo(sectPr, 'w:pgSz');
    if (pgSz) {
      const w = pgSz.atributos['w:w']; const h = pgSz.atributos['w:h'];
      if (w !== undefined) anchoPt = twipsAPt(Number(w));
      if (h !== undefined) altoPt = twipsAPt(Number(h));
    }
    const pgMar = primerHijo(sectPr, 'w:pgMar');
    if (pgMar) {
      const top = pgMar.atributos['w:top']; const bottom = pgMar.atributos['w:bottom'];
      const left = pgMar.atributos['w:left']; const right = pgMar.atributos['w:right'];
      if (top !== undefined) margenSup = twipsAPt(Number(top));
      if (bottom !== undefined) margenInf = twipsAPt(Number(bottom));
      if (left !== undefined) margenIzq = twipsAPt(Number(left));
      if (right !== undefined) margenDer = twipsAPt(Number(right));
    }
  }
  return { anchoPt, altoPt, margenSup, margenInf, margenIzq, margenDer };
}

function contarElementos(nodo: XmlElemento, nombre: string): number {
  let c = nodo.nombre === nombre ? 1 : 0;
  for (const h of nodo.hijos) if (h.tipo === 'elemento') c += contarElementos(h, nombre);
  return c;
}

function contarConAtributo(nodo: XmlElemento, nombre: string, attr: string, valor: string): number {
  let c = nodo.nombre === nombre && nodo.atributos[attr] === valor ? 1 : 0;
  for (const h of nodo.hijos) if (h.tipo === 'elemento') c += contarConAtributo(h, nombre, attr, valor);
  return c;
}

function pluralizar(n: number, singular: string, plural: string): string { return n === 1 ? singular : plural; }

/**
 * Cuenta el contenido NO soportado de fase 2a en TODO el árbol (no solo el
 * cuerpo: notas al pie y comentarios viven en sus propias partes, pero sus
 * REFERENCIAS están en el cuerpo) y arma los avisos — nunca se pierde en
 * silencio (spec §3). Las imágenes inline (`w:drawing > wp:inline`) y los
 * enlaces YA NO se cuentan aquí a ciegas: cada fallo concreto (flotante, sin
 * relación, esquema rechazado...) se avisa AL RECORRER, en
 * `ctx.advertenciasExtra` (`resolverImagenDrawing`/`procesarHyperlink`) —
 * más preciso que un conteo estructural que no sabe si la imagen se resolvió
 * o no. `w:pict` (dibujo VML, Word anterior a 2007) sigue sin soportarse en
 * absoluto, así que sí se cuenta aquí.
 */
function construirAdvertencias(docRoot: XmlElemento): string[] {
  const advertencias: string[] = [];
  const imagenesVml = contarElementos(docRoot, 'w:pict');
  const encabezados = contarElementos(docRoot, 'w:headerReference');
  const pies = contarElementos(docRoot, 'w:footerReference');
  const cuadros = contarElementos(docRoot, 'w:txbxContent');
  const notas = contarElementos(docRoot, 'w:footnoteReference');
  const comentarios = contarElementos(docRoot, 'w:commentReference');
  const campos = contarConAtributo(docRoot, 'w:fldChar', 'w:fldCharType', 'begin') + contarElementos(docRoot, 'w:fldSimple');
  const cambios = contarElementos(docRoot, 'w:ins') + contarElementos(docRoot, 'w:del');

  if (imagenesVml > 0) advertencias.push(`Se omitieron ${imagenesVml} ${pluralizar(imagenesVml, 'imagen', 'imágenes')} en formato antiguo (VML, aún no soportado).`);
  if (encabezados > 0) advertencias.push(`Se omitieron ${encabezados} ${pluralizar(encabezados, 'encabezado', 'encabezados')} de página (aún no soportados).`);
  if (pies > 0) advertencias.push(`Se omitieron ${pies} ${pluralizar(pies, 'pie', 'pies')} de página (aún no soportados).`);
  if (cuadros > 0) advertencias.push(`Se omitieron ${cuadros} ${pluralizar(cuadros, 'cuadro de texto', 'cuadros de texto')} (aún no soportados).`);
  if (notas > 0) advertencias.push(`Se omitieron ${notas} ${pluralizar(notas, 'nota al pie', 'notas al pie')} (aún no soportadas).`);
  if (comentarios > 0) advertencias.push(`Se omitieron ${comentarios} ${pluralizar(comentarios, 'comentario', 'comentarios')} (aún no soportados).`);
  if (campos > 0) advertencias.push(`Se omitieron ${campos} ${pluralizar(campos, 'campo', 'campos')} (aún no soportados).`);
  if (cambios > 0) advertencias.push(`El documento tiene ${cambios} ${pluralizar(cambios, 'cambio', 'cambios')} de control de cambios sin resolver; se aceptaron las inserciones y se descartaron las eliminaciones.`);

  return advertencias;
}

/**
 * Construye el modelo a partir del texto YA DECODIFICADO (UTF-8) de
 * `word/document.xml` y, si existen, `word/styles.xml`/`word/numbering.xml`/
 * `word/_rels/document.xml.rels` (imágenes y enlaces, fase 2a). PURO: no lee
 * el ZIP (eso lo hace `ConversorDocxNavegador`, que decodifica cada entrada
 * y llama aquí) ni decodifica píxeles de imagen (eso lo hace
 * `decodificarImagenDocx`, después, sobre los `refId` que deja este modelo).
 */
export function construirModeloDocx(documentXml: string, stylesXml: string | null, numberingXml: string | null, relsXml: string | null = null): ModeloDocx {
  const docRoot = parseXml(documentXml);
  const body = primerHijo(docRoot, 'w:body');
  if (!body) throw new DocxError('El documento .docx no tiene contenido (falta <w:body> en document.xml).');

  const { estilos, docDefaultsPPr, docDefaultsRPr, estiloParrafoPorDefecto } = stylesXml
    ? leerEstilos(parseXml(stylesXml))
    : { estilos: new Map<string, EstiloDef>(), docDefaultsPPr: null, docDefaultsRPr: null, estiloParrafoPorDefecto: null };
  const { numMap, abstractNums } = numberingXml
    ? leerNumbering(parseXml(numberingXml))
    : { numMap: new Map<string, string>(), abstractNums: new Map<string, AbstractNumDef>() };
  const rels = relsXml ? leerRelaciones(relsXml) : null;

  const ctx: Contexto = { estilos, docDefaultsPPr, docDefaultsRPr, estiloParrafoPorDefecto, numMap, abstractNums, contadoresListas: new Map(), rels, advertenciasExtra: [] };

  const bloques: BloqueDocx[] = [];
  let sectPrFinal: XmlElemento | null = null;

  for (const hijo of aplanarCuerpo(body)) {
    if (hijo.nombre === 'w:p') {
      const pPr = primerHijo(hijo, 'w:pPr');
      const sectPrParrafo = pPr ? primerHijo(pPr, 'w:sectPr') : null;
      if (sectPrParrafo) sectPrFinal = sectPrParrafo;
      bloques.push(procesarParrafo(hijo, ctx));
    } else if (hijo.nombre === 'w:tbl') {
      bloques.push(procesarTablaReal(hijo, ctx));
    } else if (hijo.nombre === 'w:sectPr') {
      sectPrFinal = hijo;
    }
  }

  const geo = leerGeometriaPagina(sectPrFinal);
  const advertencias = [...construirAdvertencias(docRoot), ...ctx.advertenciasExtra];

  return {
    paginaAnchoPt: geo.anchoPt, paginaAltoPt: geo.altoPt,
    margenSupPt: geo.margenSup, margenInfPt: geo.margenInf, margenIzqPt: geo.margenIzq, margenDerPt: geo.margenDer,
    bloques, advertencias
  };
}
