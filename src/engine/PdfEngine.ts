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

/** Bitmap RGBA listo para volcar en un canvas. */
export interface RenderResult { width: number; height: number; data: Uint8ClampedArray }

/** Puntero opaco al documento dentro del motor. */
export type DocHandle = number;

export interface PdfEngine {
  open(bytes: Uint8Array): Promise<DocHandle>;
  pageCount(doc: DocHandle): number;
  pageSize(doc: DocHandle, pageIndex: number): SizePt;
  /** Renderiza la página a un bitmap RGBA a la escala dada. */
  renderPage(doc: DocHandle, pageIndex: number, scale: number): RenderResult;
  /** Runs de texto de la página, con su caja, fuente, tamaño y color. Vacío si no hay texto (escaneado). */
  getPageText(doc: DocHandle, pageIndex: number): TextRun[];
  /**
   * Edita el texto de un run EN SITIO: conserva fuente, tamaño, color y posición.
   * No crea objetos nuevos ni rasteriza. Devuelve `glyph-missing` (sin modificar)
   * si la fuente del run no tiene algún glifo del nuevo texto.
   */
  editTextRun(doc: DocHandle, pageIndex: number, runId: number, newText: string): EditResult;
  /**
   * Redacción real: elimina el objeto de texto del flujo de contenido (no lo tapa).
   * Tras guardar, el texto ya no es extraíble. Devuelve true si eliminó un run.
   */
  deleteRun(doc: DocHandle, pageIndex: number, runId: number): boolean;
  save(doc: DocHandle): Uint8Array<ArrayBuffer>;
  close(doc: DocHandle): void;
}
