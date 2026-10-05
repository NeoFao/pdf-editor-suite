/**
 * Conversión RGBA <-> PNG dataURL para las firmas guardadas (solo navegador: usa canvas).
 * Unidades: todo en px de imagen (no hay coordenadas de página aquí).
 */
import { ANCHO_MAX_GUARDADO } from './firmasGuardadas';

export interface FirmaPng { dataUrl: string; ancho: number; alto: number }

/** RGBA -> PNG dataURL, reescalado a `ANCHO_MAX_GUARDADO` px de ancho como máximo. */
export function rgbaAPngDataUrl(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): FirmaPng {
  const origen = document.createElement('canvas');
  origen.width = width; origen.height = height;
  const octx = origen.getContext('2d')!;
  octx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  if (width <= ANCHO_MAX_GUARDADO) return { dataUrl: origen.toDataURL('image/png'), ancho: width, alto: height };
  const ancho = ANCHO_MAX_GUARDADO;
  const alto = Math.max(1, Math.round(height * (ancho / width)));
  const destino = document.createElement('canvas');
  destino.width = ancho; destino.height = alto;
  const dctx = destino.getContext('2d')!;
  dctx.imageSmoothingQuality = 'high';
  dctx.drawImage(origen, 0, 0, ancho, alto);
  return { dataUrl: destino.toDataURL('image/png'), ancho, alto };
}

/** PNG dataURL (ya validado por `esDataUrlPng`) -> píxeles RGBA. */
export async function pngDataUrlARgba(dataUrl: string): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  return { rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: c.width, height: c.height };
}
