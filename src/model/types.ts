import type { SizePt, TextRun } from '../engine/PdfEngine';
import type { Rotation } from '../coords/PageGeometry';

export interface PageModel {
  index: number;
  sizePt: SizePt;
  rotation: Rotation;
  runs: TextRun[];
}

export interface Selection { pageIndex: number; runId: number }
