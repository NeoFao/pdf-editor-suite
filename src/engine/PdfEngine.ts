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

/** Especificación de un texto nuevo a insertar (coordenadas en puntos PDF). */
export interface InsertTextSpec {
  xPt: number;
  yPt: number;
  text: string;
  sizePt: number;
  fontName?: string;          // fuente estándar; por defecto Helvetica
  color?: [number, number, number]; // RGB 0-255; por defecto negro
}

/** Puntero opaco al documento dentro del motor. */
export type DocHandle = number;

export interface PdfEngine {
  open(bytes: Uint8Array): Promise<DocHandle>;
  pageCount(doc: DocHandle): number;
  pageSize(doc: DocHandle, pageIndex: number): SizePt;
  /** Rotación de la página en grados: 0, 90, 180 o 270. */
  pageRotation(doc: DocHandle, pageIndex: number): 0 | 90 | 180 | 270;
  /** Renderiza la página a un bitmap RGBA a la escala dada. */
  renderPage(doc: DocHandle, pageIndex: number, scale: number): RenderResult;
  /** Busca `query` en la página (insensible a mayúsculas) y devuelve la caja de cada coincidencia. */
  findText(doc: DocHandle, pageIndex: number, query: string): RectPt[];
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
  /** Inserta un texto nuevo en la página; devuelve el runId del objeto creado. */
  insertText(doc: DocHandle, pageIndex: number, spec: InsertTextSpec): number;
  /** Desplaza un run por (dxPt, dyPt) en puntos PDF. Reversible con el delta inverso. */
  moveRun(doc: DocHandle, pageIndex: number, runId: number, dxPt: number, dyPt: number): boolean;
  /** Cambia el color de relleno de un run (RGB 0-255). */
  setRunColor(doc: DocHandle, pageIndex: number, runId: number, color: [number, number, number]): boolean;
  /** Rota la página por `deltaDeg` (múltiplo de 90). Devuelve la nueva rotación en grados. */
  rotatePage(doc: DocHandle, pageIndex: number, deltaDeg: number): 0 | 90 | 180 | 270;
  /** Elimina la página del documento. */
  deletePage(doc: DocHandle, pageIndex: number): void;
  /** Mueve la página de `fromIndex` a `toIndex` (reordena). */
  movePage(doc: DocHandle, fromIndex: number, toIndex: number): boolean;
  save(doc: DocHandle): Uint8Array<ArrayBuffer>;
  close(doc: DocHandle): void;
}
