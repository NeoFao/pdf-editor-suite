import { decodificarPng, esPng, MAX_IMG_DIM, type ImagenDecodificada } from './decodificarPng';
import { decodificarImagenNavegador } from './decodificarImagenNavegador';

/** Límite de seguridad (spec fase 2a §3): bytes crudos de la imagen fuente (antes de decodificar), no el tamaño ya decodificado en RGBA. */
export const MAX_IMG_BYTES = 25 * 1024 * 1024;

export type ResultadoImagenDocx =
  | { ok: true; imagen: ImagenDecodificada }
  | { ok: false; razon: 'demasiado-grande' | 'formato-no-soportado' | 'no-decodificable' };

/** Firma de bytes -> tipo MIME, para los formatos que este módulo sabe decodificar. `null` = formato no reconocido (EMF/WMF/TIFF/GIF animado...). */
function detectarMime(bytes: Uint8Array): string | null {
  if (esPng(bytes)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

/**
 * Decodifica una imagen inline de un `.docx` (`word/media/*`) a RGBA. PNG se
 * decodifica con el módulo propio (`decodificarPng.ts`, portable a Node: los
 * tests unitarios del conversor pueden ejercitarlo con el motor real sin
 * navegador). Cualquier otro formato reconocido (hoy solo JPEG) pasa por el
 * adaptador de navegador (`decodificarImagenNavegador.ts`, `createImageBitmap`)
 * — solo funciona en un navegador real, así que ese camino concreto se
 * ejercita en los tests E2E. Un formato no reconocido (EMF/WMF/TIFF...) o que
 * supere los límites de seguridad nunca lanza: se cuenta en advertencias por
 * el llamador (nunca se pierde en silencio, AGENTS.md §3).
 */
export async function decodificarImagenDocx(bytes: Uint8Array): Promise<ResultadoImagenDocx> {
  if (bytes.length > MAX_IMG_BYTES) return { ok: false, razon: 'demasiado-grande' };
  const mime = detectarMime(bytes);
  if (!mime) return { ok: false, razon: 'formato-no-soportado' };

  const imagen = mime === 'image/png' ? await decodificarPng(bytes) : await decodificarImagenNavegador(bytes, mime);
  if (!imagen) return { ok: false, razon: 'no-decodificable' };
  if (imagen.width > MAX_IMG_DIM || imagen.height > MAX_IMG_DIM) return { ok: false, razon: 'demasiado-grande' };
  return { ok: true, imagen };
}
