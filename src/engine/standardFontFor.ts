import { classifyFont } from './fontClassify';

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
