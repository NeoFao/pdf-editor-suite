/**
 * ¿Es este carácter "de palabra"? Unicode: letra (cualquier alfabeto: ñ,
 * tildes, ü, griego, cirílico...), dígito o `_`. Es el ÚNICO criterio de
 * "palabra completa" de la app: lo usan tanto la lógica pura de reemplazo
 * (`buscarReemplazar.ts`) como el filtro de `findText` (resaltado).
 *
 * Por qué existe: la opción nativa de palabra completa de PDFium solo trata como letras el
 * ASCII y `_`, así que con él "a" casaría dentro de "año" y "o" dentro de
 * "acción" — inaceptable en español. `findText` busca SIN esa flag y descarta
 * con esta función los resultados pegados a un carácter de palabra.
 *
 * `cp` es un code point (o la unidad UTF-16 que devuelve
 * el getter de carácter del motor). 0, negativos y sustitutos sueltos no son de palabra.
 */
const DE_PALABRA = /[\p{L}\p{N}_]/u;

export function esCaracterDePalabra(cp: number): boolean {
  if (!Number.isInteger(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
  return DE_PALABRA.test(String.fromCodePoint(cp));
}

/** Fuente de la clase de caracteres para componer regex (`lookbehind`/`lookahead` en `buscarReemplazar.ts`). */
export const CLASE_DE_PALABRA = '[\\p{L}\\p{N}_]';
