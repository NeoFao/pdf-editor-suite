import { DocxError } from './DocxError';
import { formatoNumero, aplicarLvlText } from './numeracion';
import { resolverVineta, type VinetaResuelta } from './vinetas';
import { omitido, aproximado, type Advertencia, type TipoAdvertencia } from '../advertencia';
import { parseXml, hijosElemento, primerHijo, textoDirecto, buscarDescendiente, type XmlElemento } from './xml';
import { classifyFont } from '../../engine/fontClassify';
import { leerRelaciones, rutaMediaDesdeWord, type Relacion } from './rels';
import { validarUrlEnlace } from '../../engine/validarUrlEnlace';
import type { PosFlotanteH, PosFlotanteV, AjusteFlotante } from '../flujo/layout';

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
 * Fase 2c: VARIAS SECCIONES (`ModeloDocx.secciones`: cada `w:sectPr` con su
 * tamaño/orientación, márgenes, encabezados y pies —heredados de la anterior
 * si no los redefine—, `w:titlePg`, `w:type` y `w:pgNumType w:start`),
 * imágenes y tablas dentro de encabezados y pies (con las relaciones del
 * PROPIO encabezado), ajuste de texto alrededor de imágenes flotantes
 * (`wp:wrapSquare`/`wp:wrapTopAndBottom`; el resto, a cuadrado con aviso) y
 * paradas de tabulación (`w:tabs`, heredables del estilo, y `w:ptab`).
 * Los campos de siempre (`paginaAnchoPt`, `encabezados`...) describen la
 * ÚLTIMA sección (compatibilidad con modelos y tests anteriores).
 *
 * Simplificaciones deliberadas de las fases 2a/2b (documentadas también en el
 * spec y en la fila #4 de la tabla §9):
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
 * - Fase 2b: `w:keepNext`/`w:keepLines` se respetan (un título mantiene con el
 *   párrafo siguiente aunque su estilo no lo diga, salvo `keepNext w:val="0"`);
 *   sin control de viudas y huérfanas de línea suelta (`w:widowControl`).
 * - Los saltos de columna (`w:br` sin `w:type` o `w:type="column"`, fuera de
 *   `w:type="page"`) se tratan como saltos de línea simples (esta fase no
 *   admite columnas).
 * - Tablas: bordes POR LADO de tabla (`w:tblBorders`, o los de su `w:tblStyle`)
 *   y por celda (`w:tcBorders`, fase 2b; precedencia celda > tabla; `w:sz` en
 *   octavos de punto; estilos no continuos se dibujan continuos con aviso);
 *   una celda es un único flujo lógico (varios `w:p` se unen con salto de
 *   línea); `w:vMerge` se dibuja como UNA celda; sin tablas anidadas.
 * - Imágenes: `wp:inline` (en el flujo) y, fase 2b, `wp:anchor` (flotante)
 *   colocada en su posición de página/margen/párrafo SIN ajuste de texto y con
 *   aviso; EMF/WMF y cualquier formato que ni el decodificador PNG propio
 *   (`decodificarPng.ts`) ni `createImageBitmap` entiendan se avisan.
 * - Encabezados y pies: `default`/`first` (`w:titlePg`)/`even`
 *   (`w:evenAndOddHeaders`), con `PAGE`/`NUMPAGES`, imágenes y tablas (2c).
 * - Tabulaciones (2c): reales también dentro de una celda de tabla (E-101), con las
 *   paradas de su párrafo medidas desde el borde interior de la celda.
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

/** Posición de una imagen flotante (`wp:anchor`), ya convertida a pt: ver `PosFlotanteH/V` del maquetador (mismo tipo, mismas unidades). `ajuste` (fase 2c): cómo la rodea el texto; sin él, el texto no se aparta. */
export interface PosicionFlotante { h: PosFlotanteH; v: PosFlotanteV; ajuste?: AjusteFlotante }

/** Relleno de una parada de tabulación (`w:leader`). */
export type LiderTab = 'none' | 'dot' | 'hyphen' | 'underscore';
/**
 * Comienzo de un párrafo DENTRO de una celda (E-102, E-103): el formato de párrafo efectivo (`pPrEfectivo`, el mismo que el del
 * cuerpo: estilo + directo + numeración) que la celda aplica a las líneas hasta el siguiente `inicioParrafo` o `saltoLinea`.
 * Todo en pt (1/20 de twip ya convertido); `sangriaIzqPt`/`sangriaDerPt` se miden desde el borde INTERIOR de la celda.
 */
export interface InicioParrafoCelda {
  tipo: 'inicioParrafo';
  lista: InfoLista | null;
  sangriaIzqPt: number; sangriaPrimeraLineaPt: number; sangriaDerPt: number;
  alineacion: Alineacion;
  espacioAntesPt: number; espacioDespuesPt: number;
  interlineadoFactor: number; interlineadoExactoPt: number | null;
}

/** Parada de tabulación de un párrafo (`w:tabs > w:tab`): `posPt` en puntos PDF desde el margen izquierdo de la página. */
export interface ParadaTab { posPt: number; tipo: 'left' | 'center' | 'right' | 'decimal'; leader: LiderTab }

export type ParteParrafo =
  /** `url`, cuando está presente, es la URL YA VALIDADA (`validarUrlEnlace`) de un `w:hyperlink` que envuelve este texto. */
  | { tipo: 'texto'; texto: string; formato: RunFormato; url?: string }
  /**
   * Tabulación. `ptab` (`w:ptab`, tabulación de posición): salta a una alineación respecto al margen en vez de a una parada.
   * `paradas` (solo dentro de una celda de tabla, E-101): las paradas efectivas de SU párrafo (estilo + directas), con `posPt`
   * medido desde el borde interior de la celda; en un párrafo normal viven en `Parrafo.tabs`.
   */
  | { tipo: 'tab'; ptab?: { alineacion: 'left' | 'center' | 'right'; leader: LiderTab }; paradas?: ParadaTab[] }
  | { tipo: 'saltoLinea' }
  | { tipo: 'saltoPagina' }
  /**
   * Solo dentro de una celda de tabla (E-102): arranque de un párrafo de LISTA de la celda. Lleva su marcador (el mismo cálculo y
   * los mismos contadores que un párrafo de cuerpo) y la sangría del nivel (pt PDF, desde el borde interior de la celda).
   */
  | InicioParrafoCelda
  /** Imagen inline (`w:drawing > wp:inline`, fase 2a). `refId` es la ruta dentro del ZIP del .docx (p. ej. `word/media/image1.png`); `wPt`/`hPt` son el tamaño DECLARADO por Word (`wp:extent`, EMU → pt), sin clampar todavía al ancho útil de página — eso lo hace `render.ts`, que conoce la geometría. */
  | { tipo: 'imagen'; refId: string; wPt: number; hPt: number;
    /** Fase 2b: presente si es una imagen FLOTANTE (`wp:anchor`) — se coloca en su posición sin ajuste de texto. Sin esto, es inline. */
    flotante?: PosicionFlotante }
  /** Campo de número de página (fase 2b, solo en encabezados/pies): `PAGE` = página actual, `NUMPAGES` = total. `formato` es el del run, para pintar el número con el mismo estilo. */
  | { tipo: 'campo'; campo: 'PAGE' | 'NUMPAGES'; formato: RunFormato };

/**
 * Marcador de un párrafo de lista. `fuenteMarcador`/`escalaMarcador` (E-102): fuente estándar PDF y factor de tamaño con que se
 * dibuja (viñetas de Wingdings/Symbol → ZapfDingbats...); sin ellos, Helvetica a tamaño 1.
 */
export interface InfoLista { textoMarcador: string; fuenteMarcador?: string; escalaMarcador?: number }

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
  /** `w:keepNext` (o un título sin `keepNext` explícito): la última línea del párrafo no puede quedar sola al pie de una página, sin la primera línea del siguiente. */
  mantenerConSiguiente: boolean;
  /** `w:keepLines` (o un título sin `keepLines` explícito): todas las líneas del párrafo en la misma página. */
  mantenerLineasJuntas: boolean;
  /** Paradas de tabulación efectivas (estilo + párrafo, con `clear` aplicado), ordenadas por posición. */
  tabs: ParadaTab[];
}

/** Un borde: color + grosor en PUNTOS PDF (`w:sz` está en OCTAVOS de punto: 24 → 3 pt). */
export interface Borde { color: RGB; grosorPt: number }
/** Bordes por lado de una celda (`w:tcBorders`): `undefined` = no definido (hereda de la tabla), `null` = `nil`/`none` explícito (sin borde, gana a la tabla). */
export interface BordesCelda { top?: Borde | null; bottom?: Borde | null; left?: Borde | null; right?: Borde | null }
/** Bordes de tabla por lado (`w:tblBorders`), con los interiores `insideH`/`insideV`. */
export interface BordesTabla extends BordesCelda { insideH?: Borde | null; insideV?: Borde | null }

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
  /** Alineación del PRIMER párrafo de la celda (valor por defecto de un modelo sin `inicioParrafo`); cada párrafo lleva la suya en su `inicioParrafo`. */
  alineacion: Alineacion;
  /** Fase 2b: `w:tcBorders` de la celda (precedencia celda > tabla). `undefined` si la celda no declara ninguno. */
  bordes?: BordesCelda;
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
  /** Fase 2b: bordes de tabla POR LADO (`w:tblBorders`, o los del estilo de tabla `w:tblStyle`). Si falta (modelo construido a mano), `render.ts` usa `bordeColor`/`bordeGrosorPt` para todos los lados. */
  bordesTabla?: BordesTabla;
}

/** Bloque de nivel superior del documento: párrafo o tabla, en el orden en que aparecen. */
export type BloqueDocx = Parrafo | Tabla;

/** Contenido de un encabezado o pie (fase 2c: párrafos con imágenes y tablas). `null` = el tipo no está definido. */
export interface ZonaPaginaModelo { default: BloqueDocx[] | null; first: BloqueDocx[] | null; even: BloqueDocx[] | null }

/**
 * Una sección (`w:sectPr`), fase 2c: los bloques `[inicioBloque, finBloque)` de `ModeloDocx.bloques` le pertenecen.
 * `tipo`: cómo EMPIEZA la sección (`w:type`); `evenPage`/`oddPage`/`nextColumn` ya vienen normalizados a `nextPage`
 * (con aviso). `encabezados`/`pies` ya vienen resueltos con la herencia de la sección anterior.
 * `numeroInicial`: `w:pgNumType w:start`, o `null` si la numeración continúa.
 */
export interface SeccionDocx {
  paginaAnchoPt: number; paginaAltoPt: number;
  margenSupPt: number; margenInfPt: number; margenIzqPt: number; margenDerPt: number;
  margenEncabezadoPt: number; margenPiePt: number;
  tipo: 'nextPage' | 'continuous';
  tituloPagina: boolean;
  encabezados: ZonaPaginaModelo; pies: ZonaPaginaModelo;
  numeroInicial: number | null;
  inicioBloque: number; finBloque: number;
}

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
  advertencias: Advertencia[];
  /** Distancia del borde superior de la página al encabezado (`w:pgMar w:header`), en pt. */
  margenEncabezadoPt: number;
  /** Distancia del borde inferior de la página al pie (`w:pgMar w:footer`), en pt. */
  margenPiePt: number;
  /** `w:titlePg`: la primera página usa el encabezado/pie `first` (aunque esté vacío). */
  tituloPagina: boolean;
  /** `w:evenAndOddHeaders` (settings.xml): las páginas pares usan el encabezado/pie `even`. */
  paresImpares: boolean;
  encabezados: ZonaPaginaModelo;
  pies: ZonaPaginaModelo;
  /** Fase 2c: todas las secciones en orden. Opcional solo para modelos construidos a mano (sin él, `render` deduce UNA sección de los campos de arriba). */
  secciones?: SeccionDocx[];
  /** Intervalo de las paradas de tabulación por defecto (`w:defaultTabStop` de settings.xml), en pt. 36 (720 twips) si no está. */
  tabPorDefectoPt: number;
}

/**
 * Partes adicionales del paquete que `construirModeloDocx` necesita ya decodificadas: `partes` se indexa por ruta dentro del
 * ZIP (`word/header1.xml`); `relsPartes`, por la ruta de la PARTE a la que pertenecen, con el XML de sus relaciones
 * (`word/_rels/header1.xml.rels` → clave `word/header1.xml`): las imágenes de un encabezado se resuelven con ellas.
 */
export interface ExtrasDocx { settingsXml?: string | null; partes?: Record<string, string>; relsPartes?: Record<string, string> }

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
  /** `w:tblPr` del estilo (estilos de TABLA: de ahí vienen los bordes de "Table Grid"). */
  tblPr: XmlElemento | null;
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
      pPr: primerHijo(est, 'w:pPr'), rPr: primerHijo(est, 'w:rPr'), tblPr: primerHijo(est, 'w:tblPr')
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

/** `inicio`: `w:start` (1 si falta); `lvlText`: plantilla del marcador (`%1.%2.`), `null` si el nivel no la declara. */
interface NivelListaDef { formato: string; sangriaIzqPt: number; sangriaColganteP: number; inicio: number; lvlText: string | null; fuenteVineta: string | null }
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
      const rFontsVineta = (() => { const r = primerHijo(lvl, 'w:rPr'); return r ? primerHijo(r, 'w:rFonts') : null; })();
      const inicioAttr = Number(primerHijo(lvl, 'w:start')?.atributos['w:val']);
      niveles.set(ilvl, {
        formato: numFmt,
        inicio: Number.isFinite(inicioAttr) ? inicioAttr : 1,
        lvlText: primerHijo(lvl, 'w:lvlText')?.atributos['w:val'] ?? null,
        fuenteVineta: rFontsVineta?.atributos['w:ascii'] ?? rFontsVineta?.atributos['w:hAnsi'] ?? null,
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

/**
 * Numeración CORRELATIVA por lista y nivel (E-101): cada nivel lleva su propio contador (`null` = aún sin usar, el primero
 * vale `w:start`), y avanzar un nivel más superficial reinicia los más profundos (igual que Word). El marcador sale de
 * `w:lvlText` sustituyendo `%N` por el contador del nivel N-1 con el formato de ESE nivel. Estado en
 * `ctx.contadoresListas`, uno por documento. Un `numFmt` no soportado se numera con cifras y se avisa.
 */
function siguienteMarcador(numId: string, ilvl: number, nivel: NivelListaDef, ctx: Contexto): InfoLista {
  let contadores = ctx.contadoresListas.get(numId);
  if (!contadores) { contadores = new Array<number | null>(9).fill(null); ctx.contadoresListas.set(numId, contadores); }
  const previo = contadores[ilvl] ?? null;
  contadores[ilvl] = previo === null ? nivel.inicio : previo + 1;
  for (let i = ilvl + 1; i < contadores.length; i++) contadores[i] = null;
  const niveles = ctx.abstractNums.get(ctx.numMap.get(numId) ?? '')?.niveles;
  const formateado = (k: number): string => {
    const def = k === ilvl ? nivel : niveles?.get(k);
    const valor = contadores![k] ?? def?.inicio ?? 1;
    const f = formatoNumero(valor, def?.formato ?? 'decimal');
    if (f === null) { anotar(ctx, 'listaFormato'); return String(valor); }
    return f;
  };
  if (nivel.formato === 'bullet') {
    const v = resolverVineta(nivel.lvlText, nivel.fuenteVineta);
    if (v.aproximada) avisarVineta(v, nivel.fuenteVineta, ctx);
    return { textoMarcador: v.texto, fuenteMarcador: v.font, escalaMarcador: v.escala };
  }
  const plantilla = nivel.lvlText ?? `%${ilvl + 1}.`;
  return { textoMarcador: aplicarLvlText(plantilla, Array.from({ length: ilvl + 1 }, (_v, k) => formateado(k))) };
}

/** Aviso `vinetaFuente` (aproximado), uno por par original/dibujado: dice QUÉ carácter pedía Word y CUÁL se dibujó. */
function avisarVineta(v: VinetaResuelta, fuente: string | null, ctx: Contexto): void {
  const cod = (c: string): string => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
  const clave = `${fuente ?? ''}|${v.oficial}|${v.texto}|${v.font}`;
  if (ctx.vinetasAvisadas.has(clave)) return;
  ctx.vinetasAvisadas.add(clave);
  const original = /[-]/.test(v.oficial) ? cod(v.oficial) : `"${v.oficial}" (${cod(v.oficial)})`;
  const dibujado = v.font === 'Helvetica' ? `"${v.texto}"` : `"${v.texto}" (${v.font}${v.escala !== 1 ? ` al ${Math.round(v.escala * 100)} %` : ''})`;
  ctx.advertenciasExtra.push(aproximado(`vinetaFuente: la viñeta ${original}${fuente ? ` de ${fuente}` : ''} se dibujó como ${dibujado}: ninguna fuente estándar del PDF tiene ese glifo exacto.`));
}

function calcularInfoLista(numId: string, ilvl: number, ctx: Contexto): InfoLista | null {
  const nivel = obtenerNivelLista(numId, ilvl, ctx);
  if (!nivel) return null;
  return siguienteMarcador(numId, ilvl, nivel, ctx);
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
  /** `null` = no declarado (un título lo activa por defecto, como los estilos Heading de Word). */
  keepNext: boolean | null; keepLines: boolean | null;
  /** Paradas por posición (pt desde el margen izquierdo): una posterior sustituye a la anterior, `clear` la borra. */
  tabs: Map<number, ParadaTab>;
}

function pPrPorDefecto(): PPrAcum {
  return {
    alineacion: 'left', sangriaIzqPt: 0, sangriaDerPt: 0, sangriaPrimeraLineaPt: 0,
    espacioAntesPt: 0, espacioDespuesPt: 8, interlineadoFactor: 1.15, interlineadoExactoPt: null,
    saltoPaginaAntes: false, numId: null, ilvl: 0, outlineLvl: null, keepNext: null, keepLines: null, tabs: new Map()
  };
}

function mapAlineacion(v: string): Alineacion {
  if (v === 'center') return 'center';
  if (v === 'right' || v === 'end') return 'right';
  if (v === 'both' || v === 'distribute') return 'justify';
  return 'left';
}

function leerLider(v: string | undefined): LiderTab {
  if (v === 'dot' || v === 'middleDot') return 'dot';
  if (v === 'hyphen') return 'hyphen';
  if (v === 'underscore' || v === 'heavy') return 'underscore';
  return 'none';
}

function aplicarTabs(acc: PPrAcum, tabs: XmlElemento): void {
  for (const t of hijosElemento(tabs, 'w:tab')) {
    const pos = Number(t.atributos['w:pos']);
    if (!Number.isFinite(pos)) continue;
    const posPt = twipsAPt(pos);
    const val = t.atributos['w:val'] ?? 'left';
    if (val === 'clear') { acc.tabs.delete(posPt); continue; }
    if (val === 'bar') continue; // la barra vertical no es una parada de texto
    const tipo = val === 'center' ? 'center' : val === 'right' || val === 'end' ? 'right' : val === 'decimal' ? 'decimal' : 'left';
    acc.tabs.set(posPt, { posPt, tipo, leader: leerLider(t.atributos['w:leader']) });
  }
}

function aplicarPPr(acc: PPrAcum, el: XmlElemento): void {
  const tabsEl = primerHijo(el, 'w:tabs'); if (tabsEl) aplicarTabs(acc, tabsEl);
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
  const kn = primerHijo(el, 'w:keepNext'); if (kn) acc.keepNext = leerToggle(kn);
  const kl = primerHijo(el, 'w:keepLines'); if (kl) acc.keepLines = leerToggle(kl);
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
  contadoresListas: Map<string, (number | null)[]>;
  /** Viñetas ya avisadas (`vinetaFuente`), para un aviso por par original/dibujado. */
  vinetasAvisadas: Set<string>;
  /** `word/_rels/document.xml.rels` ya parseado (`null` si el .docx no lo trae, p. ej. sin imágenes ni enlaces). */
  rels: Map<string, Relacion> | null;
  /**
   * Advertencias que solo se pueden generar AL RECORRER (imagen inline no
   * resuelta/flotante, enlace con esquema rechazado...) — a diferencia de
   * `construirAdvertencias`, que cuenta patrones estructurales escaneando
   * todo el árbol al final. Se combinan al construir el `ModeloDocx` final.
   */
  advertenciasExtra: Advertencia[];
  /** Descartes/degradaciones contados por tipo (`anotar`); se convierten en avisos al final (`MENSAJES_PERDIDAS`). */
  perdidas: Map<string, number>;
  /** `true` mientras se procesa un encabezado o pie: ahí `PAGE`/`NUMPAGES` son campos reales y las imágenes se omiten con aviso. */
  zona: boolean;
  /** `true` mientras se procesa una celda de tabla: ahí una imagen se omite con aviso (`imagenEnCelda`). */
  enCelda: boolean;
  /** `w:pPr` de la cadena del estilo de la tabla en curso (de la raíz a la hoja): base de los párrafos de sus celdas, entre docDefaults y el estilo de párrafo (E-103). */
  pPrTabla: XmlElemento[];
  /** Campos complejos (`w:fldChar`) abiertos, el más interno al final. `suprimir`: el resultado cacheado se descarta porque ya se emitió un `campo`. */
  camposAbiertos: { instr: string; separado: boolean; suprimir: boolean; emitido: boolean }[];
}

function anotar(ctx: Contexto, clave: string): void { ctx.perdidas.set(clave, (ctx.perdidas.get(clave) ?? 0) + 1); }

function cuenta(c: number, uno: string, varios: string): string { return c === 1 ? uno : varios.replace('{n}', String(c)); }

/** Texto de cada tipo de pérdida (nada se descarta o degrada en silencio, AGENTS.md §3). Orden = orden de aparición en el aviso. */
const MENSAJES_PERDIDAS: [string, TipoAdvertencia, (c: number) => string][] = [
  ['enlaceInterno', 'aproximado', (c) => cuenta(c, 'Un enlace interno (a un marcador del documento) se dejó como texto sin enlace.', '{n} enlaces internos (a marcadores del documento) se dejaron como texto sin enlace.')],
  ['enlaceSinDestino', 'aproximado', (c) => cuenta(c, 'Un enlace sin destino resoluble se dejó como texto sin enlace.', '{n} enlaces sin destino resoluble se dejaron como texto sin enlace.')],
  ['desconocido', 'omitido', (c) => cuenta(c, 'Se omitió el texto de un elemento no reconocido del documento.', 'Se omitió el texto de {n} elementos no reconocidos del documento.')],
  ['ecuacion', 'omitido', (c) => cuenta(c, 'Se omitió una ecuación (aún no soportada).', 'Se omitieron {n} ecuaciones (aún no soportadas).')],
  ['sym', 'omitido', (c) => cuenta(c, 'Se omitió un símbolo especial (w:sym).', 'Se omitieron {n} símbolos especiales (w:sym).')],
  ['saltoColumna', 'aproximado', (c) => cuenta(c, 'Un salto de columna se trató como salto de línea (sin columnas).', '{n} saltos de columna se trataron como saltos de línea (sin columnas).')],
  ['listaSinDef', 'aproximado', (c) => cuenta(c, 'Un párrafo de lista cuya numeración no está definida se maquetó sin marcador.', '{n} párrafos de lista cuya numeración no está definida se maquetaron sin marcador.')],
  ['tablaAnidada', 'aproximado', (c) => cuenta(c, 'Una tabla anidada dentro de otra se aplanó a texto (celdas separadas por tabulador).', '{n} tablas anidadas se aplanaron a texto (celdas separadas por tabulador).')],
  ['imagenEnCelda', 'omitido', (c) => cuenta(c, 'Se omitió una imagen dentro de una celda de tabla (aún no soportado).', 'Se omitieron {n} imágenes dentro de celdas de tabla (aún no soportado).')],
  ['saltoPaginaEnCelda', 'aproximado', (c) => cuenta(c, 'Un salto de página dentro de una celda de tabla se trató como salto de línea.', '{n} saltos de página dentro de celdas de tabla se trataron como saltos de línea.')],
  ['flotante', 'aproximado', (c) => cuenta(c, 'Imagen flotante colocada sin ajuste de texto (el texto no la rodea y puede quedar debajo o encima de ella).', '{n} imágenes flotantes colocadas sin ajuste de texto (el texto no las rodea y puede quedar debajo o encima de ellas).')],
  ['flotanteAprox', 'aproximado', (c) => cuenta(c, 'El ajuste de texto de una imagen flotante con contorno (estrecho o a través, con polígono) se aproximó a un cuadrado.', 'El ajuste de texto de {n} imágenes flotantes con contorno (estrecho o a través, con polígono) se aproximó a un cuadrado.')],
  ['listaFormato', 'aproximado', (c) => cuenta(c, 'Un párrafo de lista usa un formato de numeración no soportado (p. ej. ordinales en letras) y se numeró con cifras.', '{n} párrafos de lista usan un formato de numeración no soportado (p. ej. ordinales en letras) y se numeraron con cifras.')],
  ['seccionParImpar', 'aproximado', (c) => cuenta(c, 'Un salto de sección de tipo página par, página impar o columna siguiente se trató como un salto a página nueva.', '{n} saltos de sección de tipo página par, página impar o columna siguiente se trataron como saltos a página nueva.')],
  ['numeroPaginaFormato', 'aproximado', (c) => cuenta(c, 'El formato de numeración de página de una sección (romano, letras...) no se reproduce: se numera con cifras arábigas.', 'El formato de numeración de página de {n} secciones (romano, letras...) no se reproduce: se numera con cifras arábigas.')],
  ['numeroPaginaContinua', 'aproximado', (c) => cuenta(c, 'El reinicio de numeración de página de una sección continua se ignoró (la numeración sigue por páginas).', 'El reinicio de numeración de página de {n} secciones continuas se ignoró (la numeración sigue por páginas).')],
  ['campo', 'aproximado', (c) => cuenta(c, 'Un campo no soportado (fecha, índice, referencia...) se dejó con el último valor que Word guardó.', '{n} campos no soportados (fecha, índice, referencia...) se dejaron con el último valor que Word guardó.')],
  ['bordeEstilo', 'aproximado', (c) => cuenta(c, 'Un borde de tabla con estilo no continuo (doble, punteado...) se dibujó como línea continua.', '{n} bordes de tabla con estilo no continuo (doble, punteado...) se dibujaron como línea continua.')],
  ['encabezadoFaltante', 'omitido', (c) => cuenta(c, 'Se omitió un encabezado de página (no se encontró o no se pudo leer su contenido en el paquete).', 'Se omitieron {n} encabezados de página (no se encontró o no se pudo leer su contenido en el paquete).')],
  ['pieFaltante', 'omitido', (c) => cuenta(c, 'Se omitió un pie de página (no se encontró o no se pudo leer su contenido en el paquete).', 'Se omitieron {n} pies de página (no se encontró o no se pudo leer su contenido en el paquete).')],
  ['vMergeConTexto', 'omitido', (c) => cuenta(c, 'Una celda de continuación de una combinación vertical traía texto propio, que no se muestra (como hace Word).', '{n} celdas de continuación de combinaciones verticales traían texto propio, que no se muestra (como hace Word).')]
];

/** Hijos de un run que son ruido estructural o se cuentan aparte: no avisan por sí mismos. */
const RUIDO_RUN = new Set(['w:rPr', 'w:lastRenderedPageBreak', 'w:softHyphen', 'w:instrText', 'w:fldChar', 'w:footnoteReference', 'w:endnoteReference', 'w:commentReference', 'w:annotationRef', 'w:footnoteRef', 'w:endnoteRef', 'w:separator', 'w:continuationSeparator', 'w:pict', 'w:object', 'w:delText', 'w:delInstrText', 'w:t', 'w:tab', 'w:br', 'w:noBreakHyphen', 'w:drawing', 'w:sym', 'w:cr', 'w:ptab', 'mc:AlternateContent']);
/** Ídem para hijos directos de un párrafo. */
const RUIDO_PARRAFO = new Set(['w:pPr', 'w:bookmarkStart', 'w:bookmarkEnd', 'w:proofErr', 'w:permStart', 'w:permEnd', 'w:commentRangeStart', 'w:commentRangeEnd', 'w:moveFromRangeStart', 'w:moveFromRangeEnd', 'w:moveToRangeStart', 'w:moveToRangeEnd', 'w:del', 'w:moveFrom', 'w:r', 'w:hyperlink', 'w:ins', 'w:smartTag', 'w:sdt', 'w:fldSimple', 'w:customXml', 'w:dir', 'w:bdo', 'w:moveTo', 'm:oMath', 'm:oMathPara']);

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
  const formato = formatoDeAcc(acc);

  for (const h of runEl.hijos) {
    if (h.tipo !== 'elemento') continue;
    if (h.nombre === 'w:fldChar') { procesarFldChar(h, formato, ctx, partes); continue; }
    if (h.nombre === 'w:instrText') { const abierto = ctx.camposAbiertos[ctx.camposAbiertos.length - 1]; if (abierto && !abierto.separado) abierto.instr += textoDirecto(h); continue; }
    // Resultado cacheado de un campo ya sustituido (PAGE/NUMPAGES): se descarta, el número real se pinta al maquetar.
    if (ctx.camposAbiertos.some((c) => c.suprimir) && (h.nombre === 'w:t' || h.nombre === 'w:tab' || h.nombre === 'w:br' || h.nombre === 'w:cr' || h.nombre === 'w:noBreakHyphen')) continue;
    if (h.nombre === 'w:t') { const t = textoDirecto(h); if (t.length > 0) partes.push({ tipo: 'texto', texto: t, formato }); }
    else if (h.nombre === 'w:tab') partes.push({ tipo: 'tab' });
    else if (h.nombre === 'w:br') {
      if (h.atributos['w:type'] === 'column') anotar(ctx, 'saltoColumna');
      partes.push({ tipo: h.atributos['w:type'] === 'page' ? 'saltoPagina' : 'saltoLinea' });
    }
    else if (h.nombre === 'w:cr') partes.push({ tipo: 'saltoLinea' });
    else if (h.nombre === 'w:ptab') {
      const al = h.atributos['w:alignment'];
      partes.push({ tipo: 'tab', ptab: { alineacion: al === 'right' ? 'right' : al === 'center' ? 'center' : 'left', leader: leerLider(h.atributos['w:leader']) } });
    }
    else if (h.nombre === 'w:sym') anotar(ctx, 'sym');
    else if (h.nombre === 'w:noBreakHyphen') partes.push({ tipo: 'texto', texto: '-', formato });
    else if (h.nombre === 'w:drawing') { const parte = resolverImagenDrawing(h, ctx); if (parte) partes.push(parte); }
    else if (h.nombre === 'mc:AlternateContent') {
      // Word envuelve formas/dibujos modernos aquí: la parte útil está en el primer `w:drawing` de `mc:Choice`.
      const dibujo = buscarDescendiente(h, 'w:drawing');
      if (dibujo) { const parte = resolverImagenDrawing(dibujo, ctx); if (parte) partes.push(parte); }
      else if (!buscarDescendiente(h, 'w:pict')) anotar(ctx, 'desconocido');
    }
    else if (!RUIDO_RUN.has(h.nombre) && buscarDescendiente(h, 'w:t')) anotar(ctx, 'desconocido');
    // w:pict (VML, Word <2007), w:footnoteReference, w:commentReference,
    // w:fldChar, w:instrText, w:delText...: contenido no soportado en esta
    // fase, contado aparte en `construirAdvertencias` (no se pierde en silencio).
  }
}

function formatoDeAcc(acc: RPrAcum): RunFormato {
  return { font: fuenteEstandarPara(acc.fontName, acc.bold, acc.italic), sizePt: acc.sizePt, color: acc.color, underline: acc.underline };
}

/**
 * Campo de número de página reconocido en una instrucción (`PAGE`, `NUMPAGES`), o `null`. Un campo con formato
 * numérico distinto del arábigo (switch de formato ROMAN/ALPHABETIC) NO se reconoce: se dejaría el número en otro formato.
 */
function campoDePagina(instr: string): 'PAGE' | 'NUMPAGES' | null {
  const m = /^\s*(PAGE|NUMPAGES)\b/i.exec(instr);
  if (!m) return null;
  if (/\\\*\s*(roman|alphabetic)/i.test(instr)) return null;
  return m[1]!.toUpperCase() as 'PAGE' | 'NUMPAGES';
}

/** `w:fldChar` (campo complejo): begin → abre; separate → decide (PAGE/NUMPAGES: emite el campo y suprime el resultado cacheado); end → cierra. */
function procesarFldChar(el: XmlElemento, formato: RunFormato, ctx: Contexto, partes: ParteParrafo[]): void {
  const tipo = el.atributos['w:fldCharType'];
  if (tipo === 'begin') { ctx.camposAbiertos.push({ instr: '', separado: false, suprimir: false, emitido: false }); return; }
  const actual = ctx.camposAbiertos[ctx.camposAbiertos.length - 1];
  if (!actual) return;
  const resolver = (): void => {
    if (actual.emitido) return;
    actual.emitido = true;
    const campo = ctx.zona ? campoDePagina(actual.instr) : null;
    if (campo) { partes.push({ tipo: 'campo', campo, formato }); actual.suprimir = true; }
    else anotar(ctx, 'campo');
  };
  if (tipo === 'separate') { actual.separado = true; resolver(); }
  else if (tipo === 'end') { resolver(); ctx.camposAbiertos.pop(); }
}

/**
 * Resuelve un `w:drawing` a su `ParteParrafo` de imagen, o `null` si no se
 * pudo (con la advertencia correspondiente ya empujada a
 * `ctx.advertenciasExtra` — nunca se pierde en silencio, AGENTS.md §3).
 * `wp:inline` (imagen en el flujo de texto) y, desde la fase 2b, `wp:anchor`
 * (imagen flotante): se coloca en su posición (página/margen/párrafo) SIN
 * ajuste de texto y se avisa (`flotante`). Dentro de un encabezado o pie, se
 * omite con aviso (aún no soportado ahí).
 */
function resolverImagenDrawing(drawing: XmlElemento, ctx: Contexto): ParteParrafo | null {
  const anchor = primerHijo(drawing, 'wp:anchor');
  const inline = anchor ?? primerHijo(drawing, 'wp:inline');
  if (!inline) {
    ctx.advertenciasExtra.push(omitido('No se pudo insertar una imagen del documento (formato de dibujo no reconocido).'));
    return null;
  }
  const extent = primerHijo(inline, 'wp:extent');
  const blip = buscarDescendiente(inline, 'a:blip');
  const embedId = blip?.atributos['r:embed'];
  if (!extent || !embedId) {
    ctx.advertenciasExtra.push(omitido('No se pudo insertar una imagen del documento (faltan sus datos de tamaño u origen).'));
    return null;
  }
  const rel = ctx.rels?.get(embedId);
  if (!rel) {
    ctx.advertenciasExtra.push(omitido('No se pudo insertar una imagen del documento (no se encontró su relación en el paquete).'));
    return null;
  }
  const cx = Number(extent.atributos['cx'] ?? '0');
  const cy = Number(extent.atributos['cy'] ?? '0');
  if (!(cx > 0) || !(cy > 0)) {
    ctx.advertenciasExtra.push(omitido('No se pudo insertar una imagen del documento (tamaño declarado inválido).'));
    return null;
  }
  const base = { tipo: 'imagen' as const, refId: rutaMediaDesdeWord(rel.target), wPt: cx / EMU_POR_PUNTO, hPt: cy / EMU_POR_PUNTO };
  if (!anchor) return base;
  const ajuste = leerAjuste(anchor, ctx);
  // Sin ajuste de texto (wrapNone o sin elemento de ajuste) se avisa; dentro de una celda se omitirá con su propio aviso (`imagenEnCelda`).
  if (!ajuste && !ctx.enCelda) anotar(ctx, 'flotante');
  return { ...base, flotante: { ...leerPosicionAnchor(anchor), ...(ajuste ? { ajuste } : {}) } };
}

/**
 * Ajuste de texto de un `wp:anchor` (fase 2c). `wrapSquare` → `square`; `wrapTopAndBottom` → `topBottom`; `wrapTight`/`wrapThrough`
 * (polígono) → `square` con aviso "aproximado"; `wrapNone` o ninguno → `undefined` (sin ajuste). Las distancias
 * (`distT/B/L/R`, EMU → pt) salen del propio elemento de ajuste si las trae y, si no, de `wp:anchor`.
 */
function leerAjuste(anchor: XmlElemento, ctx: Contexto): AjusteFlotante | undefined {
  const cuadrado = primerHijo(anchor, 'wp:wrapSquare');
  const arribaAbajo = primerHijo(anchor, 'wp:wrapTopAndBottom');
  const contorno = primerHijo(anchor, 'wp:wrapTight') ?? primerHijo(anchor, 'wp:wrapThrough');
  const el = cuadrado ?? arribaAbajo ?? contorno;
  if (!el) return undefined;
  const dist = (n: string): number => {
    const v = Number(el.atributos[n] ?? anchor.atributos[n] ?? '0');
    return Number.isFinite(v) && v > 0 ? v / EMU_POR_PUNTO : 0;
  };
  if (contorno && !ctx.enCelda) anotar(ctx, 'flotanteAprox');
  return { modo: arribaAbajo ? 'topBottom' : 'square', distLPt: dist('distL'), distRPt: dist('distR'), distTPt: dist('distT'), distBPt: dist('distB') };
}

/** Texto de un `wp:posOffset`/`wp:align`: EMU → pt. */
function leerPosicion(el: XmlElemento | null): { offsetPt: number; align: string | null } {
  if (!el) return { offsetPt: 0, align: null };
  const offset = primerHijo(el, 'wp:posOffset');
  const align = primerHijo(el, 'wp:align');
  const emu = offset ? Number(textoDirecto(offset).trim()) : 0;
  return { offsetPt: Number.isFinite(emu) ? emu / EMU_POR_PUNTO : 0, align: align ? textoDirecto(align).trim() : null };
}

/**
 * `wp:positionH`/`wp:positionV` de un `wp:anchor`. `posOffset` va en EMU (→ pt). `relativeFrom` se agrupa: horizontal
 * `column`/`character`/`insideMargin`/`outsideMargin`/desconocido → margen; vertical `line` → párrafo, desconocido → margen.
 */
function leerPosicionAnchor(anchor: XmlElemento): PosicionFlotante {
  const ph = primerHijo(anchor, 'wp:positionH');
  const pv = primerHijo(anchor, 'wp:positionV');
  const hp = leerPosicion(ph);
  const vp = leerPosicion(pv);
  const relH = ph?.atributos['relativeFrom'];
  const relV = pv?.atributos['relativeFrom'];
  const h: PosFlotanteH = { rel: relH === 'page' ? 'page' : relH === 'leftMargin' ? 'leftMargin' : relH === 'rightMargin' ? 'rightMargin' : 'margin' };
  if (hp.align === 'left' || hp.align === 'inside') h.align = 'left';
  else if (hp.align === 'center') h.align = 'center';
  else if (hp.align === 'right' || hp.align === 'outside') h.align = 'right';
  else h.offsetPt = hp.offsetPt;
  const v: PosFlotanteV = { rel: relV === 'page' ? 'page' : relV === 'topMargin' ? 'topMargin' : relV === 'bottomMargin' ? 'bottomMargin' : relV === 'paragraph' || relV === 'line' || relV === undefined ? 'paragraph' : 'margin' };
  if (vp.align === 'top' || vp.align === 'inside') v.align = 'top';
  else if (vp.align === 'center') v.align = 'center';
  else if (vp.align === 'bottom' || vp.align === 'outside') v.align = 'bottom';
  else v.offsetPt = vp.offsetPt;
  return { h, v };
}

function recorrerContenidoParrafo(contenedor: XmlElemento, baseRuns: RPrAcum, ctx: Contexto, partes: ParteParrafo[]): void {
  for (const h of contenedor.hijos) {
    if (h.tipo !== 'elemento') continue;
    switch (h.nombre) {
      case 'w:r': procesarRun(h, baseRuns, ctx, partes); break;
      case 'w:hyperlink': procesarHyperlink(h, baseRuns, ctx, partes); break;
      case 'w:ins': recorrerContenidoParrafo(h, baseRuns, ctx, partes); break; // inserción de control de cambios: se acepta
      case 'w:fldSimple': procesarFldSimple(h, baseRuns, ctx, partes); break;
      case 'w:smartTag': case 'w:customXml': case 'w:dir': case 'w:bdo': case 'w:moveTo':
        recorrerContenidoParrafo(h, baseRuns, ctx, partes); break; // envoltorios: su contenido se conserva
      case 'w:sdt': { const c = primerHijo(h, 'w:sdtContent'); if (c) recorrerContenidoParrafo(c, baseRuns, ctx, partes); break; } // control de contenido en línea
      case 'm:oMath': case 'm:oMathPara': anotar(ctx, 'ecuacion'); break;
      case 'w:del': case 'w:moveFrom': break; // eliminación de control de cambios: se descarta (advertencia aparte, `cambios`)
      case 'w:pPr': break; // procesado aparte
      default: if (!RUIDO_PARRAFO.has(h.nombre) && buscarDescendiente(h, 'w:t')) anotar(ctx, 'desconocido'); break; // bookmarkStart/End, proofErr...: ruido estructural sin texto
    }
  }
}

/** `w:fldSimple`: PAGE/NUMPAGES en un encabezado/pie → `campo` (con el formato de su run, sin el texto cacheado); cualquier otro conserva su resultado y avisa. */
function procesarFldSimple(h: XmlElemento, baseRuns: RPrAcum, ctx: Contexto, partes: ParteParrafo[]): void {
  const campo = ctx.zona ? campoDePagina(h.atributos['w:instr'] ?? '') : null;
  const tmp: ParteParrafo[] = [];
  recorrerContenidoParrafo(h, baseRuns, ctx, tmp);
  if (!campo) { anotar(ctx, 'campo'); partes.push(...tmp); return; }
  const t = tmp.find((x) => x.tipo === 'texto');
  partes.push({ tipo: 'campo', campo, formato: t && t.tipo === 'texto' ? t.formato : formatoDeAcc(baseRuns) });
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
  if (!rId && h.atributos['w:anchor'] !== undefined) {
    anotar(ctx, 'enlaceInterno'); // a un marcador del propio documento: el texto se conserva, el enlace no
    recorrerContenidoParrafo(h, baseRuns, ctx, partes);
    return;
  }
  if (!rId || !rel || rel.targetMode !== 'External') {
    anotar(ctx, rel && rel.targetMode === 'Internal' ? 'enlaceInterno' : 'enlaceSinDestino');
    recorrerContenidoParrafo(h, baseRuns, ctx, partes);
    return;
  }
  const url = validarUrlEnlace(rel.target);
  if (!url) {
    ctx.advertenciasExtra.push(aproximado(`Se omitió un enlace con esquema no permitido ("${rel.target}"); el texto se conserva sin enlace.`));
    recorrerContenidoParrafo(h, baseRuns, ctx, partes);
    return;
  }
  const baseConEnlace: RPrAcum = { ...baseRuns, color: LINK_BLUE, underline: true };
  const antes = partes.length;
  recorrerContenidoParrafo(h, baseConEnlace, ctx, partes);
  for (let i = antes; i < partes.length; i++) { const p = partes[i]!; if (p.tipo === 'texto') p.url = url; }
}

/** Paradas de tabulación efectivas de un `w:p` (docDefaults, estilo y propias, con `clear` aplicado), ordenadas por posición. */
function paradasDeParrafo(el: XmlElemento, ctx: Contexto): ParadaTab[] {
  const pPr = primerHijo(el, 'w:pPr');
  const estiloId = (pPr ? primerHijo(pPr, 'w:pStyle')?.atributos['w:val'] : undefined) ?? ctx.estiloParrafoPorDefecto;
  const acc = pPrPorDefecto();
  if (ctx.docDefaultsPPr) aplicarPPr(acc, ctx.docDefaultsPPr);
  for (const est of estiloId ? cadenaEstilo(estiloId, ctx.estilos) : []) if (est.pPr) aplicarPPr(acc, est.pPr);
  if (pPr) aplicarPPr(acc, pPr);
  return [...acc.tabs.values()].sort((a, b) => a.posPt - b.posPt);
}

/**
 * Propiedades de párrafo EFECTIVAS de un `w:p` (docDefaults, cadena de estilos y propias; la sangría de su nivel de lista si no
 * trae `w:ind`). Es el camino ÚNICO del cuerpo y de las celdas de tabla (E-102).
 */
function pPrEfectivo(el: XmlElemento, ctx: Contexto): { pPr: XmlElemento | null; estiloEfectivo: string | null; cadena: EstiloDef[]; acc: PPrAcum } {
  const pPr = primerHijo(el, 'w:pPr');
  const pStyleIdPropio = pPr ? primerHijo(pPr, 'w:pStyle')?.atributos['w:val'] ?? null : null;
  const estiloEfectivo = pStyleIdPropio ?? ctx.estiloParrafoPorDefecto;
  const cadena = estiloEfectivo ? cadenaEstilo(estiloEfectivo, ctx.estilos) : [];

  const acc = pPrPorDefecto();
  if (ctx.docDefaultsPPr) aplicarPPr(acc, ctx.docDefaultsPPr);
  // Un párrafo de celda parte del `w:pPr` del estilo de su tabla (p. ej. "Table Grid": sin espacio después, interlineado sencillo) (E-103).
  if (ctx.enCelda) for (const x of ctx.pPrTabla) aplicarPPr(acc, x);
  for (const est of cadena) if (est.pPr) aplicarPPr(acc, est.pPr);
  if (pPr) aplicarPPr(acc, pPr);

  const indDirecto = pPr ? primerHijo(pPr, 'w:ind') : null;
  if (!indDirecto && acc.numId) {
    const nivel = obtenerNivelLista(acc.numId, acc.ilvl, ctx);
    if (nivel) { acc.sangriaIzqPt = nivel.sangriaIzqPt; acc.sangriaPrimeraLineaPt = -nivel.sangriaColganteP; }
  }
  return { pPr, estiloEfectivo, cadena, acc };
}

/** Marcador del párrafo de lista (avanza el contador de su `numId`); `null` sin lista o con numeración sin definir (se avisa). */
function listaDeParrafo(acc: PPrAcum, ctx: Contexto): InfoLista | null {
  const lista = acc.numId ? calcularInfoLista(acc.numId, acc.ilvl, ctx) : null;
  if (acc.numId && !lista) anotar(ctx, 'listaSinDef');
  return lista;
}

function procesarParrafo(el: XmlElemento, ctx: Contexto): Parrafo {
  const { pPr, estiloEfectivo, cadena, acc } = pPrEfectivo(el, ctx);

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

  const lista = listaDeParrafo(acc, ctx);

  return {
    tipo: 'parrafo', partes,
    alineacion: acc.alineacion,
    sangriaIzqPt: acc.sangriaIzqPt, sangriaDerPt: acc.sangriaDerPt, sangriaPrimeraLineaPt: acc.sangriaPrimeraLineaPt,
    espacioAntesPt: acc.espacioAntesPt, espacioDespuesPt: acc.espacioDespuesPt,
    interlineadoFactor: acc.interlineadoFactor, interlineadoExactoPt: acc.interlineadoExactoPt,
    saltoPaginaAntes: acc.saltoPaginaAntes, nivelEncabezado, lista, tamanoBasePt,
    mantenerConSiguiente: acc.keepNext ?? nivelEncabezado !== null,
    mantenerLineasJuntas: acc.keepLines ?? nivelEncabezado !== null,
    tabs: [...acc.tabs.values()].sort((a, b) => a.posPt - b.posPt)
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

const LADOS_BORDE_CELDA: [keyof BordesCelda, string[]][] = [['top', ['w:top']], ['bottom', ['w:bottom']], ['left', ['w:left', 'w:start']], ['right', ['w:right', 'w:end']]];

/**
 * Un borde (`w:top`...): `null` si es `nil`/`none` (sin borde), `undefined` si el elemento no existe. `w:sz` está en OCTAVOS de
 * punto (no medios, como la fuente): 24 → 3 pt; sin `w:sz`, 0,5 pt. Cualquier estilo distinto de `single`/`thick` (doble,
 * punteado...) se dibuja continuo y se avisa (`bordeEstilo`).
 */
function leerBorde(el: XmlElemento | null, ctx: Contexto): Borde | null | undefined {
  if (!el) return undefined;
  const val = el.atributos['w:val'];
  if (!val || val === 'nil' || val === 'none') return null;
  if (val !== 'single' && val !== 'thick') anotar(ctx, 'bordeEstilo');
  const sz = el.atributos['w:sz'];
  const colorRaw = el.atributos['w:color'];
  return { color: colorRaw && colorRaw !== 'auto' ? hexAColor(colorRaw) : [0, 0, 0], grosorPt: sz !== undefined ? Math.max(0.5, Number(sz) / 8) : 0.5 };
}

function leerBordesLados(el: XmlElemento, ctx: Contexto): BordesCelda {
  const out: BordesCelda = {};
  for (const [lado, nombres] of LADOS_BORDE_CELDA) {
    for (const nombre of nombres) {
      const b = leerBorde(primerHijo(el, nombre), ctx);
      if (b !== undefined) { out[lado] = b; break; }
    }
  }
  return out;
}

function leerBordesTablaPorLado(tblBorders: XmlElemento | null, ctx: Contexto): BordesTabla | undefined {
  if (!tblBorders) return undefined;
  const out: BordesTabla = leerBordesLados(tblBorders, ctx);
  const h = leerBorde(primerHijo(tblBorders, 'w:insideH'), ctx); if (h !== undefined) out.insideH = h;
  const v = leerBorde(primerHijo(tblBorders, 'w:insideV'), ctx); if (v !== undefined) out.insideV = v;
  return out;
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

  const tcBorders = tcPr ? primerHijo(tcPr, 'w:tcBorders') : null;
  const bordes = tcBorders ? leerBordesLados(tcBorders, ctx) : undefined;

  const partes: ParteParrafo[] = [];
  let alineacion: Alineacion = 'left';
  let bloquesVistos = 0;
  const enCeldaAntes = ctx.enCelda;
  ctx.enCelda = true;
  // `aplanarCuerpo` también abre `w:sdt` (control de contenido a nivel de bloque): nada dentro de la celda se pierde.
  for (const hijo of aplanarCuerpo(tc)) {
    if (hijo.nombre === 'w:p') {
      if (bloquesVistos > 0) partes.push({ tipo: 'saltoLinea' });
      // Formato de la celda (E-102, E-103): cada párrafo trae SU lista, sangrías, alineación, espaciado e interlineado, con el mismo `pPrEfectivo` que el cuerpo.
      const { acc: accP } = pPrEfectivo(hijo, ctx);
      if (bloquesVistos === 0) alineacion = accP.alineacion;
      partes.push({
        tipo: 'inicioParrafo', lista: listaDeParrafo(accP, ctx),
        sangriaIzqPt: accP.sangriaIzqPt, sangriaPrimeraLineaPt: accP.sangriaPrimeraLineaPt, sangriaDerPt: accP.sangriaDerPt,
        alineacion: accP.alineacion, espacioAntesPt: accP.espacioAntesPt, espacioDespuesPt: accP.espacioDespuesPt,
        interlineadoFactor: accP.interlineadoFactor, interlineadoExactoPt: accP.interlineadoExactoPt
      });
      const baseRuns = rPrPorDefecto();
      if (ctx.docDefaultsRPr) aplicarRPr(baseRuns, ctx.docDefaultsRPr);
      const desde = partes.length;
      recorrerContenidoParrafo(hijo, baseRuns, ctx, partes);
      // Tabulaciones reales (E-101): cada `w:tab` de la celda lleva las paradas de SU párrafo.
      const paradas = partes.slice(desde).some((x) => x.tipo === 'tab') ? paradasDeParrafo(hijo, ctx) : [];
      for (let k = desde; k < partes.length; k++) { const x = partes[k]!; if (x.tipo === 'tab' && !x.ptab) partes[k] = { ...x, paradas }; }
      bloquesVistos++;
    } else if (hijo.nombre === 'w:tbl') {
      // Tabla anidada: fuera de alcance como rejilla; su texto se conserva aplanado (una línea por fila, celdas separadas por tabulador) y se avisa.
      anotar(ctx, 'tablaAnidada');
      const anidada = procesarTablaReal(hijo, ctx);
      for (const fila of anidada.filas) {
        if (bloquesVistos > 0) partes.push({ tipo: 'saltoLinea' });
        fila.celdas.forEach((c, k) => { if (k > 0) partes.push({ tipo: 'tab' }); partes.push(...c.partes); });
        bloquesVistos++;
      }
    } else if (!['w:tcPr', 'w:bookmarkStart', 'w:bookmarkEnd', 'w:proofErr'].includes(hijo.nombre) && buscarDescendiente(hijo, 'w:t')) {
      anotar(ctx, 'desconocido');
    }
  }

  ctx.enCelda = enCeldaAntes;
  // Lo que una celda no puede pintar en esta fase se degrada CON aviso, nunca en silencio.
  for (let k = partes.length - 1; k >= 0; k--) {
    const parte = partes[k]!;
    if (parte.tipo === 'imagen') { partes.splice(k, 1); anotar(ctx, 'imagenEnCelda'); }
    else if (parte.tipo === 'saltoPagina') { partes[k] = { tipo: 'saltoLinea' }; anotar(ctx, 'saltoPaginaEnCelda'); }
  }
  if (vMerge === 'continue' && partes.some((x) => x.tipo === 'texto')) { anotar(ctx, 'vMergeConTexto'); partes.length = 0; }

  return { partes, gridSpan, vMerge, colorFondo, alineacion, ...(bordes && Object.keys(bordes).length > 0 ? { bordes } : {}) };
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
  // Bordes: los propios de la tabla; si no declara `w:tblBorders`, los de su estilo de tabla (`w:tblStyle`, p. ej. "Table Grid"), de la hoja a la raíz.
  let tblBorders = tblPr ? primerHijo(tblPr, 'w:tblBorders') : null;
  const estiloTabla = tblPr ? primerHijo(tblPr, 'w:tblStyle')?.atributos['w:val'] : undefined;
  if (!tblBorders && estiloTabla) {
    for (const est of cadenaEstilo(estiloTabla, ctx.estilos).reverse()) {
      const b = est.tblPr ? primerHijo(est.tblPr, 'w:tblBorders') : null;
      if (b) { tblBorders = b; break; }
    }
  }
  const { color: bordeColor, grosorPt: bordeGrosorPt } = leerBordesTabla(tblBorders);
  const bordesTabla = leerBordesTablaPorLado(tblBorders, ctx);
  const pPrTablaAntes = ctx.pPrTabla;
  ctx.pPrTabla = estiloTabla ? cadenaEstilo(estiloTabla, ctx.estilos).flatMap((est) => (est.pPr ? [est.pPr] : [])) : [];
  const filas = hijosElemento(tbl, 'w:tr').map((fila) => procesarFila(fila, ctx));
  ctx.pPrTabla = pPrTablaAntes;
  if (anchosColPt.length === 0) {
    // Sin w:tblGrid (raro en un .docx real: Word siempre lo escribe): ancho
    // de 1" por columna como valor por defecto razonable, mejor que fallar.
    const numCols = filas.reduce((max, f) => Math.max(max, f.celdas.reduce((s, c) => s + c.gridSpan, 0)), 1);
    anchosColPt = new Array(numCols).fill(72);
  }
  return { tipo: 'tabla', anchosColPt, filas, bordeColor, bordeGrosorPt, ...(bordesTabla ? { bordesTabla } : {}) };
}

function leerGeometriaPagina(sectPr: XmlElemento | null): { anchoPt: number; altoPt: number; margenSup: number; margenInf: number; margenIzq: number; margenDer: number; margenCab: number; margenPie: number } {
  // Sin w:sectPr (o sin w:pgSz/w:pgMar): tamaño Carta US con 1" de margen —
  // el valor por defecto que usa el propio Word cuando faltan.
  let anchoPt = 612, altoPt = 792;
  let margenSup = 72, margenInf = 72, margenIzq = 72, margenDer = 72;
  let margenCab = 36, margenPie = 36; // 0,5": el valor por defecto de Word para `w:pgMar w:header`/`w:footer`
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
      const header = pgMar.atributos['w:header']; const footer = pgMar.atributos['w:footer'];
      if (header !== undefined) margenCab = twipsAPt(Number(header));
      if (footer !== undefined) margenPie = twipsAPt(Number(footer));
    }
  }
  return { anchoPt, altoPt, margenSup, margenInf, margenIzq, margenDer, margenCab, margenPie };
}

function contarElementos(nodo: XmlElemento, nombre: string): number {
  let c = nodo.nombre === nombre ? 1 : 0;
  for (const h of nodo.hijos) if (h.tipo === 'elemento') c += contarElementos(h, nombre);
  return c;
}

function contarColumnasMultiples(nodo: XmlElemento): number {
  let c = nodo.nombre === 'w:cols' && Number(nodo.atributos['w:num'] ?? '1') > 1 ? 1 : 0;
  for (const h of nodo.hijos) if (h.tipo === 'elemento') c += contarColumnasMultiples(h);
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
function construirAdvertencias(docRoot: XmlElemento): Advertencia[] {
  const advertencias: Advertencia[] = [];
  const imagenesVml = contarElementos(docRoot, 'w:pict');
  const cuadros = contarElementos(docRoot, 'w:txbxContent');
  const notas = contarElementos(docRoot, 'w:footnoteReference') + contarElementos(docRoot, 'w:endnoteReference');
  const comentarios = contarElementos(docRoot, 'w:commentReference');
  const cambios = contarElementos(docRoot, 'w:ins') + contarElementos(docRoot, 'w:del') + contarElementos(docRoot, 'w:moveFrom') + contarElementos(docRoot, 'w:moveTo');
  const conColumnas = contarColumnasMultiples(docRoot);
  const objetos = contarElementos(docRoot, 'w:object');

  if (imagenesVml > 0) advertencias.push(omitido(`Se omitieron ${imagenesVml} ${pluralizar(imagenesVml, 'imagen', 'imágenes')} en formato antiguo (VML, aún no soportado).`));
  if (cuadros > 0) advertencias.push(omitido(`Se omitieron ${cuadros} ${pluralizar(cuadros, 'cuadro de texto', 'cuadros de texto')} (aún no soportados).`));
  if (notas > 0) advertencias.push(omitido(`Se omitieron ${notas} ${pluralizar(notas, 'nota al pie', 'notas al pie')} (aún no soportadas).`));
  if (comentarios > 0) advertencias.push(omitido(`Se omitieron ${comentarios} ${pluralizar(comentarios, 'comentario', 'comentarios')} (aún no soportados).`));
  if (cambios > 0) advertencias.push(aproximado(`El documento tiene ${cambios} ${pluralizar(cambios, 'cambio', 'cambios')} de control de cambios sin resolver; se aceptaron las inserciones y se descartaron las eliminaciones.`));

  if (objetos > 0) advertencias.push(omitido(`Se omitieron ${objetos} ${pluralizar(objetos, 'objeto incrustado', 'objetos incrustados')} (OLE; aún no soportados).`));
  if (conColumnas > 0) advertencias.push(aproximado(`Se omitió la distribución en columnas de ${conColumnas} ${pluralizar(conColumnas, 'sección', 'secciones')}; el texto se maqueta a una sola columna.`));

  return advertencias;
}

const TIPOS_ZONA = ['default', 'first', 'even'] as const;

type ZonasResueltas = { encabezados: ZonaPaginaModelo; pies: ZonaPaginaModelo };
const zonaVacia = (): ZonaPaginaModelo => ({ default: null, first: null, even: null });

/**
 * Lector de las partes de encabezado/pie (`w:headerReference`/`w:footerReference` → `word/header*.xml`/`footer*.xml` vía
 * rels): cada parte se procesa UNA vez aunque varias secciones la citen (así sus avisos no se duplican). Una referencia que
 * no se puede resolver se AVISA y deja ese tipo sin zona. Cada parte se procesa con las relaciones de SU propio fichero
 * (`relsPartes`), no con las del documento: ahí viven las imágenes del encabezado.
 */
function crearLectorZonas(rels: Map<string, Relacion> | null, partes: Record<string, string>, relsPartes: Record<string, string>, ctx: Contexto): (rId: string, falta: 'encabezadoFaltante' | 'pieFaltante') => BloqueDocx[] | null {
  const cache = new Map<string, BloqueDocx[] | null>();
  return (rId, falta) => {
    if (cache.has(rId)) return cache.get(rId)!;
    const ruta = rels?.get(rId) ? rutaMediaDesdeWord(rels.get(rId)!.target) : null;
    const xml = ruta ? partes[ruta] : undefined;
    let zona: BloqueDocx[] | null = null;
    if (xml === undefined) anotar(ctx, falta);
    else {
      try { zona = procesarZona(xml, ctx, relsPartes[ruta!] ?? null); } catch { anotar(ctx, falta); }
    }
    cache.set(rId, zona);
    return zona;
  };
}

/**
 * Encabezados y pies de UNA sección: lo que su `w:sectPr` referencia (por tipo default/first/even); lo que no
 * referencia lo HEREDA de la sección anterior, como en Word.
 */
function resolverZonasSeccion(sectPr: XmlElemento | null, previas: ZonasResueltas | null, leer: ReturnType<typeof crearLectorZonas>): ZonasResueltas {
  const salida: ZonasResueltas = { encabezados: zonaVacia(), pies: zonaVacia() };
  for (const [refNombre, clave, falta] of [['w:headerReference', 'encabezados', 'encabezadoFaltante'], ['w:footerReference', 'pies', 'pieFaltante']] as const) {
    for (const tipo of TIPOS_ZONA) {
      const ref = sectPr ? hijosElemento(sectPr, refNombre).find((r) => (r.atributos['w:type'] ?? 'default') === tipo) : undefined;
      const rId = ref?.atributos['r:id'];
      salida[clave][tipo] = rId !== undefined ? leer(rId, falta) : previas?.[clave][tipo] ?? null;
    }
  }
  return salida;
}

/**
 * Bloques de un `w:hdr`/`w:ftr` (fase 2c: párrafos con imágenes, y tablas), con `ctx.zona` activo (ahí PAGE/NUMPAGES son
 * campos). `relsXml` son las relaciones del propio encabezado: sustituyen a las del documento mientras se procesa.
 */
function procesarZona(xml: string, ctx: Contexto, relsXml: string | null): BloqueDocx[] {
  const raiz = parseXml(xml);
  const bloques: BloqueDocx[] = [];
  const relsDoc = ctx.rels;
  ctx.rels = relsXml ? leerRelaciones(relsXml) : null;
  ctx.zona = true;
  try {
    for (const hijo of aplanarCuerpo(raiz)) {
      if (hijo.nombre === 'w:p') bloques.push(procesarParrafo(hijo, ctx));
      else if (hijo.nombre === 'w:tbl') bloques.push(procesarTablaReal(hijo, ctx));
      else if (!['w:bookmarkStart', 'w:bookmarkEnd', 'w:proofErr', 'w:permStart', 'w:permEnd', 'w:sectPr'].includes(hijo.nombre) && buscarDescendiente(hijo, 'w:t')) anotar(ctx, 'desconocido');
    }
  } finally { ctx.zona = false; ctx.rels = relsDoc; ctx.camposAbiertos.length = 0; }
  return bloques;
}

/**
 * Construye el modelo a partir del texto YA DECODIFICADO (UTF-8) de
 * `word/document.xml` y, si existen, `word/styles.xml`/`word/numbering.xml`/
 * `word/_rels/document.xml.rels` (imágenes y enlaces, fase 2a). PURO: no lee
 * el ZIP (eso lo hace `ConversorDocxNavegador`, que decodifica cada entrada
 * y llama aquí) ni decodifica píxeles de imagen (eso lo hace
 * `decodificarImagenDocx`, después, sobre los `refId` que deja este modelo).
 */
export function construirModeloDocx(documentXml: string, stylesXml: string | null, numberingXml: string | null, relsXml: string | null = null, extras: ExtrasDocx = {}): ModeloDocx {
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

  const ctx: Contexto = { estilos, docDefaultsPPr, docDefaultsRPr, estiloParrafoPorDefecto, numMap, abstractNums, contadoresListas: new Map(), vinetasAvisadas: new Set(), rels, advertenciasExtra: [], perdidas: new Map(), zona: false, enCelda: false, pPrTabla: [], camposAbiertos: [] };

  const bloques: BloqueDocx[] = [];
  // Una marca por sección, en orden de documento: su `w:sectPr` y dónde acaba (índice en `bloques`, exclusivo).
  const marcas: { sectPr: XmlElemento | null; fin: number }[] = [];

  for (const hijo of aplanarCuerpo(body)) {
    if (hijo.nombre === 'w:p') {
      const pPr = primerHijo(hijo, 'w:pPr');
      const sectPrParrafo = pPr ? primerHijo(pPr, 'w:sectPr') : null;
      bloques.push(procesarParrafo(hijo, ctx));
      if (sectPrParrafo) marcas.push({ sectPr: sectPrParrafo, fin: bloques.length });
    } else if (hijo.nombre === 'w:tbl') {
      bloques.push(procesarTablaReal(hijo, ctx));
    } else if (hijo.nombre === 'w:sectPr') {
      marcas.push({ sectPr: hijo, fin: bloques.length });
    } else if (hijo.nombre === 'm:oMathPara' || hijo.nombre === 'm:oMath') {
      anotar(ctx, 'ecuacion');
    } else if (!['w:bookmarkStart', 'w:bookmarkEnd', 'w:proofErr', 'w:permStart', 'w:permEnd'].includes(hijo.nombre) && buscarDescendiente(hijo, 'w:t')) {
      anotar(ctx, 'desconocido');
    }
  }

  // El contenido tras el último `w:sectPr` de párrafo (o todo, si no hay ninguno) forma una sección final con la geometría por defecto.
  if (marcas.length === 0 || (marcas[marcas.length - 1]!.fin < bloques.length)) marcas.push({ sectPr: null, fin: bloques.length });

  let paresImpares = false;
  let tabPorDefectoPt = 36; // 720 twips: el valor por defecto de Word
  if (extras.settingsXml) {
    try {
      const raizSettings = parseXml(extras.settingsXml);
      const ev = primerHijo(raizSettings, 'w:evenAndOddHeaders'); paresImpares = !!ev && leerToggle(ev);
      const dt = Number(primerHijo(raizSettings, 'w:defaultTabStop')?.atributos['w:val']);
      if (Number.isFinite(dt) && dt > 0) tabPorDefectoPt = twipsAPt(dt);
    } catch { /* settings ilegible: sin encabezados pares/impares distintos ni tabulación por defecto propia */ }
  }

  const leerZona = crearLectorZonas(rels, extras.partes ?? {}, extras.relsPartes ?? {}, ctx);
  const secciones: SeccionDocx[] = [];
  let previas: ZonasResueltas | null = null;
  let inicioBloque = 0;
  for (const { sectPr, fin } of marcas) {
    const geo = leerGeometriaPagina(sectPr);
    const zonas = resolverZonasSeccion(sectPr, previas, leerZona);
    previas = zonas;
    const tipoVal = sectPr ? primerHijo(sectPr, 'w:type')?.atributos['w:val'] : undefined;
    if (tipoVal === 'evenPage' || tipoVal === 'oddPage' || tipoVal === 'nextColumn') anotar(ctx, 'seccionParImpar');
    const pgNum = sectPr ? primerHijo(sectPr, 'w:pgNumType') : null;
    const inicioNum = pgNum?.atributos['w:start'] !== undefined ? Number(pgNum.atributos['w:start']) : NaN;
    const fmt = pgNum?.atributos['w:fmt'];
    if (fmt !== undefined && fmt !== 'decimal') anotar(ctx, 'numeroPaginaFormato');
    const tipo: SeccionDocx['tipo'] = tipoVal === 'continuous' ? 'continuous' : 'nextPage';
    if (tipo === 'continuous' && Number.isFinite(inicioNum) && secciones.length > 0) anotar(ctx, 'numeroPaginaContinua');
    secciones.push({
      paginaAnchoPt: geo.anchoPt, paginaAltoPt: geo.altoPt,
      margenSupPt: geo.margenSup, margenInfPt: geo.margenInf, margenIzqPt: geo.margenIzq, margenDerPt: geo.margenDer,
      margenEncabezadoPt: geo.margenCab, margenPiePt: geo.margenPie,
      tipo,
      tituloPagina: !!sectPr && !!primerHijo(sectPr, 'w:titlePg') && leerToggle(primerHijo(sectPr, 'w:titlePg')!),
      encabezados: zonas.encabezados, pies: zonas.pies,
      numeroInicial: Number.isFinite(inicioNum) ? inicioNum : null,
      inicioBloque, finBloque: fin
    });
    inicioBloque = fin;
  }
  const ultima = secciones[secciones.length - 1]!;
  const perdidas: Advertencia[] = MENSAJES_PERDIDAS.filter(([clave]) => (ctx.perdidas.get(clave) ?? 0) > 0).map(([clave, tipo, msg]) => ({ tipo, mensaje: msg(ctx.perdidas.get(clave)!) }));
  const advertencias = [...construirAdvertencias(docRoot), ...ctx.advertenciasExtra, ...perdidas];

  // Los campos "de siempre" describen la ÚLTIMA sección (compatibilidad); `secciones` las trae todas.
  return {
    paginaAnchoPt: ultima.paginaAnchoPt, paginaAltoPt: ultima.paginaAltoPt,
    margenSupPt: ultima.margenSupPt, margenInfPt: ultima.margenInfPt, margenIzqPt: ultima.margenIzqPt, margenDerPt: ultima.margenDerPt,
    bloques, advertencias,
    margenEncabezadoPt: ultima.margenEncabezadoPt, margenPiePt: ultima.margenPiePt,
    tituloPagina: ultima.tituloPagina,
    paresImpares,
    encabezados: ultima.encabezados, pies: ultima.pies,
    secciones, tabPorDefectoPt
  };
}
