import zlib from 'node:zlib';

/**
 * Constructor de ZIP mínimo para los tests de `src/convert/docx/zip.ts`
 * (SOLO para tests: no forma parte del producto). Permite construir ZIPs
 * válidos a mano, con control total sobre las cabeceras, para poder fabricar
 * también los casos hostiles (tamaños declarados falseados, flags de
 * cifrado, disco != 0, etc.) sin depender de ninguna librería de ZIP.
 */

let tablaCrc: number[] | null = null;
function tabla(): number[] {
  if (tablaCrc) return tablaCrc;
  const t: number[] = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  tablaCrc = t;
  return t;
}

export function crc32(buf: Uint8Array): number {
  const t = tabla();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = t[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntradaBuilder {
  nombre: string;
  datos: Uint8Array;
  metodo?: 0 | 8;
  /** Sobrescribe el tamaño descomprimido DECLARADO (para simular una zip bomb sin generar el payload real). */
  descomprimidoBytesFalso?: number;
  /** Sobrescribe el flag de propósito general (bit 0 = cifrado). */
  flag?: number;
  /** Sobrescribe el número de disco donde empieza la entrada (multi-disco). */
  discoInicio?: number;
}

export function construirZip(entradas: ZipEntradaBuilder[]): Uint8Array {
  const partesLocal: Buffer[] = [];
  const partesCentral: Buffer[] = [];
  let offset = 0;

  for (const e of entradas) {
    const metodo = e.metodo ?? 0;
    const nombreBuf = Buffer.from(e.nombre, 'utf-8');
    const original = Buffer.from(e.datos);
    const comprimido = metodo === 8 ? zlib.deflateRawSync(original) : original;
    const crc = crc32(original);
    const descomprimidoDeclarado = e.descomprimidoBytesFalso ?? original.length;
    const flag = e.flag ?? 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flag, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(descomprimidoDeclarado, 22);
    local.writeUInt16LE(nombreBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const localOffset = offset;
    partesLocal.push(local, nombreBuf, comprimido);
    offset += local.length + nombreBuf.length + comprimido.length;

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flag, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(descomprimidoDeclarado, 24);
    central.writeUInt16LE(nombreBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(e.discoInicio ?? 0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    partesCentral.push(central, nombreBuf);
  }

  const local = Buffer.concat(partesLocal);
  const central = Buffer.concat(partesCentral);
  const offsetCD = local.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offsetCD, 16);
  eocd.writeUInt16LE(0, 20);

  return new Uint8Array(Buffer.concat([local, central, eocd]));
}

/** Construye SOLO un registro EOCD (sin directorio central real) con `totalEntradas` en la cabecera — para el test del límite de entradas, que se detecta ANTES de recorrer el directorio. */
export function construirEOCDConTotal(totalEntradas: number): Uint8Array {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(totalEntradas, 8);
  eocd.writeUInt16LE(totalEntradas, 10);
  eocd.writeUInt32LE(0, 12);
  eocd.writeUInt32LE(0, 16);
  eocd.writeUInt16LE(0, 20);
  return new Uint8Array(eocd);
}
