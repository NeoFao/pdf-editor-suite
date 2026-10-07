/**
 * Viñetas reales de Word (E-102): del `w:lvlText` de un nivel `bullet` y la fuente de su `w:rPr/w:rFonts` a un glifo que el
 * PDF pueda dibujar con una de las 14 fuentes estándar (las únicas que el conversor usa, no se embebe nada).
 *
 * Dos pasos, deliberadamente separados:
 * 1. `EQUIVALENTE_UNICODE`: el carácter de una fuente de símbolos (Symbol, Wingdings: código 0x20..0xFF, guardado por Word
 *    como U+F0xx de uso privado o, en documentos antiguos, como el carácter Latin-1 de ese código) a su Unicode.
 * 2. `GLIFO_ESTANDAR`: qué fuente estándar tiene el glifo de ese Unicode (comprobado con el motor: Helvetica solo tiene
 *    los de WinAnsi; ZapfDingbats tiene ✓ ➢ ❖ ■; ni ▪ ni ◦ ni □ existen en ninguna estándar).
 * Lo que no llega al final del camino cae a "•" y se marca `aproximada` (aviso `vinetaFuente`).
 *
 * Equivalencias OFICIALES (Wingdings: Alan Wood / Unicode "official mappings"): A7 = U+25AA ▪, A8 = U+25FB ◻, D8 = U+2B9A ⮚,
 * FC = U+2714 ✔, 76 = U+2756 ❖. Symbol B7 = U+2022 (Adobe symbol.txt). Courier New "o" es la propia letra "o" (lo que Word dibuja).
 * Solo lo EXACTO (el glifo oficial existe en la fuente estándar) va sin aviso; toda sustitución visual (▪ como ■ al 60 %, ⮚ como ➢,
 * ◻ sin glifo -> "•") es `aproximada` y el llamante avisa con el carácter original y el dibujado.
 */

export interface VinetaResuelta {
  /** Texto que se escribe en el PDF (con `font`). */
  texto: string;
  /** Fuente estándar PDF con la que se dibuja. */
  font: string;
  /** Factor sobre el tamaño de la fuente del párrafo. */
  escala: number;
  /** `true`: lo dibujado NO es exactamente el carácter oficial (sustituto visual o "•"): el llamante avisa (`vinetaFuente`). */
  aproximada: boolean;
  /** Carácter oficial/original del `lvlText` (para el aviso); coincide con `texto` cuando no hay aproximación. */
  oficial: string;
}

const POR_DEFECTO: VinetaResuelta = { texto: '•', font: 'Helvetica', escala: 1, aproximada: false, oficial: '•' };

/** Código (0x20..0xFF) de la fuente de símbolos -> Unicode. */
const EQUIVALENTE_UNICODE: Readonly<Record<string, ReadonlyMap<number, string>>> = {
  symbol: new Map([[0xb7, '•']]),
  wingdings: new Map([[0xa7, '▪'], [0xa8, '◻'], [0xd8, '⮚'], [0xfc, '✔'], [0x76, '❖']])
};

/**
 * Unicode oficial -> cómo dibujarlo con una fuente estándar; ausente = ninguna estándar tiene el glifo. `exacto: false`: el glifo
 * dibujado es otro (un sustituto visual) y se avisa.
 */
const GLIFO_ESTANDAR: ReadonlyMap<string, { texto: string; font: string; escala: number; exacto: boolean }> = new Map([
  ['•', { texto: '•', font: 'Helvetica', escala: 1, exacto: true }],
  ['✔', { texto: '✔', font: 'ZapfDingbats', escala: 1, exacto: true }],
  ['✓', { texto: '✓', font: 'ZapfDingbats', escala: 1, exacto: true }],
  ['➢', { texto: '➢', font: 'ZapfDingbats', escala: 1, exacto: true }],
  ['❖', { texto: '❖', font: 'ZapfDingbats', escala: 1, exacto: true }],
  // ▪ (cuadrado pequeño): no existe en ninguna estándar; el cuadrado de ZapfDingbats a 0,6 es un sustituto.
  ['▪', { texto: '■', font: 'ZapfDingbats', escala: 0.6, exacto: false }],
  // ⮚ (U+2B9A): ninguna estándar lo tiene; ➢ (U+27A2) de ZapfDingbats es el sustituto más cercano.
  ['⮚', { texto: '➢', font: 'ZapfDingbats', escala: 1, exacto: false }],
  // Courier New "o": se dibuja la propia "o" de Courier, que es lo que dibuja Word.
  ['o', { texto: 'o', font: 'Courier', escala: 1, exacto: true }]
]);

/** Caracteres que Helvetica (WinAnsi) dibuja tal cual: ASCII imprimible, Latin-1 y las rayas/viñeta de CP1252. */
const dibujableEnHelvetica = (c: number): boolean => (c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff) || c === 0x2022 || c === 0x2013 || c === 0x2014;

/** `lvlText` (solo el primer carácter cuenta, como en Word) y fuente del nivel -> viñeta dibujable. */
export function resolverVineta(lvlText: string | null, fuente: string | null): VinetaResuelta {
  const primero = lvlText ? [...lvlText][0] : undefined;
  if (primero === undefined) return POR_DEFECTO;
  const c = primero.codePointAt(0)!;
  const familia = (fuente ?? '').trim().toLowerCase();
  const enZonaPrivada = c >= 0xe000 && c <= 0xf8ff;

  let unicode: string | undefined;
  const tabla = EQUIVALENTE_UNICODE[familia];
  if (tabla) {
    const codigo = c >= 0xf020 && c <= 0xf0ff ? c - 0xf000 : c <= 0xff ? c : -1;
    unicode = tabla.get(codigo);
  } else if (familia === 'courier new' && primero === 'o') {
    unicode = 'o';
  } else if (!enZonaPrivada && dibujableEnHelvetica(c)) {
    return { texto: primero, font: 'Helvetica', escala: 1, aproximada: false, oficial: primero };
  } else if (!enZonaPrivada) {
    unicode = primero; // un Unicode normal (✓, ➢...) que quizá una estándar sí tenga
  }
  const oficial = unicode ?? primero;
  const glifo = unicode !== undefined ? GLIFO_ESTANDAR.get(unicode) : undefined;
  if (!glifo) return { texto: '•', font: 'Helvetica', escala: 1, aproximada: true, oficial };
  return { texto: glifo.texto, font: glifo.font, escala: glifo.escala, aproximada: !glifo.exacto, oficial };
}
