import type { ImagenDecodificada } from './decodificarPng';

/**
 * Adaptador de imagen del NAVEGADOR (PR fase 2a, spec §3): decodifica con
 * `createImageBitmap` + `<canvas>` — la única vía sin dependencias para JPEG
 * (un decodificador JPEG baseline propio es un módulo entero por sí mismo,
 * fuera de alcance de esta fase) y cualquier otro formato que el navegador
 * entienda de forma nativa. Aislado en su propio fichero para que el modelo
 * (`docx/modelo.ts`) y el maquetador (`flujo/layout.ts`) sigan puros: ninguno
 * de los dos importa esto ni conoce el DOM.
 *
 * Solo funciona en un navegador real (necesita `createImageBitmap`/canvas):
 * `decodificarImagenDocx` (`decodificarImagen.ts`) prueba primero el
 * decodificador PNG propio, portable a Node — así los tests unitarios del
 * conversor (que corren en Node, `vitest.config.ts`) pueden ejercitar el
 * camino PNG con el motor real sin necesitar un navegador. El camino JPEG
 * (este adaptador) solo se ejercita en los tests E2E (Playwright, Chromium
 * real), consistente con AGENTS.md §2.1: lo que necesita DOM real se prueba
 * en Chromium, no se simula.
 */
export async function decodificarImagenNavegador(bytes: Uint8Array, mimeType: string): Promise<ImagenDecodificada | null> {
  if (typeof createImageBitmap !== 'function') return null;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mimeType }));
  } catch {
    return null;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width; canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { rgba: new Uint8Array(data), width: bmp.width, height: bmp.height };
  } finally {
    bmp.close();
  }
}
