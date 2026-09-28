import type { InsertTextSpec } from '../engine/PdfEngine';
import type { OcrLine } from './OcrProvider';

/**
 * Convierte líneas reconocidas por OCR (píxeles de la imagen renderizada, origen
 * arriba-izquierda, escaladas por `scale` respecto al PDF) en especificaciones
 * de texto invisible en puntos PDF (origen abajo-izquierda, eje Y invertido).
 *
 * Pura: no toca el motor ni el documento. Ignora las líneas cuyo texto, tras
 * `trim()`, queda vacío.
 */
export function mapOcrLines(lines: OcrLine[], scale: number, pageHeightPt: number): InsertTextSpec[] {
  const specs: InsertTextSpec[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const { x0, y0, y1 } = line.bbox;
    const xPt = x0 / scale;
    const yPt = pageHeightPt - y1 / scale;
    const sizePt = Math.max(4, ((y1 - y0) / scale) * 0.8);
    specs.push({ xPt, yPt, sizePt, text, invisible: true });
  }
  return specs;
}
