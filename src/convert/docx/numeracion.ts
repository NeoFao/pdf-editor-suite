/**
 * Formatos de numeración de listas de Word (`w:numFmt`) y plantillas `w:lvlText`: funciones PURAS (E-101).
 *
 * Convenciones (las de Word):
 * - `lowerLetter`/`upperLetter`: a..z y después aa, bb, cc... zz, aaa... — la letra se REPITE, no es base 26
 *   (el 28 es "bb", no "ab").
 * - `lowerRoman`/`upperRoman`: notación sustractiva (IV, IX, XC...). Pasado 3999 se sigue repitiendo la M
 *   (4000 = MMMM) hasta 32767; por encima el número se deja en cifras arábigas. (Convención adoptada: no se ha
 *   contrastado con Word para esos valores raros.)
 * - 0 no tiene cifra en letras ni romanos: cadena vacía (`w:start="0"` con esos formatos).
 * - `bullet`: "•" aquí; el carácter real de la viñeta (Wingdings, Symbol...) lo resuelve `vinetas.ts` (E-102).
 */

/** Formatos de `w:numFmt` que este módulo sabe formatear. */
export const FORMATOS_NUMERACION: ReadonlySet<string> = new Set(['decimal', 'decimalZero', 'lowerLetter', 'upperLetter', 'lowerRoman', 'upperRoman', 'bullet', 'none']);

const ROMANOS: readonly [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const ROMANO_MAX = 32767;

function aLetras(n: number): string {
  if (n < 1) return '';
  const veces = Math.floor((n - 1) / 26) + 1;
  return String.fromCharCode(97 + ((n - 1) % 26)).repeat(veces);
}

function aRomano(n: number): string {
  if (n < 1) return '';
  if (n > ROMANO_MAX) return String(n);
  let resto = n;
  let out = '';
  for (const [valor, simbolo] of ROMANOS) { while (resto >= valor) { out += simbolo; resto -= valor; } }
  return out;
}

/** Formatea `valor` con `numFmt`; `null` si el formato no está soportado (el llamante decide: cifras + aviso). */
export function formatoNumero(valor: number, numFmt: string): string | null {
  switch (numFmt) {
    case 'decimal': return String(valor);
    case 'decimalZero': return valor >= 0 && valor < 10 ? `0${valor}` : String(valor);
    case 'lowerLetter': return aLetras(valor);
    case 'upperLetter': return aLetras(valor).toUpperCase();
    case 'lowerRoman': return aRomano(valor).toLowerCase();
    case 'upperRoman': return aRomano(valor);
    case 'bullet': return '•';
    case 'none': return '';
    default: return null;
  }
}

/** Sustituye `%1`..`%9` de `lvlText` por el valor ya formateado del nivel correspondiente (`valores[0]` = nivel 0); lo demás es literal. Un nivel sin valor se omite. */
export function aplicarLvlText(lvlText: string, valores: readonly string[]): string {
  return lvlText.replace(/%([1-9])/g, (_m, d: string) => valores[Number(d) - 1] ?? '');
}
