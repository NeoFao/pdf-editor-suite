/**
 * Codificación del texto de los conversores «otro formato → PDF» a las fuentes estándar de PDF (E-120).
 *
 * PUNTO ÚNICO por el que pasa el texto de Word y Markdown antes de llegar al motor. Las 14 fuentes estándar no
 * incorporan fuente de sistema: solo dibujan lo que tienen. Antes, todo carácter fuera de WinAnsi salía como `ÿ`
 * sin aviso (pérdida silenciosa de datos). Ahora cada carácter va por exactamente UNA de estas vías:
 *
 *  1. WinAnsi (la fuente del estilo: Helvetica, Times, Courier, con su negrita/cursiva): ASCII, Latin-1 y los extras
 *     0x80-0x9F de Windows-1252 (€ — – … “ ” • ™ Š š Ž ž Œ œ Ÿ ƒ ˆ ˜ † ‡ ‰ ‹ ›).
 *  2. `Symbol`: griego sin tilde (Α-Ω, α-ω), flechas, operadores matemáticos y símbolos técnicos.
 *  3. `ZapfDingbats`: marcas y adornos (✓ ✔ ✗ ★ ❤ ✂ ...).
 *  4. Sin glifo en ninguna: se dibuja el marcador `?` (`MARCADOR_SIN_GLIFO`), se AVISA (`caracteresSinFuente`,
 *     `omitido`) con los caracteres afectados y sus recuentos, y el texto original queda en el PDF como `/ActualText`.
 *
 * Las tablas de glifos NO están escritas de memoria: salen de escanear el propio PDFium (viaje de ida y vuelta:
 * escribir el punto de código con cada fuente y releerlo), que es lo único que cuenta para el PDF resultante.
 *
 * Además se eliminan los caracteres de control (U+0000 y demás C0, DEL y C1; se conservan TAB y salto de línea): un NUL
 * llega a la escritura de texto del motor y mata el WASM del motor («RuntimeError: unreachable»), así que nunca llegan al motor y se
 * AVISA (`caracteresControl`).
 *
 * Unidades: las anchuras son puntos PDF; X de un trazo es el origen de su línea base en puntos PDF de página.
 */
import type { Advertencia, CaracterAfectado } from './advertencia';

export type Repertorio = 'winansi' | 'symbol' | 'dingbats' | 'sin-glifo';

/** Lo que se dibuja en lugar de un carácter sin glifo. Es ASCII, así que nunca falla en ninguna fuente. */
export const MARCADOR_SIN_GLIFO = '?';
export const FUENTE_SIMBOLOS = 'Symbol';
export const FUENTE_DINGBATS = 'ZapfDingbats';
/** Máximo de caracteres distintos que enumera un aviso (el resto se resume como «y N más»). */
export const MAX_CARACTERES_AVISO = 20;

// ---- Tablas (puntos de código con glifo REAL, medidos en PDFium) -------------------------------------------------

type Rango = readonly [number, number];

const WINANSI: readonly Rango[] = [
  [0x21, 0x7e], [0xa1, 0xac], [0xae, 0xff], [0x152, 0x153], [0x160, 0x161], [0x178, 0x178], [0x17d, 0x17e], [0x192, 0x192],
  [0x2c6, 0x2c6], [0x2dc, 0x2dc], [0x2013, 0x2014], [0x2018, 0x201a], [0x201c, 0x201e], [0x2020, 0x2022], [0x2026, 0x2026],
  [0x2030, 0x2030], [0x2039, 0x203a], [0x20ac, 0x20ac], [0x2122, 0x2122]
];

// Symbol, SIN lo que ya está en WinAnsi (que tiene prioridad) y sin 0xFF (código sin definir).
const SYMBOL: readonly Rango[] = [
  [0x391, 0x393], [0x395, 0x3a1], [0x3a3, 0x3a8], [0x3b1, 0x3bb], [0x3bd, 0x3c9], [0x3d1, 0x3d2], [0x3d5, 0x3d6],
  [0x2032, 0x2033], [0x2044, 0x2044], [0x2111, 0x2111], [0x2118, 0x2118], [0x211c, 0x211c], [0x2126, 0x2126],
  [0x2135, 0x2135], [0x2190, 0x2194], [0x21b5, 0x21b5], [0x21d0, 0x21d4], [0x2200, 0x2200], [0x2202, 0x2203],
  [0x2205, 0x2209], [0x220b, 0x220b], [0x220f, 0x220f], [0x2211, 0x2212], [0x2217, 0x2217], [0x221a, 0x221a],
  [0x221d, 0x221e], [0x2220, 0x2220], [0x2227, 0x222b], [0x2234, 0x2234], [0x223c, 0x223c], [0x2245, 0x2245],
  [0x2248, 0x2248], [0x2260, 0x2261], [0x2264, 0x2265], [0x2282, 0x2284], [0x2286, 0x2287], [0x2295, 0x2295],
  [0x2297, 0x2297], [0x22a5, 0x22a5], [0x22c5, 0x22c5], [0x2320, 0x2321], [0x2329, 0x232a], [0x25ca, 0x25ca],
  [0x2660, 0x2660], [0x2663, 0x2663], [0x2665, 0x2666]
];

/**
 * Letras que Symbol SÍ tiene pero PDFium las nombra con otro punto de código (el estándar Adobe usa el signo ohm, el
 * incremento y el micro): se escriben con el código que Symbol reconoce. Δ→∆(U+2206), Ω→Ω(U+2126), μ→µ(U+00B5).
 */
const ALIAS_SYMBOL: ReadonlyMap<number, number> = new Map([[0x394, 0x2206], [0x3a9, 0x2126], [0x3bc, 0xb5]]);
const SYMBOL_EXTRA: readonly number[] = [0x394, 0x3a9, 0x3bc, 0x2206];

// ZapfDingbats, sin lo que ya está en WinAnsi o Symbol.
const DINGBATS: readonly Rango[] = [
  [0x2195, 0x2195], [0x2460, 0x2469], [0x25a0, 0x25a0], [0x25b2, 0x25b2], [0x25bc, 0x25bc], [0x25c6, 0x25c6],
  [0x25cf, 0x25cf], [0x25d7, 0x25d7], [0x2605, 0x2605], [0x260e, 0x260e], [0x261b, 0x261b], [0x261e, 0x261e],
  [0x2701, 0x2704], [0x2706, 0x2709], [0x270c, 0x2727], [0x2729, 0x274b], [0x274d, 0x274d], [0x274f, 0x2752],
  [0x2756, 0x2756], [0x2758, 0x275e], [0x2761, 0x2794], [0x2798, 0x27af], [0x27b1, 0x27be]
];

const SIN = 0, WIN = 1, SYM = 2, DIN = 3;
const TABLA = new Uint8Array(0x10000);
function marcar(rangos: readonly Rango[], valor: number): void {
  for (const [a, b] of rangos) for (let c = a; c <= b; c++) if (TABLA[c] === SIN) TABLA[c] = valor;
}
marcar(WINANSI, WIN);
marcar(SYMBOL, SYM);
for (const c of SYMBOL_EXTRA) if (TABLA[c] === SIN) TABLA[c] = SYM;
marcar(DINGBATS, DIN);

/** Repertorio que dibuja `cp` (punto de código Unicode). */
export function repertorioDe(cp: number): Repertorio {
  if (cp > 0xffff) return 'sin-glifo';
  switch (TABLA[cp]) {
    case WIN: return 'winansi';
    case SYM: return 'symbol';
    case DIN: return 'dingbats';
    default: return 'sin-glifo';
  }
}

// ---- Saneado y partición por fuente ---------------------------------------------------------------------------

const ESPACIOS_UNICODE = (cp: number): boolean =>
  cp === 0xa0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x2028 || cp === 0x2029 || cp === 0x202f || cp === 0x205f || cp === 0x3000;
/** Sin anchura ni forma: guion blando, marcas de dirección, ZWSP/ZWJ, selectores de variación, BOM. Se quitan sin aviso. */
const INVISIBLE = (cp: number): boolean =>
  cp === 0xad || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x2064) ||
  (cp >= 0x2066 && cp <= 0x2069) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0xfeff;
const LIGADURAS: Readonly<Record<number, string>> = { 0xfb00: 'ff', 0xfb01: 'fi', 0xfb02: 'fl', 0xfb03: 'ffi', 0xfb04: 'ffl' };
const SOLO_ASCII = /^[\t\n\x20-\x7e]*$/;

export interface Segmento {
  repertorio: 'winansi' | 'symbol' | 'dingbats';
  /** Lo que se escribe en el PDF con la fuente de este repertorio (los sin glifo ya son `?`). */
  visible: string;
  /** Lo que decía el documento en este tramo (distinto de `visible` si hay sustituciones). */
  original: string;
  /** true si `visible` contiene algún marcador `?` en lugar de un carácter real. */
  sinGlifo: boolean;
}

export interface TextoPreparado {
  segmentos: Segmento[];
  /** Punto de código sin glifo → veces que aparece en ESTE texto. */
  sinGlifo: ReadonlyMap<number, number>;
  /** Punto de código de control eliminado → veces. */
  controles: ReadonlyMap<number, number>;
}

const MAPA_VACIO: ReadonlyMap<number, number> = new Map();

interface Elem { rep: number; vis: string; orig: string; sin: boolean }
const NEUTRO = 9;

function sumar(m: Map<number, number>, cp: number): void { m.set(cp, (m.get(cp) ?? 0) + 1); }

/** Descompone `texto` en tramos, cada uno con la fuente que realmente dibuja sus caracteres. Puro. */
export function prepararTexto(texto: string): TextoPreparado {
  if (SOLO_ASCII.test(texto)) {
    return { segmentos: texto === '' ? [] : [{ repertorio: 'winansi', visible: texto, original: texto, sinGlifo: false }], sinGlifo: MAPA_VACIO, controles: MAPA_VACIO };
  }
  const sinGlifo = new Map<number, number>();
  const controles = new Map<number, number>();
  const elems: Elem[] = [];
  for (const ch of texto.normalize('NFC')) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x20 || ESPACIOS_UNICODE(cp)) { elems.push({ rep: NEUTRO, vis: ' ', orig: ' ', sin: false }); continue; }
    if (cp === 9 || cp === 10) { elems.push({ rep: WIN, vis: ch, orig: ch, sin: false }); continue; }
    if (cp === 13) continue; // fin de línea heredado: se descarta sin aviso
    if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)) { sumar(controles, cp); continue; }
    if (INVISIBLE(cp)) continue;
    const lig = LIGADURAS[cp];
    if (lig !== undefined) { elems.push({ rep: WIN, vis: lig, orig: lig, sin: false }); continue; }
    const rep = cp > 0xffff ? SIN : TABLA[cp]!;
    if (rep === SIN) {
      sumar(sinGlifo, cp);
      elems.push({ rep: WIN, vis: MARCADOR_SIN_GLIFO, orig: ch, sin: true });
    } else if (rep === SYM) {
      elems.push({ rep, vis: String.fromCodePoint(ALIAS_SYMBOL.get(cp) ?? cp), orig: ch, sin: false });
    } else {
      elems.push({ rep, vis: ch, orig: ch, sin: false });
    }
  }
  // Los espacios (en Symbol y ZapfDingbats también existen) adoptan el repertorio de sus vecinos si los dos lados coinciden;
  // así «αβγ δεζ» es UN tramo y no cinco objetos de texto.
  for (let i = 0; i < elems.length; i++) {
    if (elems[i]!.rep !== NEUTRO) continue;
    let j = i;
    while (j < elems.length && elems[j]!.rep === NEUTRO) j++;
    const izq = i > 0 ? elems[i - 1]!.rep : WIN;
    const der = j < elems.length ? elems[j]!.rep : WIN;
    const rep = izq === der ? izq : WIN;
    for (let k = i; k < j; k++) elems[k]!.rep = rep;
    i = j - 1;
  }
  const segmentos: Segmento[] = [];
  let actual: Segmento | null = null;
  let actualRep = -1;
  for (const e of elems) {
    if (!actual || e.rep !== actualRep) {
      actualRep = e.rep;
      actual = { repertorio: e.rep === SYM ? 'symbol' : e.rep === DIN ? 'dingbats' : 'winansi', visible: '', original: '', sinGlifo: false };
      segmentos.push(actual);
    }
    actual.visible += e.vis;
    actual.original += e.orig;
    if (e.sin) actual.sinGlifo = true;
  }
  return { segmentos, sinGlifo: sinGlifo.size ? sinGlifo : MAPA_VACIO, controles: controles.size ? controles : MAPA_VACIO };
}

function fuenteDe(rep: Segmento['repertorio'], base: string): string {
  return rep === 'symbol' ? FUENTE_SIMBOLOS : rep === 'dingbats' ? FUENTE_DINGBATS : base;
}

// ---- Avisos -------------------------------------------------------------------------------------------------------

const formatoCodigo = (cp: number): string => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
const plural = (n: number, uno: string, varios: string): string => (n === 1 ? uno : varios);

function enumerar(m: ReadonlyMap<number, number>): { lista: CaracterAfectado[]; total: number; resto: number } {
  const todos = [...m.entries()];
  const total = todos.reduce((s, [, v]) => s + v, 0);
  const lista = todos.slice(0, MAX_CARACTERES_AVISO).map(([cp, veces]) => ({ caracter: String.fromCodePoint(cp), codigo: formatoCodigo(cp), veces }));
  return { lista, total, resto: todos.length - lista.length };
}

/** Los avisos de una conversión: caracteres sin fuente y controles eliminados. Vacío si no hubo ninguno. */
export function advertenciasCodificacion(sinGlifo: ReadonlyMap<number, number>, controles: ReadonlyMap<number, number>): Advertencia[] {
  const out: Advertencia[] = [];
  if (sinGlifo.size > 0) {
    const { lista, total, resto } = enumerar(sinGlifo);
    const det = lista.map((c) => `"${c.caracter}" ${c.codigo} (×${c.veces})`).join(', ') + (resto > 0 ? ` y ${resto} más` : '');
    out.push({
      tipo: 'omitido',
      codigo: 'caracteresSinFuente',
      caracteres: lista,
      mensaje: `${total} ${plural(total, 'carácter', 'caracteres')} (${sinGlifo.size} ${plural(sinGlifo.size, 'distinto', 'distintos')}) no ` +
        `${plural(total, 'existe', 'existen')} en las fuentes estándar del PDF y se ${plural(total, 'dibuja', 'dibujan')} como "${MARCADOR_SIN_GLIFO}": ${det}. ` +
        'El texto original queda en el PDF como texto alternativo (/ActualText), que no todos los lectores usan.'
    });
  }
  if (controles.size > 0) {
    const { lista, total, resto } = enumerar(controles);
    const det = lista.map((c) => `${c.codigo} (×${c.veces})`).join(', ') + (resto > 0 ? ` y ${resto} más` : '');
    out.push({
      tipo: 'omitido',
      codigo: 'caracteresControl',
      caracteres: lista,
      mensaje: `Se ${plural(total, 'eliminó', 'eliminaron')} ${total} ${plural(total, 'carácter', 'caracteres')} de control invisibles ` +
        `que un PDF no puede contener: ${det}.`
    });
  }
  return out;
}

// ---- Codificador (medir + trazos) ---------------------------------------------------------------------------------

export type MedirFuente = (fontName: string, sizePt: number, text: string) => number;

/** Lo mínimo que necesita de un trazo; `Trazo` de `flujo/layout.ts` lo cumple. */
export interface TrazoBase { xPt: number; text: string; font: string; sizePt: number }

/**
 * Un codificador por conversión. `medir` es la función que se pasa al maquetador (mide cada tramo con SU fuente y está
 * memoizada: la maquetación repite muchas palabras), y `prepararTrazos` convierte los trazos ya maquetados en los que se
 * escriben en el PDF. Ambos usan `prepararTexto`, así que lo medido y lo dibujado coinciden.
 */
export class CodificadorTexto {
  private readonly cache = new Map<string, number>();
  private readonly sinGlifo = new Map<number, number>();
  private readonly controles = new Map<number, number>();

  constructor(private readonly medirFuente: MedirFuente) {}

  readonly medir = (font: string, sizePt: number, texto: string): number => {
    const clave = `${font}\u0000${sizePt}\u0000${texto}`;
    let w = this.cache.get(clave);
    if (w === undefined) {
      w = 0;
      for (const s of prepararTexto(texto).segmentos) w += this.medirFuente(fuenteDe(s.repertorio, font), sizePt, s.visible);
      this.cache.set(clave, w);
    }
    return w;
  };

  prepararTrazos<T extends TrazoBase>(trazos: readonly T[]): (T & { actualText?: string })[] {
    const out: (T & { actualText?: string })[] = [];
    for (const t of trazos) {
      const p = prepararTexto(t.text);
      for (const [cp, n] of p.sinGlifo) this.sinGlifo.set(cp, (this.sinGlifo.get(cp) ?? 0) + n);
      for (const [cp, n] of p.controles) this.controles.set(cp, (this.controles.get(cp) ?? 0) + n);
      let x = t.xPt;
      for (const s of p.segmentos) {
        const font = fuenteDe(s.repertorio, t.font);
        const trazo: T & { actualText?: string } = { ...t, xPt: x, text: s.visible, font };
        if (s.sinGlifo) trazo.actualText = s.original;
        out.push(trazo);
        if (p.segmentos.length > 1) x += this.medirFuente(font, t.sizePt, s.visible);
      }
    }
    return out;
  }

  advertencias(): Advertencia[] {
    return advertenciasCodificacion(this.sinGlifo, this.controles);
  }
}
