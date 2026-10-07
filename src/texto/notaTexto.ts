/**
 * Texto de una nota (B4): se guarda en `/Contents` con sus saltos de línea. Normaliza CRLF/CR a LF (el textarea
 * puede entregar cualquiera según la plataforma) y recorta los extremos; un texto solo de blancos queda vacío y
 * el llamador lo trata como «no crear / no cambiar nada». Pura: sin DOM.
 */
export function normalizarTextoNota(texto: string): string {
  return texto.replace(/\r\n?/g, '\n').trim();
}
