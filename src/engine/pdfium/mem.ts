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
  copyIn(bytes: Uint8Array): number;
  wide(s: string): number;
}

export function makeMem(p: Pdfium): Mem {
  const m = (p as any).pdfium;
  return {
    HEAPU8: m.HEAPU8,
    malloc: (n) => m._malloc(n),
    free: (ptr) => m._free(ptr),
    setValue: (ptr, v, type) => m.setValue(ptr, v, type),
    getValue: (ptr, type) => m.getValue(ptr, type),
    UTF8ToString: (ptr) => m.UTF8ToString(ptr),
    readU16: (ptr) => m.UTF16ToString(ptr),
    addFunction: (fn, sig) => m.addFunction(fn, sig),
    copyIn(bytes) { const ptr = m._malloc(bytes.length); m.HEAPU8.set(bytes, ptr); return ptr; },
    wide(s) {
      const b = new Uint8Array((s.length + 1) * 2);
      for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) & 0xff; b[i * 2 + 1] = s.charCodeAt(i) >> 8; }
      const ptr = m._malloc(b.length); m.HEAPU8.set(b, ptr); return ptr;
    }
  };
}
