import type { Pdfium } from './loadEngine';

/** Helpers sobre la memoria del módulo emscripten. Encapsula el `any` de la frontera WASM. */
export interface Mem {
  HEAPU8: Uint8Array;
  malloc(n: number): number;
  free(ptr: number): void;
  setValue(ptr: number, v: number, type: string): void;
  getValue(ptr: number, type: string): number;
  UTF8ToString(ptr: number): string;
  readU16(ptr: number): string;
  addFunction(fn: (...args: number[]) => number, sig: string): number;
  /** Libera un slot de tabla de funciones reservado por `addFunction`. Llamar SIEMPRE en un `finally` (§2.6). */
  removeFunction(idx: number): void;
  copyIn(bytes: Uint8Array): number;
  wide(s: string): number;
}

export function makeMem(p: Pdfium): Mem {
  const m = (p as any).pdfium;
  return {
    // GETTER, no un valor capturado: la memoria WASM puede CRECER (p. ej. al
    // procesar una imagen grande, varios MB) y Emscripten entonces
    // reemplaza el ArrayBuffer subyacente por uno nuevo, dejando cualquier
    // Uint8Array anterior "detached" (E-035). Guardar `m.HEAPU8` una sola
    // vez en un campo normal daba `TypeError: Cannot perform Construct on a
    // detached ArrayBuffer` en cuanto el heap crecía a mitad de una
    // operación (reproducido con una imagen de 2000×2000 en
    // replaceImageJpeg). Con el getter, cada `mem.HEAPU8` relee la vista
    // ACTUAL del módulo.
    get HEAPU8() { return m.HEAPU8 as Uint8Array; },
    malloc: (n) => m._malloc(n),
    free: (ptr) => m._free(ptr),
    setValue: (ptr, v, type) => m.setValue(ptr, v, type),
    getValue: (ptr, type) => m.getValue(ptr, type),
    UTF8ToString: (ptr) => m.UTF8ToString(ptr),
    readU16: (ptr) => m.UTF16ToString(ptr),
    addFunction: (fn, sig) => m.addFunction(fn, sig),
    removeFunction: (idx) => m.removeFunction(idx),
    copyIn(bytes) { const ptr = m._malloc(bytes.length); m.HEAPU8.set(bytes, ptr); return ptr; },
    wide(s) {
      const b = new Uint8Array((s.length + 1) * 2);
      for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) & 0xff; b[i * 2 + 1] = s.charCodeAt(i) >> 8; }
      const ptr = m._malloc(b.length); m.HEAPU8.set(b, ptr); return ptr;
    }
  };
}

/**
 * Patrón de dos llamadas obligatorio para los getters de cadena de PDFium
 * (FPDFTextObj_GetText, FPDFFont_GetBaseFontName, FPDFAnnot_GetStringValue,
 * FPDFText_GetText...). Llamar con buffer=0/buflen=0 devuelve el tamaño exacto
 * necesario; un buffer menor que ese tamaño NO se rellena — a diferencia de
 * otras APIs C que truncan, PDFium deja el buffer tal cual estaba, es decir,
 * memoria sin inicializar (E-028). `llamar(bufPtr, bufLen)` debe invocar el
 * getter real pasando esos dos como sus últimos argumentos.
 */
export function leerCadenaPdfium(
  mem: Mem,
  llamar: (bufPtr: number, bufLen: number) => number,
  decodificar: (ptr: number) => string
): string {
  const needed = llamar(0, 0);
  if (needed <= 0) return '';
  const buf = mem.malloc(needed);
  try {
    llamar(buf, needed);
    return decodificar(buf);
  } finally {
    mem.free(buf);
  }
}
