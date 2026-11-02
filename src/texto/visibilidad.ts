import type { RectPt } from '../engine/PdfEngine';

/**
 * E-123: el texto que queda fuera de la caja visible (CropBox recortada a la MediaBox) no se ofrece al usuario como línea
 * editable ni en la búsqueda/selección, pero SIGUE en el PDF (§2.3: no se borra lo que el usuario no tocó).
 *
 * Unidades: pt de usuario SIN girar (espacio de PDFium); `CajaVisiblePt` es lo que da `PdfEngine.pageBox` (esquina
 * inferior-izquierda y tamaño sin girar), así que el /Rotate no interviene en la comprobación.
 */
export interface CajaVisiblePt { origenPt: { xPt: number; yPt: number }; tamanoPt: { widthPt: number; heightPt: number } }

/** Holgura (pt) para no conservar cajas que solo rozan el borde por redondeo o márgenes de glifo. */
const HOLGURA_PT = 0.5;

/** ¿La caja se solapa con la caja visible? Una caja sin área (salto de línea que genera PDFium) se conserva. */
export function cajaVisible(box: RectPt, v: CajaVisiblePt): boolean {
  if (box.wPt === 0 && box.hPt === 0) return true;
  const x0 = v.origenPt.xPt, y0 = v.origenPt.yPt;
  const x1 = x0 + v.tamanoPt.widthPt, y1 = y0 + v.tamanoPt.heightPt;
  return box.xPt + box.wPt > x0 + HOLGURA_PT && box.xPt < x1 - HOLGURA_PT
    && box.yPt + box.hPt > y0 + HOLGURA_PT && box.yPt < y1 - HOLGURA_PT;
}
