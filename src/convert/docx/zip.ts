/**
 * Lector de ZIP mínimo y PURO (§9 fila #4): un `.docx` es un ZIP con
 * `word/document.xml` dentro. Sin dependencias (AGENTS.md §5: nada de
 * `jszip`) y sin `DOMParser` — este módulo solo entiende el formato ZIP en
 * sí (directorio central + cabeceras locales), no XML.
 *
 * Soporta los dos métodos de compresión que Word usa siempre: 0 (`stored`,
 * sin comprimir) y 8 (`deflate`, vía `DecompressionStream('deflate-raw')` —
 * disponible en navegadores modernos y en Node ≥18, sin librería).
 *
 * SEGURIDAD (un `.docx` es un fichero que el usuario abre, potencialmente de
 * origen no confiable — AGENTS.md §2, "entrada no confiable"). Defensas,
 * todas ejercitadas por `tests/unit/docx-zip.test.ts`:
 * - Límite de entradas del directorio central (`MAX_ENTRADAS`): un ZIP con
 *   millones de entradas vacías agota memoria/tiempo solo recorriéndolo.
 * - Límite de tamaño descomprimido por entrada y total (`MAX_ENTRADA_BYTES`,
 *   `MAX_TOTAL_BYTES`): protege aunque el fichero comprimido en sí sea
 *   pequeño.
 * - Límite de RATIO de compresión (`MAX_RATIO`) en entradas grandes: una
 *   "zip bomb" (unos KB comprimidos que inflan a GB) se detecta leyendo los
 *   tamaños DECLARADOS en el directorio central, sin descomprimir nada.
 * - Nombres con `..` o ruta absoluta: la entrada se IGNORA (no se puede
 *   escapar del árbol del ZIP), no aborta la lectura completa.
 * - ZIP64, cifrado (bit 0 del flag general) o multidisco: no soportados,
 *   `DocxError` con mensaje claro en vez de datos corruptos o un cuelgue.
 *
 * Formato ZIP (ECMA-376 Anexo / PKWARE APPNOTE.TXT), en breve:
 * - Fin de directorio central (EOCD, firma `PK\x05\x06`): al final del
 *   fichero (con hasta 65535 bytes de comentario detrás), da el número de
 *   entradas y el offset del directorio central.
 * - Directorio central (firma `PK\x01\x02`, uno por entrada): nombre,
 *   método, tamaños y el offset de SU cabecera local.
 * - Cabecera local (firma `PK\x03\x04`, delante de cada entrada): repite
 *   nombre/método: los datos comprimidos empiezan justo después.
 */

export { DocxError } from './DocxError';
import { DocxError } from './DocxError';

const FIRMA_EOCD = 0x06054b50;
const FIRMA_CD = 0x02014b50;
const FIRMA_LOCAL = 0x04034b50;
const FIRMA_EOCD64_LOCATOR = 0x07064b50;

const MAX_ENTRADAS = 10_000;
const MAX_ENTRADA_BYTES = 200 * 1024 * 1024; // 200 MB por entrada
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200 MB descomprimidos en total
/** Ratio (descomprimido / comprimido) a partir del cual una entrada "grande" se considera zip bomb. */
const MAX_RATIO = 100;
/** Una entrada por debajo de este tamaño comprimido no se juzga por ratio (un fichero de 10 bytes que comprime a 1 byte no es una bomba). */
const RATIO_MIN_COMPRIMIDO = 1024;

interface EntradaCentral {
  nombre: string;
  metodo: number;
  comprimidoBytes: number;
  descomprimidoBytes: number;
  offsetLocal: number;
  flag: number;
}

export interface ZipArchivo {
  /** Rutas de las entradas ya saneadas (sin `..` ni absolutas; esas se excluyen). */
  nombres(): string[];
  /** Descomprime una entrada por su ruta exacta. `null` si no existe (o fue excluida por ruta insegura). */
  leer(nombre: string): Promise<Uint8Array | null>;
}

function u16(view: DataView, off: number): number { return view.getUint16(off, true); }
function u32(view: DataView, off: number): number { return view.getUint32(off, true); }

/** `true` si el nombre de entrada intenta escapar del árbol del ZIP (ruta absoluta o `..`). */
function esRutaInsegura(nombre: string): boolean {
  if (nombre === '') return true;
  if (nombre.startsWith('/') || nombre.startsWith('\\')) return true;
  if (/^[a-zA-Z]:/.test(nombre)) return true; // C:\... (ruta absoluta Windows)
  const partes = nombre.split(/[/\\]/);
  return partes.some((p) => p === '..');
}

function buscarEOCD(bytes: Uint8Array): number {
  // El comentario del EOCD mide como máximo 65535 bytes: basta buscar hacia
  // atrás en los últimos 65557 bytes (22 del registro fijo + 65535 de comentario).
  const desde = Math.max(0, bytes.length - (22 + 65535));
  for (let i = bytes.length - 22; i >= desde; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      return i;
    }
  }
  return -1;
}

function leerDirectorioCentral(bytes: Uint8Array, view: DataView): EntradaCentral[] {
  const posEOCD = buscarEOCD(bytes);
  if (posEOCD === -1) throw new DocxError('El archivo no es un .docx válido: no se encontró el final del ZIP.');

  const firma = u32(view, posEOCD);
  if (firma !== FIRMA_EOCD) throw new DocxError('El archivo no es un .docx válido: cabecera ZIP corrupta.');

  const totalEntradas = u16(view, posEOCD + 10);
  const tamanoCD = u32(view, posEOCD + 12);
  const offsetCD = u32(view, posEOCD + 16);

  // ZIP64 o multidisco: los campos de 16 bits/32 bits saturan a 0xFFFF/0xFFFFFFFF
  // y el tamaño real vive en un registro EOCD64 (localizado por este "locator",
  // firma PK\x06\x07, 20 bytes justo antes del EOCD). No lo soportamos.
  const posLocator64 = posEOCD - 20;
  const pareceZip64 = totalEntradas === 0xffff || offsetCD === 0xffffffff || tamanoCD === 0xffffffff
    || (posLocator64 >= 0 && u32(view, posLocator64) === FIRMA_EOCD64_LOCATOR);
  if (pareceZip64) throw new DocxError('Formato no soportado: este .docx usa ZIP64, que esta versión no lee.');

  const discoActual = u16(view, posEOCD + 4);
  const discoCD = u16(view, posEOCD + 6);
  if (discoActual !== 0 || discoCD !== 0) throw new DocxError('Formato no soportado: este .docx está repartido en varios discos/volúmenes.');

  if (totalEntradas > MAX_ENTRADAS) {
    throw new DocxError(`El archivo .docx tiene demasiadas entradas internas (${totalEntradas}); se rechaza por seguridad.`);
  }

  const entradas: EntradaCentral[] = [];
  let pos = offsetCD;
  for (let i = 0; i < totalEntradas; i++) {
    if (pos + 46 > bytes.length) throw new DocxError('El archivo no es un .docx válido: directorio central truncado.');
    if (u32(view, pos) !== FIRMA_CD) throw new DocxError('El archivo no es un .docx válido: entrada de directorio central corrupta.');

    const flag = u16(view, pos + 8);
    const metodo = u16(view, pos + 10);
    const comprimidoBytes = u32(view, pos + 20);
    const descomprimidoBytes = u32(view, pos + 24);
    const nombreLen = u16(view, pos + 28);
    const extraLen = u16(view, pos + 30);
    const comentarioLen = u16(view, pos + 32);
    const discoInicio = u16(view, pos + 34);
    const offsetLocal = u32(view, pos + 42);

    if (discoInicio !== 0) throw new DocxError('Formato no soportado: este .docx está repartido en varios discos/volúmenes.');
    if (offsetLocal === 0xffffffff || comprimidoBytes === 0xffffffff || descomprimidoBytes === 0xffffffff) {
      throw new DocxError('Formato no soportado: este .docx usa ZIP64, que esta versión no lee.');
    }
    if (flag & 0x1) throw new DocxError('Formato no soportado: este .docx está cifrado.');

    const nombreInicio = pos + 46;
    const nombre = new TextDecoder('utf-8').decode(bytes.subarray(nombreInicio, nombreInicio + nombreLen));

    if (metodo !== 0 && metodo !== 8) {
      throw new DocxError(`Formato no soportado: la entrada "${nombre}" usa un método de compresión no reconocido.`);
    }

    // Defensa contra "zip bomb": el ratio se calcula con los tamaños
    // DECLARADOS en el directorio central, sin descomprimir nada.
    if (comprimidoBytes >= RATIO_MIN_COMPRIMIDO) {
      const ratio = descomprimidoBytes / Math.max(1, comprimidoBytes);
      if (ratio > MAX_RATIO) {
        throw new DocxError(`El archivo .docx contiene una entrada con una compresión anormal ("${nombre}"); se rechaza por seguridad.`);
      }
    }
    if (descomprimidoBytes > MAX_ENTRADA_BYTES) {
      throw new DocxError(`El archivo .docx contiene una entrada demasiado grande ("${nombre}"); se rechaza por seguridad.`);
    }

    entradas.push({ nombre, metodo, comprimidoBytes, descomprimidoBytes, offsetLocal, flag });
    pos = nombreInicio + nombreLen + extraLen + comentarioLen;
  }

  const totalDeclarado = entradas.reduce((s, e) => s + e.descomprimidoBytes, 0);
  if (totalDeclarado > MAX_TOTAL_BYTES) {
    throw new DocxError('El archivo .docx supera el tamaño total permitido una vez descomprimido; se rechaza por seguridad.');
  }

  return entradas;
}

async function inflateRaw(datos: Uint8Array): Promise<Uint8Array> {
  // `datos` es un subarray de un Uint8Array más grande (bytes.subarray): hay
  // que recortar el ArrayBuffer subyacente a su ventana antes de pasarlo a
  // Blob (si no, se serializaría el buffer COMPLETO). El cast a ArrayBuffer
  // es seguro: los bytes del .docx siempre vienen de un ArrayBuffer normal,
  // nunca de un SharedArrayBuffer.
  const ab = datos.buffer.slice(datos.byteOffset, datos.byteOffset + datos.byteLength) as ArrayBuffer;
  const flujo = new Blob([ab]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(flujo).arrayBuffer();
  return new Uint8Array(buf);
}

async function extraerEntrada(bytes: Uint8Array, view: DataView, entrada: EntradaCentral): Promise<Uint8Array> {
  const pos = entrada.offsetLocal;
  if (pos + 30 > bytes.length || u32(view, pos) !== FIRMA_LOCAL) {
    throw new DocxError(`El archivo no es un .docx válido: cabecera local corrupta ("${entrada.nombre}").`);
  }
  const nombreLen = u16(view, pos + 26);
  const extraLen = u16(view, pos + 28);
  const inicioDatos = pos + 30 + nombreLen + extraLen;
  const finDatos = inicioDatos + entrada.comprimidoBytes;
  if (finDatos > bytes.length) throw new DocxError(`El archivo no es un .docx válido: datos truncados ("${entrada.nombre}").`);

  const comprimido = bytes.subarray(inicioDatos, finDatos);
  const datos = entrada.metodo === 0 ? new Uint8Array(comprimido) : await inflateRaw(comprimido);

  // Defensa en profundidad: el tamaño real tras descomprimir debe coincidir
  // con lo declarado (si no, alguien manipuló la cabecera para pasar el
  // filtro de ratio con un tamaño falso y luego inflar más de la cuenta).
  if (datos.length !== entrada.descomprimidoBytes) {
    throw new DocxError(`El archivo .docx tiene una entrada corrupta ("${entrada.nombre}"): el tamaño no coincide.`);
  }

  return datos;
}

/** Abre un `.docx`/ZIP desde sus bytes crudos. No descomprime nada todavía: `leer()` lo hace bajo demanda. */
export function abrirZip(bytes: Uint8Array): ZipArchivo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entradas = leerDirectorioCentral(bytes, view);

  const porNombre = new Map<string, EntradaCentral>();
  for (const e of entradas) {
    if (esRutaInsegura(e.nombre)) continue; // se ignora, no aborta la lectura del resto
    porNombre.set(e.nombre, e);
  }

  return {
    nombres(): string[] { return [...porNombre.keys()]; },
    async leer(nombre: string): Promise<Uint8Array | null> {
      const e = porNombre.get(nombre);
      if (!e) return null;
      return extraerEntrada(bytes, view, e);
    }
  };
}
