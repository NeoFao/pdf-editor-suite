/**
 * Adaptador pequeño que aísla las dos únicas operaciones de la compresión de
 * imagen (fila #29 de la tabla de paridad, §9) que necesitan el navegador:
 * reescalar un bitmap con buen remuestreo y codificar JPEG. Ninguna de las
 * dos existe en Node (por eso viven aquí, en `src/ui/`, y no en
 * `src/image/comprimir.ts`, que es pura y se testea en Node) — se cubren con
 * los E2E de `tests/e2e/next/filtros-comprimir.spec.ts`, no con unit tests.
 * `ComprimirDocumentoCmd` recibe una implementación de `AdaptadorImagen` por
 * constructor (por defecto esta); los tests de comando inyectan una falsa.
 */
export interface AdaptadorImagen {
  /** Reescala RGBA a un tamaño nuevo con el remuestreo del navegador (drawImage). Conserva el alfa. */
  reescalar(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    targetWidth: number,
    targetHeight: number
  ): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }>;
  /** Codifica RGBA (se asume opaco: el JPEG no tiene canal alfa) a JPEG con la calidad dada (0-1). */
  codificarJpeg(rgba: Uint8ClampedArray, width: number, height: number, calidad: number): Promise<Uint8Array>;
  /** Libera recursos (el worker de T15). El comando lo llama al terminar, con éxito o no (§2.6). */
  cerrar?(): void;
}

function canvasCon(rgba: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas;
}

export const adaptadorImagenNavegador: AdaptadorImagen = {
  async reescalar(rgba, width, height, targetWidth, targetHeight) {
    const src = canvasCon(rgba, width, height);
    const dst = document.createElement('canvas');
    dst.width = targetWidth; dst.height = targetHeight;
    const dctx = dst.getContext('2d')!;
    dctx.drawImage(src, 0, 0, targetWidth, targetHeight);
    const { data } = dctx.getImageData(0, 0, targetWidth, targetHeight);
    return { rgba: data, width: targetWidth, height: targetHeight };
  },

  async codificarJpeg(rgba, width, height, calidad) {
    const canvas = canvasCon(rgba, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => { if (b) resolve(b); else reject(new Error('No se pudo codificar JPEG')); }, 'image/jpeg', calidad);
    });
    return new Uint8Array(await blob.arrayBuffer());
  }
};
