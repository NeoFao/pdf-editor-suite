/**
 * Esquemas de URI que el editor de marcadores acepta leer y escribir. Lista de
 * PERMITIDOS (un PDF es entrada no confiable, E-003/E-027): `javascript:`,
 * `file:`, `data:` y cualquier otro se tratan como acción no soportada (se
 * conservan sin tocar, nunca se ejecutan). Misma política que `validarUrlEnlace`
 * de la fase 2a (addLink), duplicada aquí a propósito para no depender de esa rama.
 */
const PERMITIDOS = new Set(['http:', 'https:', 'mailto:']);

export function esUriPermitida(uri: string): boolean {
  try {
    return PERMITIDOS.has(new URL(uri).protocol);
  } catch {
    return false;
  }
}
