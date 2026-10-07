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
 * Equivalencias (Wingdings, tabla de Alan Wood / Unicode "official mappings"): A7 = U+25AA ▪, 76 = U+2756 ❖. El dueño
 * fija D8 = ➢ (U+27A2) y FC = ✓ (U+2713) y A8 = □ (U+25A1); la tabla oficial dice 2B9A, 2714 y 25FB (glifos casi iguales,
 * pero ZapfDingbats solo dibuja los primeros). Symbol B7 = U+2022 (Adobe symbol.txt). Courier New "o" = ◦ por convención
 * (Word dibuja ahí una "o" minúscula de Courier, que es justo lo que se reproduce).
 */

export interface VinetaResuelta {
  /** Texto que se escribe en el PDF (con `font`). */
  texto: string;
  /** Fuente estándar PDF con la que se dibuja. */
  font: string;
  /** Factor sobre el tamaño de la fuente del párrafo. */
  escala: number;
  /** `true`: no se pudo reproducir; se usó "•" (el llamante avisa con `vinetaFuente`). */
  aproximada: boolean;
}

const POR_DEFECTO: VinetaResuelta = { texto: '•', font: 'Helvetica', escala: 1, aproximada: false };
const APROXIMADA: VinetaResuelta = { ...POR_DEFECTO, aproximada: true };

/** Código (0x20..0xFF) de la fuente de símbolos -> Unicode. */
const EQUIVALENTE_UNICODE: Readonly<Record<string, ReadonlyMap<number, string>>> = {
  symbol: new Map([[0xb7, '•']]),
  wingdings: new Map([[0xa7, '▪'], [0xd8, '➢'], [0xfc, '✓'], [0x76, '❖'], [0xa8, '□']])
};

/** Unicode -> cómo dibujarlo con una fuente estándar; ausente = ninguna estándar tiene el glifo. */
const GLIFO_ESTANDAR: ReadonlyMap<string, { texto: string; font: string; escala: number }> = new Map([
  ['•', { texto: '•', font: 'Helvetica', escala: 1 }],
  ['✓', { texto: '✓', font: 'ZapfDingbats', escala: 1 }],
  ['➢', { texto: '➢', font: 'ZapfDingbats', escala: 1 }],
  ['❖', { texto: '❖', font: 'ZapfDingbats', escala: 1 }],
  // ▪ (cuadrado pequeño): no existe en ninguna estándar; el cuadrado de ZapfDingbats a 0,6 es la misma forma.
  ['▪', { texto: '■', font: 'ZapfDingbats', escala: 0.6 }],
  // ◦ (Courier New "o"): se dibuja el glifo original, la "o" de Courier.
  ['◦', { texto: 'o', font: 'Courier', escala: 1 }]
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
    unicode = '◦';
  } else if (!enZonaPrivada && dibujableEnHelvetica(c)) {
    return { texto: primero, font: 'Helvetica', escala: 1, aproximada: false };
  } else if (!enZonaPrivada) {
    unicode = primero; // un Unicode normal (✓, ➢...) que quizá una estándar sí tenga
  }
  const glifo = unicode !== undefined ? GLIFO_ESTANDAR.get(unicode) : undefined;
  return glifo ? { ...glifo, aproximada: false } : APROXIMADA;
}
