import { classifyFont } from '../engine/fontClassify';

/**
 * Traduce el nombre de fuente de un run PDF (p. ej. `Times-BoldItalic`,
 * `ABCDEF+Calibri`) a la mejor aproximación disponible en CSS: una familia
 * genérica, el peso y el estilo. Función pura, sin acceso al DOM, para poder
 * probarla sin navegador. La clasificación familia/peso/estilo la comparte
 * con `standardFontFor` (fuente estándar PDF de sustitución) a través de
 * `classifyFont`.
 *
 * `sizeCss` ya viene convertido a px CSS por quien llama (con la escala de
 * `PageGeometry`, nunca con el alto de la caja — E-002/E-029).
 *
 * Devuelve el shorthand `font` completo (`style weight size family`), listo
 * para asignar a `element.style.font`.
 */
export function cssFontFor(fontName: string, sizeCss: number): string {
  const { family, bold, italic } = classifyFont(fontName);
  const weight = bold ? 700 : 400;
  const style = italic ? 'italic ' : '';
  return `${style}${weight} ${sizeCss}px ${family}`;
}
