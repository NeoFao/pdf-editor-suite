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

/**
 * Quita el prefijo de subconjunto incrustado (6 letras mayúsculas + '+', p.
 * ej. "ABCDEF+Calibri" → "Calibri", PDF 32000-1 §9.6.4) si lo hay. Exportada
 * aparte porque el panel de propiedades de la UI (`App.buildPropsPanel`)
 * necesita mostrar el nombre real de la fuente original sin ese prefijo
 * técnico, no solo clasificarla.
 */
export function stripSubsetPrefix(fontName: string): string {
  return fontName.replace(/^[A-Z]{6}\+/, '');
}

export function classifyFont(fontName: string): FontClass {
  const bare = stripSubsetPrefix(fontName);

  const family: FontFamily = /times|serif|georgia|garamond|cambria|minion/i.test(bare)
    ? 'serif'
    : /courier|mono|consolas|menlo|consola/i.test(bare)
      ? 'monospace'
      : 'sans-serif';

  const bold = /bold/i.test(bare);
  const italic = /italic|oblique/i.test(bare);

  return { family, bold, italic };
}
