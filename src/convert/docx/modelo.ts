import { DocxError } from './DocxError';
import { parseXml, hijosElemento, primerHijo, textoDirecto, type XmlElemento } from './xml';
import { classifyFont } from '../../engine/fontClassify';

/**
 * Modelo del documento DOCX (§9 fila #4): de `word/document.xml` +
 * `word/styles.xml` (+ `word/numbering.xml` si existe) a una lista plana de
 * PÁRRAFOS con su formato ya resuelto (herencia de estilos incluida) y la
 * geometría de página. PURO: no toca el motor ni el DOM, igual que
 * `../markdown/parse.ts`. `render.ts` convierte este modelo en `FlowItem`
 * para el maquetador común (`../flujo/layout.ts`).
 *
 * Unidades DOCX, documentadas aquí porque se mezclan en todo el módulo
 * (AGENTS.md §1: "escribe en el comentario en qué unidad está cada número"):
 * - Twips (1/20 pt): `w:ind`, `w:spacing`, `w:pgSz`, `w:pgMar`. `twipsAPt()`.
 * - Medios puntos: `w:sz` (tamaño de fuente). `mediosPuntosAPt()`.
 *
 * Simplificaciones deliberadas de esta FASE 1 (documentadas también en el
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
  | { tipo: 'texto'; texto: string; formato: RunFormato }
  | { tipo: 'tab' }
  | { tipo: 'saltoLinea' }
  | { tipo: 'saltoPagina' };

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

export interface ModeloDocx {
  paginaAnchoPt: number;
  paginaAltoPt: number;
  margenSupPt: number;
  margenInfPt: number;
  margenIzqPt: number;
  margenDerPt: number;
  parrafos: Parrafo[];
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
}

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
    // w:drawing, w:pict, w:footnoteReference, w:commentReference, w:fldChar,
    // w:instrText, w:delText...: contenido no soportado en fase 1, contado
    // aparte en `construirAdvertencias` (no se pierde en silencio).
  }
}

function recorrerContenidoParrafo(contenedor: XmlElemento, baseRuns: RPrAcum, ctx: Contexto, partes: ParteParrafo[]): void {
  for (const h of contenedor.hijos) {
    if (h.tipo !== 'elemento') continue;
    switch (h.nombre) {
      case 'w:r': procesarRun(h, baseRuns, ctx, partes); break;
      case 'w:hyperlink': recorrerContenidoParrafo(h, baseRuns, ctx, partes); break;
      case 'w:ins': recorrerContenidoParrafo(h, baseRuns, ctx, partes); break; // inserción de control de cambios: se acepta
      case 'w:smartTag': recorrerContenidoParrafo(h, baseRuns, ctx, partes); break;
      case 'w:del': break; // eliminación de control de cambios: se descarta (advertencia aparte)
      case 'w:pPr': break; // procesado aparte
      default: break; // bookmarkStart/End, proofErr...: ruido estructural
    }
  }
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

function formatoPorDefecto(ctx: Contexto): RunFormato {
  const acc = rPrPorDefecto();
  if (ctx.docDefaultsRPr) aplicarRPr(acc, ctx.docDefaultsRPr);
  return { font: fuenteEstandarPara(acc.fontName, acc.bold, acc.italic), sizePt: acc.sizePt, color: acc.color, underline: acc.underline };
}

/** Texto de todos los `w:t` bajo `el`, recorriendo cualquier profundidad (para aplanar una celda de tabla a una sola línea). `w:tab`→tabulador, `w:br`→espacio. */
function textoProfundo(el: XmlElemento): string {
  let out = '';
  for (const h of el.hijos) {
    if (h.tipo !== 'elemento') continue;
    if (h.nombre === 'w:t') out += textoDirecto(h);
    else if (h.nombre === 'w:tab') out += '\t';
    else if (h.nombre === 'w:br') out += ' ';
    else out += textoProfundo(h);
  }
  return out;
}

/** Tablas fase 1 (§9 fila #4): se APLANAN a un párrafo por fila, celdas separadas por tabulador — no se pierden en silencio, pero tampoco son tablas reales (ver `construirAdvertencias`). */
function procesarTabla(tbl: XmlElemento, ctx: Contexto): Parrafo[] {
  const formato = formatoPorDefecto(ctx);
  return hijosElemento(tbl, 'w:tr').map((fila) => {
    const celdas = hijosElemento(fila, 'w:tc');
    const partes: ParteParrafo[] = [];
    celdas.forEach((celda, i) => {
      if (i > 0) partes.push({ tipo: 'tab' });
      const texto = textoProfundo(celda).trim().replace(/\s+/g, ' ');
      if (texto) partes.push({ tipo: 'texto', texto, formato });
    });
    return {
      tipo: 'parrafo' as const, partes,
      alineacion: 'left' as const, sangriaIzqPt: 0, sangriaDerPt: 0, sangriaPrimeraLineaPt: 0,
      espacioAntesPt: 0, espacioDespuesPt: 4, interlineadoFactor: 1.15, interlineadoExactoPt: null,
      saltoPaginaAntes: false, nivelEncabezado: null, lista: null, tamanoBasePt: formato.sizePt
    };
  });
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

/** Cuenta el contenido NO soportado de fase 1 en TODO el árbol (no solo el cuerpo: notas al pie y comentarios viven en sus propias partes, pero sus REFERENCIAS están en el cuerpo) y arma los avisos — nunca se pierde en silencio (spec §3). */
function construirAdvertencias(docRoot: XmlElemento, tablas: number): string[] {
  const advertencias: string[] = [];
  const imagenes = contarElementos(docRoot, 'w:drawing') + contarElementos(docRoot, 'w:pict');
  const encabezados = contarElementos(docRoot, 'w:headerReference');
  const pies = contarElementos(docRoot, 'w:footerReference');
  const cuadros = contarElementos(docRoot, 'w:txbxContent');
  const notas = contarElementos(docRoot, 'w:footnoteReference');
  const comentarios = contarElementos(docRoot, 'w:commentReference');
  const campos = contarConAtributo(docRoot, 'w:fldChar', 'w:fldCharType', 'begin') + contarElementos(docRoot, 'w:fldSimple');
  const cambios = contarElementos(docRoot, 'w:ins') + contarElementos(docRoot, 'w:del');

  if (imagenes > 0) advertencias.push(`Se omitieron ${imagenes} ${pluralizar(imagenes, 'imagen', 'imágenes')} (aún no soportadas).`);
  if (encabezados > 0) advertencias.push(`Se omitieron ${encabezados} ${pluralizar(encabezados, 'encabezado', 'encabezados')} de página (aún no soportados).`);
  if (pies > 0) advertencias.push(`Se omitieron ${pies} ${pluralizar(pies, 'pie', 'pies')} de página (aún no soportados).`);
  if (cuadros > 0) advertencias.push(`Se omitieron ${cuadros} ${pluralizar(cuadros, 'cuadro de texto', 'cuadros de texto')} (aún no soportados).`);
  if (notas > 0) advertencias.push(`Se omitieron ${notas} ${pluralizar(notas, 'nota al pie', 'notas al pie')} (aún no soportadas).`);
  if (comentarios > 0) advertencias.push(`Se omitieron ${comentarios} ${pluralizar(comentarios, 'comentario', 'comentarios')} (aún no soportados).`);
  if (campos > 0) advertencias.push(`Se omitieron ${campos} ${pluralizar(campos, 'campo', 'campos')} (aún no soportados).`);
  if (cambios > 0) advertencias.push(`El documento tiene ${cambios} ${pluralizar(cambios, 'cambio', 'cambios')} de control de cambios sin resolver; se aceptaron las inserciones y se descartaron las eliminaciones.`);
  if (tablas > 0) advertencias.push(`Se simplificaron ${tablas} ${pluralizar(tablas, 'tabla', 'tablas')} a texto con celdas separadas por tabulador (las tablas reales aún no se admiten).`);

  return advertencias;
}

/**
 * Construye el modelo a partir del texto YA DECODIFICADO (UTF-8) de
 * `word/document.xml` y, si existen, `word/styles.xml`/`word/numbering.xml`.
 * PURO: no lee el ZIP (eso lo hace `ConversorDocxNavegador`, que decodifica
 * cada entrada y llama aquí).
 */
export function construirModeloDocx(documentXml: string, stylesXml: string | null, numberingXml: string | null): ModeloDocx {
  const docRoot = parseXml(documentXml);
  const body = primerHijo(docRoot, 'w:body');
  if (!body) throw new DocxError('El documento .docx no tiene contenido (falta <w:body> en document.xml).');

  const { estilos, docDefaultsPPr, docDefaultsRPr, estiloParrafoPorDefecto } = stylesXml
    ? leerEstilos(parseXml(stylesXml))
    : { estilos: new Map<string, EstiloDef>(), docDefaultsPPr: null, docDefaultsRPr: null, estiloParrafoPorDefecto: null };
  const { numMap, abstractNums } = numberingXml
    ? leerNumbering(parseXml(numberingXml))
    : { numMap: new Map<string, string>(), abstractNums: new Map<string, AbstractNumDef>() };

  const ctx: Contexto = { estilos, docDefaultsPPr, docDefaultsRPr, estiloParrafoPorDefecto, numMap, abstractNums, contadoresListas: new Map() };

  const parrafos: Parrafo[] = [];
  let sectPrFinal: XmlElemento | null = null;
  let tablas = 0;

  for (const hijo of aplanarCuerpo(body)) {
    if (hijo.nombre === 'w:p') {
      const pPr = primerHijo(hijo, 'w:pPr');
      const sectPrParrafo = pPr ? primerHijo(pPr, 'w:sectPr') : null;
      if (sectPrParrafo) sectPrFinal = sectPrParrafo;
      parrafos.push(procesarParrafo(hijo, ctx));
    } else if (hijo.nombre === 'w:tbl') {
      tablas++;
      parrafos.push(...procesarTabla(hijo, ctx));
    } else if (hijo.nombre === 'w:sectPr') {
      sectPrFinal = hijo;
    }
  }

  const geo = leerGeometriaPagina(sectPrFinal);
  const advertencias = construirAdvertencias(docRoot, tablas);

  return {
    paginaAnchoPt: geo.anchoPt, paginaAltoPt: geo.altoPt,
    margenSupPt: geo.margenSup, margenInfPt: geo.margenInf, margenIzqPt: geo.margenIzq, margenDerPt: geo.margenDer,
    parrafos, advertencias
  };
}
