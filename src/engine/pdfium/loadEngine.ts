import { init } from '@embedpdf/pdfium';

export type Pdfium = Awaited<ReturnType<typeof init>>;

let cached: Promise<Pdfium> | null = null;

/** Obtiene los bytes del WASM: por fs en Node (tests), por fetch(?url) en el navegador. */
async function getWasmBinary(): Promise<Uint8Array> {
  if (typeof window === 'undefined') {
    // Rama solo-Node (tests). @vite-ignore evita que el bundler del navegador
    // intente empaquetar módulos nativos que aquí nunca se ejecutan.
    const { readFile } = await import(/* @vite-ignore */ 'node:fs/promises');
    const { createRequire } = await import(/* @vite-ignore */ 'node:module');
    const req = createRequire(import.meta.url);
    const wasmPath = req.resolve('@embedpdf/pdfium/pdfium.wasm');
    return new Uint8Array(await readFile(wasmPath));
  }
  const { default: wasmUrl } = await import('@embedpdf/pdfium/pdfium.wasm?url');
  const res = await fetch(wasmUrl);
  return new Uint8Array(await res.arrayBuffer());
}

/** Inicializa el motor PDFium una sola vez (memoizado) y llama a FPDF_InitLibrary. */
export function loadEngine(): Promise<Pdfium> {
  if (cached) return cached;
  cached = (async () => {
    const wasmBinary = await getWasmBinary();
    const p = await init({ wasmBinary });
    p.FPDF_InitLibrary();
    return p;
  })();
  return cached;
}
