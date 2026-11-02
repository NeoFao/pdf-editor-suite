import type { SizePt, TextRun } from '../engine/PdfEngine';
import type { Rotation } from '../coords/PageGeometry';

export interface PageModel {
  index: number;
  /** Tamaño VISUAL de la página (caja visible ya girada), pt. */
  sizePt: SizePt;
  /** Esquina inferior-izquierda de la caja visible SIN girar, en pt de usuario; distinta de (0,0) con CropBox/MediaBox desplazados (E-084). */
  origenPt: { xPt: number; yPt: number };
  /** `/UserUnit` de la página (1 por defecto). Solo la VISTA lo multiplica a la escala; `sizePt` y las coordenadas no lo llevan (E-099). */
  userUnit: number;
  /**
   * `true` si el motor declara un tamaño absurdo (no finito, ≤ 0 o > 14400 pt × `userUnit`, E-126): `sizePt` es entonces
   * un tamaño SUSTITUTO (A4) para poder maquetar y la vista pinta un marcador de error en vez del bitmap.
   */
  tamanoInvalido?: true;
  rotation: Rotation;
  runs: TextRun[];
}

export interface Selection { pageIndex: number; runId: number }
