import { aproximado, type Advertencia } from './advertencia';

/**
 * Decodificación de texto de los conversores (E-124). Antes todo se leía como UTF-8 tolerante: un .md en UTF-16 (lo
 * que escribe `>` en PowerShell 5.1) o en cp1252 salía «convertido con éxito» con el contenido destruido (U+FFFD y
 * NUL → `ÿ`). Ahora se detecta y, si hay que suponer, se avisa.
 */
export interface TextoDecodificado {
  texto: string;
  codificacion: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';
  /** `true` si la codificación NO venía declarada (BOM) ni era UTF-8 válido: se dedujo y el texto puede no ser el original. */
  supuesta: boolean;
  /** Nº de U+0000 descartados (el motor trunca el texto en un NUL). */
  nulos: number;
}

/** Cuántos bytes se examinan para detectar UTF-16 sin BOM. */
const MUESTRA = 4096;

/** `'le'`/`'be'` si la muestra tiene el patrón de ASCII en UTF-16 (un byte 0 de cada dos, siempre en la misma paridad). */
function utf16SinBom(bytes: Uint8Array): 'le' | 'be' | null {
  const n = Math.min(bytes.length, MUESTRA) & ~1;
  if (n < 2) return null;
  let cerosPares = 0, cerosImpares = 0;
  for (let i = 0; i < n; i += 2) { if (bytes[i] === 0) cerosPares++; if (bytes[i + 1] === 0) cerosImpares++; }
  const pares = n / 2;
  if (cerosImpares >= pares * 0.3 && cerosPares <= pares * 0.05) return 'le';
  if (cerosPares >= pares * 0.3 && cerosImpares <= pares * 0.05) return 'be';
  return null;
}

function sinNul(s: string): { texto: string; nulos: number } {
  if (!s.includes('\u0000')) return { texto: s, nulos: 0 };
  const partes = s.split('\u0000');
  return { texto: partes.join(''), nulos: partes.length - 1 };
}

/** Decodifica el contenido de un fichero de texto: BOM (UTF-8/16LE/16BE) → UTF-16 sin BOM → UTF-8 estricto → windows-1252. */
export function decodificarTexto(bytes: Uint8Array): TextoDecodificado {
  let codificacion: TextoDecodificado['codificacion'];
  let supuesta = false;
  let texto: string;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    codificacion = 'utf-8';
    texto = new TextDecoder('utf-8').decode(bytes); // quita el BOM
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    codificacion = 'utf-16le';
    texto = new TextDecoder('utf-16le').decode(bytes);
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    codificacion = 'utf-16be';
    texto = new TextDecoder('utf-16be').decode(bytes);
  } else {
    const sin = utf16SinBom(bytes);
    if (sin) {
      codificacion = sin === 'le' ? 'utf-16le' : 'utf-16be';
      supuesta = true;
      texto = new TextDecoder(codificacion).decode(bytes);
    } else {
      try {
        texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        codificacion = 'utf-8';
      } catch {
        codificacion = 'windows-1252';
        supuesta = true;
        texto = new TextDecoder('windows-1252').decode(bytes);
      }
    }
  }
  const { texto: limpio, nulos } = sinNul(texto);
  return { texto: limpio, codificacion, supuesta, nulos };
}

/** Avisos que acompañan a una decodificación (vacío si UTF-8/BOM limpio). */
export function advertenciasDeCodificacion(d: TextoDecodificado): Advertencia[] {
  const out: Advertencia[] = [];
  if (d.supuesta) {
    out.push(aproximado(d.codificacion === 'windows-1252'
      ? 'El archivo no está en UTF-8: se ha leído como Windows-1252 (codificación supuesta). Si ves caracteres extraños, vuelve a guardarlo como UTF-8.'
      : 'El archivo está en UTF-16 sin marca de orden (BOM): se ha leído como UTF-16 (codificación supuesta). Si ves caracteres extraños, vuelve a guardarlo como UTF-8.'));
  }
  if (d.nulos > 0) out.push(aproximado(`Se descartaron ${d.nulos} caracteres nulos (U+0000) del texto.`));
  return out;
}

/**
 * Decodifica una parte XML de un .docx. Por especificación es UTF-8 o UTF-16 (con BOM, o declarado en la cabecera
 * `<?xml encoding="UTF-16"?>` aunque falte el BOM). Sin BOM ni declaración, UTF-8 tolerante (los bytes inválidos
 * no pueden dar un éxito silencioso: el XML resultante o el modelo lo rechazan o se ve).
 */
export function decodificarXml(bytes: Uint8Array): string {
  const sin = utf16SinBom(bytes);
  if (sin && !(bytes[0] === 0xff && bytes[1] === 0xfe) && !(bytes[0] === 0xfe && bytes[1] === 0xff)) {
    return new TextDecoder(sin === 'le' ? 'utf-16le' : 'utf-16be').decode(bytes);
  }
  return decodificarTexto(bytes).texto;
}
