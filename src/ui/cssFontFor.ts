/**
 * Traduce el nombre de fuente de un run PDF (p. ej. `Times-BoldItalic`,
 * `ABCDEF+Calibri`) a la mejor aproximación disponible en CSS: una familia
 * genérica, el peso y el estilo. Función pura, sin acceso al DOM, para poder
 * probarla sin navegador.
 *
 * `sizeCss` ya viene convertido a px CSS por quien llama (con la escala de
 * `PageGeometry`, nunca con el alto de la caja — E-002/E-029).
 *
 * Devuelve el shorthand `font` completo (`style weight size family`), listo
 * para asignar a `element.style.font`.
 */
export function cssFontFor(fontName: string, sizeCss: number): string {
  // Los subconjuntos incrustados llevan un prefijo de 6 letras mayúsculas
  // y un '+' (p. ej. "ABCDEF+Calibri"); no aporta nada a la clasificación.
  const bare = fontName.replace(/^[A-Z]{6}\+/, '');

  const family = /times|serif|georgia|garamond|cambria|minion/i.test(bare)
    ? 'serif'
    : /courier|mono|consolas|menlo|consola/i.test(bare)
      ? 'monospace'
      : 'sans-serif';

  const weight = /bold/i.test(bare) ? 700 : 400;
  const style = /italic|oblique/i.test(bare) ? 'italic ' : '';

  return `${style}${weight} ${sizeCss}px ${family}`;
}
