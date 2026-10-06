import type { SizePt, TextRun } from '../engine/PdfEngine';
import type { Rotation } from '../coords/PageGeometry';

export interface PageModel {
  index: number;
  /** Tamaño VISUAL de la página (caja visible ya girada), pt. */
  sizePt: SizePt;
  /** Esquina inferior-izquierda de la caja visible SIN girar, en pt de usuario; distinta de (0,0) con CropBox/MediaBox desplazados (E-084). */
  origenPt: { xPt: number; yPt: number };
  rotation: Rotation;
  runs: TextRun[];
}

export interface Selection { pageIndex: number; runId: number }
