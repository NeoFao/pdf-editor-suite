/**
 * Clasificación tipográfica común a partir del nombre de fuente de un run PDF
 * (p. ej. `Times-BoldItalic`, `ABCDEF+Calibri`). Función pura, sin acceso al
 * DOM ni a FPDF_*, para poder probarla sin navegador y compartirla entre
 * `src/ui/cssFontFor.ts` (aproximación CSS para pintar en pantalla) y
 * `src/engine/standardFontFor.ts` (fuente estándar PDF de sustitución cuando
 * faltan glifos). Ambos módulos necesitan el mismo criterio de
 * familia/peso/estilo; antes vivía duplicado en `cssFontFor`.
 */
export type FontFamily = 'serif' | 'monospace' | 'sans-serif';

export interface FontClass {
  family: FontFamily;
  bold: boolean;
  italic: boolean;
}

export function classifyFont(fontName: string): FontClass {
  // Los subconjuntos incrustados llevan un prefijo de 6 letras mayúsculas
  // y un '+' (p. ej. "ABCDEF+Calibri"); no aporta nada a la clasificación.
  const bare = fontName.replace(/^[A-Z]{6}\+/, '');

  const family: FontFamily = /times|serif|georgia|garamond|cambria|minion/i.test(bare)
    ? 'serif'
    : /courier|mono|consolas|menlo|consola/i.test(bare)
      ? 'monospace'
      : 'sans-serif';

  const bold = /bold/i.test(bare);
  const italic = /italic|oblique/i.test(bare);

  return { family, bold, italic };
}
