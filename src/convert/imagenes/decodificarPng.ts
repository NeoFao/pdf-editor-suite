/**
 * Decodificador PNG propio, PURO y sin dependencias (PR fase 2a, §9 fila #4:
 * imágenes inline en DOCX). Deliberadamente no delega en `createImageBitmap`
 * para este formato: así el mismo código decodifica en el navegador Y en
 * Node (los tests unitarios de `ConversorDocxNavegador` corren en Node —
 * `vitest.config.ts` fija `environment: 'node'` — donde no existe
 * `createImageBitmap`/`<canvas>`). Usa únicamente `DecompressionStream`
 * ('deflate', el formato zlib con cabecera de 2 bytes y Adler-32 final — NO
 * 'deflate-raw', que es lo que usa `docx/zip.ts` para las entradas del ZIP;
 * PNG envuelve su IDAT en zlib, el ZIP no), disponible en navegadores
 * modernos y en Node ≥18 sin librería — mismo principio que `docx/zip.ts`.
 *
 * Alcance deliberado de esta fase (documentos DOCX reales casi siempre traen
 * PNG de 8 bits sin entrelazar, que es justo lo que cubre esto):
 * - Bit depth 8 (y 16, truncando al byte alto — aproximación aceptable para
 *   RGBA de 8 bits de salida).
 * - Color type 0 (gris), 2 (RGB), 3 (paleta, con `tRNS` opcional), 4
 *   (gris+alfa), 6 (RGBA).
 * - Sin entrelazado Adam7 (`interlace !== 0` se rechaza con `null` — señal
 *   para que el conversor lo cuente en advertencias, nunca se pierde en
 *   silencio).
 * - `tRNS` de los tipos 0/2 (color clave transparente, no paleta) no se
 *   admite: esas imágenes salen opacas. Poco frecuente en capturas/fotos
 *   pegadas en Word, que es el caso real que cubre esta fase.
 */

export interface ImagenDecodificada { rgba: Uint8Array; width: number; height: number }

const FIRMA = [137, 80, 78, 71, 13, 10, 26, 10];

/** Límite de seguridad (spec fase 2a §3): una imagen mayor se cuenta en advertencias y se omite, nunca se decodifica. */
export const MAX_IMG_DIM = 8000;

interface Chunk { tipo: string; datos: Uint8Array }

function leerChunks(bytes: Uint8Array): Chunk[] {
  const chunks: Chunk[] = [];
  let i = 8; // tras la firma
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (i + 8 <= bytes.length) {
    const len = view.getUint32(i, false);
    const tipo = String.fromCharCode(bytes[i + 4]!, bytes[i + 5]!, bytes[i + 6]!, bytes[i + 7]!);
    const inicioDatos = i + 8;
    if (inicioDatos + len + 4 > bytes.length) break; // truncado: se ignora el resto
    chunks.push({ tipo, datos: bytes.subarray(inicioDatos, inicioDatos + len) });
    i = inicioDatos + len + 4; // +4 = CRC, no se verifica (defensa de integridad ya la hace docx/zip.ts sobre el .docx completo)
    if (tipo === 'IEND') break;
  }
  return chunks;
}

/**
 * Descomprime en streaming con un tope EXACTO de bytes (`limiteBytes`,
 * calculado por el llamador a partir de `width`/`height`/`IHDR` — el tamaño
 * inflado de un PNG es determinista): igual defensa que `inflateAcotado` de
 * `docx/zip.ts` (E-042) contra una entrada IDAT que declare una imagen
 * pequeña pero cuyo deflate real produzca gigabytes. Cancela el stream y
 * devuelve `null` en cuanto se supera — nunca envolviendo el flujo en un
 * `Response` para pedir su cuerpo completo de golpe (regla
 * `docx-descomprimir-acotado`).
 */
async function inflateZlibAcotado(datos: Uint8Array, limiteBytes: number): Promise<Uint8Array | null> {
  const ab = datos.buffer.slice(datos.byteOffset, datos.byteOffset + datos.byteLength) as ArrayBuffer;
  const flujo = new Blob([ab]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = flujo.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limiteBytes) { await reader.cancel(); return null; }
    trozos.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const t of trozos) { out.set(t, off); off += t.length; }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Deshace el filtrado PNG por scanline (§ "Filter Method 0" de la especificación PNG) y devuelve los bytes de muestra crudos (sin el byte de filtro de cada fila). */
function desfiltrar(datos: Uint8Array, width: number, height: number, bytesPorPixel: number): Uint8Array {
  const stride = Math.ceil((width * bytesPorPixel * 8) / 8); // bytesPorPixel ya es bytes/px cuando bitDepth>=8; para <8 se llama con bytesPorPixel=1 y stride se ajusta fuera
  const out = new Uint8Array(height * stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filtro = datos[src]!; src++;
    const filaOut = y * stride;
    const filaPrev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const raw = datos[src + x]!;
      const a = x >= bytesPorPixel ? out[filaOut + x - bytesPorPixel]! : 0;
      const b = y > 0 ? out[filaPrev + x]! : 0;
      const c = (x >= bytesPorPixel && y > 0) ? out[filaPrev + x - bytesPorPixel]! : 0;
      let valor: number;
      switch (filtro) {
        case 0: valor = raw; break;
        case 1: valor = (raw + a) & 0xff; break;
        case 2: valor = (raw + b) & 0xff; break;
        case 3: valor = (raw + ((a + b) >> 1)) & 0xff; break;
        case 4: valor = (raw + paeth(a, b, c)) & 0xff; break;
        default: valor = raw; break; // filtro desconocido: se trata como "None" (mejor esfuerzo, no se rechaza el documento entero por esto)
      }
      out[filaOut + x] = valor;
    }
    src += stride;
  }
  return out;
}

/** `null` si `bytes` no empieza con la firma PNG. */
export function esPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== FIRMA[i]) return false;
  return true;
}

/**
 * Decodifica un PNG a RGBA. `null` si el formato no es PNG, está corrupto, o
 * usa una variante fuera del alcance de esta fase (entrelazado, bit depth
 * distinto de 8/16) — el llamador debe contarlo en advertencias, nunca
 * fallar la conversión entera por una imagen.
 */
export async function decodificarPng(bytes: Uint8Array): Promise<ImagenDecodificada | null> {
  if (!esPng(bytes)) return null;
  const chunks = leerChunks(bytes);
  const ihdr = chunks.find((c) => c.tipo === 'IHDR');
  if (!ihdr || ihdr.datos.length < 13) return null;
  const view = new DataView(ihdr.datos.buffer, ihdr.datos.byteOffset, ihdr.datos.byteLength);
  const width = view.getUint32(0, false);
  const height = view.getUint32(4, false);
  const bitDepth = ihdr.datos[8]!;
  const colorType = ihdr.datos[9]!;
  const compression = ihdr.datos[10]!;
  const filterMethod = ihdr.datos[11]!;
  const interlace = ihdr.datos[12]!;
  if (width <= 0 || height <= 0 || compression !== 0 || filterMethod !== 0 || interlace !== 0) return null;
  if (width > MAX_IMG_DIM || height > MAX_IMG_DIM) return null; // límite de seguridad, spec fase 2a §3
  if (bitDepth !== 8 && bitDepth !== 16) return null; // fuera de alcance de esta fase (ver comentario de módulo)

  const canales = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : -1;
  if (canales === -1) return null;

  const idatTotal = chunks.filter((c) => c.tipo === 'IDAT').reduce((s, c) => s + c.datos.length, 0);
  const idat = new Uint8Array(idatTotal);
  { let off = 0; for (const c of chunks) if (c.tipo === 'IDAT') { idat.set(c.datos, off); off += c.datos.length; } }

  const bytesPorMuestra = bitDepth === 16 ? 2 : 1;
  const bytesPorPixel = canales * bytesPorMuestra;
  const stride = width * bytesPorPixel;
  // Tamaño inflado EXACTO y determinista de un PNG no entrelazado: 1 byte de
  // filtro + `stride` bytes de muestras, por cada fila (E-042: el tope se
  // calcula, no se adivina).
  const limiteInflado = height * (1 + stride);

  let inflado: Uint8Array | null;
  try {
    inflado = await inflateZlibAcotado(idat, limiteInflado);
  } catch {
    return null;
  }
  if (!inflado || inflado.length !== limiteInflado) return null; // corto o largo de más: PNG corrupto/manipulado

  const raw = desfiltrar(inflado, width, height, bytesPorPixel);

  let plte: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  if (colorType === 3) {
    plte = chunks.find((c) => c.tipo === 'PLTE')?.datos ?? null;
    if (!plte) return null; // paleta obligatoria para colorType 3
    trns = chunks.find((c) => c.tipo === 'tRNS')?.datos ?? null;
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = y * stride + x * bytesPorPixel;
      const d = (y * width + x) * 4;
      const leer = (canal: number): number => bitDepth === 16 ? raw[s + canal * 2]! : raw[s + canal]!;
      if (colorType === 0) { const g = leer(0); rgba[d] = g; rgba[d + 1] = g; rgba[d + 2] = g; rgba[d + 3] = 255; }
      else if (colorType === 2) { rgba[d] = leer(0); rgba[d + 1] = leer(1); rgba[d + 2] = leer(2); rgba[d + 3] = 255; }
      else if (colorType === 3) {
        const idx = raw[s]!;
        rgba[d] = plte![idx * 3] ?? 0; rgba[d + 1] = plte![idx * 3 + 1] ?? 0; rgba[d + 2] = plte![idx * 3 + 2] ?? 0;
        rgba[d + 3] = trns && idx < trns.length ? trns[idx]! : 255;
      } else if (colorType === 4) { const g = leer(0); rgba[d] = g; rgba[d + 1] = g; rgba[d + 2] = g; rgba[d + 3] = leer(1); }
      else { rgba[d] = leer(0); rgba[d + 1] = leer(1); rgba[d + 2] = leer(2); rgba[d + 3] = leer(3); }
    }
  }

  return { rgba, width, height };
}
