import type { InsertTextSpec } from '../engine/PdfEngine';
import { PageGeometry, type Rotation } from '../coords/PageGeometry';
import type { OcrLine } from './OcrProvider';

/**
 * Página tal como la VE el usuario (E-089): tamaño visual en pt (ya girado), su `/Rotate` y la esquina inferior-izquierda
 * de la caja visible sin girar en pt de usuario (E-084). Es lo que `engine.pageBox` da con el tamaño girado para 90/270.
 */
export interface PaginaOcr {
  anchoVisualPt: number;
  altoVisualPt: number;
  rotacion: Rotation;
  origenPt?: { xPt: number; yPt: number };
}

/**
 * Convierte líneas reconocidas por OCR en especificaciones de texto invisible. Las cajas están en píxeles del bitmap
 * RENDERIZADO (la página ya girada, origen arriba-izquierda, `scale` px por pt visual); el texto se coloca en el ESPACIO DE
 * USUARIO del PDF (pt, origen abajo-izquierda, sin girar) con la geometría común (`PageGeometry`: E-053 rotación, E-084
 * origen de la caja visible) y se gira `rotacion` grados para quedar horizontal en la página girada.
 *
 * Pura: no toca el motor ni el documento. Ignora las líneas cuyo texto, tras `trim()`, queda vacío.
 */
export function mapOcrLines(lines: OcrLine[], scale: number, pagina: PaginaOcr): InsertTextSpec[] {
  // Escala 1: px CSS de la geometría = pt visuales; el bitmap se pasa a pt visuales dividiendo por `scale`.
  const geo = PageGeometry.desdeTamanoVisual(pagina.anchoVisualPt, pagina.altoVisualPt, 1, pagina.rotacion, pagina.origenPt);
  const specs: InsertTextSpec[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const { x0, y0, y1 } = line.bbox;
    // Origen de la línea base: esquina inferior-izquierda de la caja, en la página visual.
    const o = geo.cssToPt(x0 / scale, y1 / scale);
    const sizePt = Math.max(4, ((y1 - y0) / scale) * 0.8);
    specs.push({ xPt: o.xPt, yPt: o.yPt, sizePt, text, invisible: true, ...(pagina.rotacion ? { giroGrados: pagina.rotacion } : {}) });
  }
  return specs;
}
