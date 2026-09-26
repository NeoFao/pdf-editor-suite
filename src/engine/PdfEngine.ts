/** Contrato estable con el motor PDF. La UI y los comandos dependen de esto, nunca de FPDF_*. */

export interface SizePt { widthPt: number; heightPt: number }
export interface RectPt { xPt: number; yPt: number; wPt: number; hPt: number }

export interface TextRun {
  runId: number;               // índice del objeto de texto en la página
  text: string;
  boxPt: RectPt;
  fontName: string;
  sizePt: number;
  color: [number, number, number, number]; // RGBA 0-255
}

export type EditResult = { ok: true } | { ok: false; reason: 'glyph-missing' | 'not-a-text-run' };

/** Puntero opaco al documento dentro del motor. */
export type DocHandle = number;

export interface PdfEngine {
  open(bytes: Uint8Array): Promise<DocHandle>;
  pageCount(doc: DocHandle): number;
  pageSize(doc: DocHandle, pageIndex: number): SizePt;
  save(doc: DocHandle): Uint8Array;
  close(doc: DocHandle): void;
}
