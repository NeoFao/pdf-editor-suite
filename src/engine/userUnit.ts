/**
 * `/UserUnit` (PDF 1.6): tamaño físico de la unidad de usuario de una página, en múltiplos de 1/72". PDFium lo ignora
 * (tamaño, render y coordenadas van en unidades de usuario sin escalar, E-098) y no expone el diccionario de página, así
 * que se lee aquí con pdf-lib y SOLO cuando el fichero de verdad lo declara (E-099). El valor es solo para la VISTA: las
 * coordenadas del motor no se escalan nunca.
 *
 * Detección barata, sin decodificar el fichero a cadena y sin cargar pdf-lib salvo que haga falta:
 *  1. `UserUnit` literal en los bytes (diccionario de página sin comprimir) -> se analiza con pdf-lib.
 *  2. Si no, se infla cada flujo `/ObjStm` con `/FlateDecode` (acotado) y se busca ahí; el diccionario de página de un PDF
 *     moderno vive en un flujo de objetos comprimido.
 * Límite documentado: un flujo `/ObjStm` cifrado, con otro filtro (o predictor) o que no se pueda inflar se trata como sin
 * `/UserUnit` (la vista usa 1).
 */

/** Por encima de este tamaño no se analiza el fichero: abrir un PDF enorme no debe pagar una segunda lectura completa. */
const MAX_BYTES_ANALISIS = 64 * 1024 * 1024;
/** Tope de bytes inflados por flujo `/ObjStm` y en total (defensa contra bombas de descompresión, como E-042). */
const MAX_INFLADO_FLUJO = 16 * 1024 * 1024;
const MAX_INFLADO_TOTAL = 64 * 1024 * 1024;

/** Valor válido de `/UserUnit`: finito y > 0; cualquier otra cosa (falta, 0, negativo, NaN) se trata como 1. */
export function userUnitValido(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
}

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Posición de `aguja` en `bytes` a partir de `desde`, o -1. Búsqueda directa sobre los bytes (sin copiar ni decodificar). */
export function buscarBytes(bytes: Uint8Array, aguja: Uint8Array, desde = 0, hasta = bytes.length): number {
  const n = aguja.length, primero = aguja[0]!;
  const limite = Math.min(hasta, bytes.length) - n;
  for (let i = desde; i <= limite; i++) {
    if (bytes[i] !== primero) continue;
    let k = 1;
    while (k < n && bytes[i + k] === aguja[k]) k++;
    if (k === n) return i;
  }
  return -1;
}

const USERUNIT = ascii('UserUnit'), OBJSTM = ascii('/ObjStm'), STREAM = ascii('stream'), ENDSTREAM = ascii('endstream');
const FLATE = ascii('/FlateDecode');
const DECODEPARMS = ascii('/DecodeParms');

/** Infla `datos` (zlib) con tope de bytes; `null` si falla o supera el tope. */
async function inflarAcotado(datos: Uint8Array, tope: number): Promise<Uint8Array | null> {
  try {
    const ab = datos.buffer.slice(datos.byteOffset, datos.byteOffset + datos.byteLength) as ArrayBuffer;
    const reader = new Blob([ab]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const trozos: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > tope) { await reader.cancel(); return null; }
        trozos.push(value);
      }
    } catch {
      // Bytes sobrantes tras el final del flujo (el EOL antes de `endstream`) hacen fallar al lector DESPUÉS de dar los datos
      // válidos: se conservan. Sin ningún dato, el flujo está corrupto.
      if (total === 0) return null;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const t of trozos) { out.set(t, off); off += t.length; }
    return out;
  } catch {
    return null;
  }
}

/** ¿Algún flujo `/ObjStm` con `/FlateDecode` contiene `UserUnit` una vez inflado? */
async function objStmContieneUserUnit(bytes: Uint8Array): Promise<boolean> {
  let restante = MAX_INFLADO_TOTAL;
  let desde = 0;
  for (;;) {
    const pos = buscarBytes(bytes, OBJSTM, desde);
    if (pos < 0) return false;
    desde = pos + OBJSTM.length;
    const kStream = buscarBytes(bytes, STREAM, desde);
    if (kStream < 0) return false;
    // Diccionario del flujo: desde el `obj` anterior hasta la palabra `stream`. Solo se admite Flate sin otros filtros.
    let ini = Math.max(0, pos - 512);
    for (let j = pos; j > ini; j--) if (bytes[j] === 0x6f && bytes[j + 1] === 0x62 && bytes[j + 2] === 0x6a && j > 0) { ini = j + 3; break; }
    if (buscarBytes(bytes, FLATE, ini, kStream) < 0 || buscarBytes(bytes, DECODEPARMS, ini, kStream) >= 0) continue;
    let datos = kStream + STREAM.length;
    if (bytes[datos] === 0x0d) datos++;
    if (bytes[datos] === 0x0a) datos++;
    const fin = buscarBytes(bytes, ENDSTREAM, datos);
    if (fin < 0) return false;
    desde = fin;
    const inflado = await inflarAcotado(bytes.subarray(datos, fin), Math.min(MAX_INFLADO_FLUJO, restante));
    if (!inflado) continue;
    restante -= inflado.length;
    if (buscarBytes(inflado, USERUNIT) >= 0) return true;
    if (restante <= 0) return false;
  }
}

/** ¿Declara este fichero algún `/UserUnit`? (decide si hace falta cargar pdf-lib; ver el comentario del módulo). */
export async function declaraUserUnit(bytes: Uint8Array): Promise<boolean> {
  if (bytes.length > MAX_BYTES_ANALISIS) return false;
  if (buscarBytes(bytes, USERUNIT) >= 0) return true;
  if (buscarBytes(bytes, OBJSTM) < 0) return false;
  return objStmContieneUserUnit(bytes);
}

/**
 * Número de objeto de cada página con `/UserUnit` ≠ 1 → su valor. Las páginas ausentes del mapa valen 1. Se indexa por número
 * de objeto (no por posición) para que reordenar o borrar páginas no desplace los valores.
 */
export async function leerUserUnits(bytes: Uint8Array): Promise<Map<number, number>> {
  const res = new Map<number, number>();
  if (!(await declaraUserUnit(bytes))) return res;
  try {
    // Import dinámico: pdf-lib queda en su propio chunk y solo se descarga si un PDF declara /UserUnit.
    const { PDFDict, PDFDocument, PDFName, PDFNumber, ParseSpeeds } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false, parseSpeed: ParseSpeeds.Fastest });
    const tipo = PDFName.of('Type'), clave = PDFName.of('UserUnit'), pagina = PDFName.of('Page');
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict) || obj.get(tipo) !== pagina) continue;
      const n = doc.context.lookup(obj.get(clave));
      const v = userUnitValido(n instanceof PDFNumber ? n.asNumber() : undefined);
      if (v !== 1) res.set(ref.objectNumber, v);
    }
  } catch {
    // Fichero que pdf-lib no entiende pero PDFium sí: la vista sigue en tamaño sin escalar (UserUnit 1).
  }
  return res;
}
