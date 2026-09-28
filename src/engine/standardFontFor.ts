import { classifyFont } from './fontClassify';

/**
 * Las 14 fuentes estándar PDF que todo motor conforme crea sin incrustar
 * nada (Anexo D de la especificación PDF 32000-1). Lista cerrada: el panel
 * de propiedades de la UI (`#prop-font`) y `PdfiumEngine.setRunFont` la usan
 * para validar el nombre elegido por el usuario antes de tocar el motor.
 */
export const STANDARD_FONTS = [
  'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
  'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
  'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
  'Symbol', 'ZapfDingbats'
] as const;

export type StandardFontName = typeof STANDARD_FONTS[number];

/**
 * Traduce el nombre de fuente de un run PDF a la fuente estándar PDF más
 * parecida, de las 14 que todo motor conforme crea sin incrustar nada
 * (`FPDFPageObj_NewTextObj(doc, nombre, size)` las acepta directamente —
 * verificado contra las 12 no-symbolic de esta tabla).
 *
 * Se usa cuando la fuente incrustada en el PDF es un SUBCONJUNTO al que le
 * falta el glifo que el usuario acaba de teclear (`editTextRun` devuelve
 * `glyph-missing`): en vez de rendirse, se sustituye la línea por la fuente
 * estándar equivalente (mismo criterio de familia/peso/estilo que
 * `cssFontFor`, vía `classifyFont`, para que la aproximación en pantalla y la
 * sustitución real coincidan).
 */
export function standardFontFor(fontName: string): string {
  const { family, bold, italic } = classifyFont(fontName);

  if (family === 'serif') {
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }

  if (family === 'monospace') {
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
