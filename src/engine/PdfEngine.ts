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
  /**
   * Origen de la línea base del objeto de texto, en puntos PDF (origen
   * abajo-izquierda), es decir (e, f) de su matriz de texto. A diferencia de
   * `boxPt` (la caja ajustada a los glifos, de `FPDFPageObj_GetBounds`), este
   * es el punto exacto donde el motor apoya la línea base al pintar — lo que
   * hay que reproducir al editar para que el texto no se desplace verticalmente
   * (E-030). Asume texto horizontal sin rotación/sesgo (b≈0, c≈0 en la matriz).
   */
  originPt: { xPt: number; yPt: number };
}

export type EditResult = { ok: true } | { ok: false; reason: 'glyph-missing' | 'not-a-text-run' };

/**
 * Resultado de `replaceRunWithStandardFont`. `fontName` es la fuente estándar
 * PDF realmente usada (de las 14) y `runId` el índice del objeto NUEVO — el
 * original se elimina, así que el runId cambia.
 */
export type ReplaceFontResult =
  | { ok: true; fontName: string; runId: number }
  | { ok: false; reason: 'glyph-missing' | 'not-a-text-run' };

/** Nota adhesiva (anotación PDF real de subtipo Text). `index` es su índice entre TODAS las anotaciones de la página. */
export interface NoteInfo { index: number; text: string; rectPt: RectPt }

/** Tipo de campo AcroForm (FPDF_FORMFIELD_*). Fase 1 solo edita 'text' y 'checkbox'. */
export type FormFieldKind = 'text' | 'checkbox' | 'radio' | 'combo' | 'list' | 'button' | 'signature' | 'unknown';

/**
 * Campo de un formulario AcroForm. `annotIndex` es su índice entre TODAS las
 * anotaciones de la página (igual convención que `NoteInfo.index`). `value` es
 * el valor de campo (`/V`): para una casilla, su nombre de exportación/estado
 * ('Off' cuando no está marcada); `checked` es la verdad de negocio derivada.
 */
export interface FormField {
  annotIndex: number;
  name: string;
  kind: FormFieldKind;
  value: string;
  checked: boolean;
  readOnly: boolean;
  rectPt: RectPt;
}

/** Bitmap RGBA listo para volcar en un canvas. */
export interface RenderResult { width: number; height: number; data: Uint8ClampedArray }

/** Imagen a insertar: píxeles RGBA ya decodificados + tamaño y colocación en puntos PDF. */
export interface InsertImageSpec {
  rgba: Uint8Array;      // imgWidth*imgHeight*4, orden RGBA
  imgWidth: number;
  imgHeight: number;
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
}

/** Especificación de un texto nuevo a insertar (coordenadas en puntos PDF). */
export interface InsertTextSpec {
  xPt: number;
  yPt: number;
  text: string;
  sizePt: number;
  fontName?: string;          // fuente estándar; por defecto Helvetica
  color?: [number, number, number]; // RGB 0-255; por defecto negro
  /** Modo de render 3 (invisible): buscable/extraíble pero no se pinta. Para capas de OCR. */
  invisible?: boolean;
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
   * Sustituye un run cuyo `editTextRun` devolvió `glyph-missing` por un
   * objeto de texto NUEVO en la fuente estándar PDF más parecida (de las 14
   * que todo motor crea sin incrustar nada — ver `standardFontFor`). Conserva
   * posición (matriz completa: escala, rotación y sesgo incluidos), tamaño y
   * color del run original; solo cambia la fuente y el texto. Si la fuente
   * estándar tampoco cubre `newText` (p. ej. CJK), no modifica nada y
   * devuelve `glyph-missing`. `runId` en el resultado es el del objeto NUEVO
   * (el original se elimina del flujo de contenido).
   */
  replaceRunWithStandardFont(doc: DocHandle, pageIndex: number, runId: number, newText: string): ReplaceFontResult;
  /**
   * Redacción real: elimina el objeto de texto del flujo de contenido (no lo tapa).
   * Tras guardar, el texto ya no es extraíble. Devuelve true si eliminó un run.
   */
  deleteRun(doc: DocHandle, pageIndex: number, runId: number): boolean;
  /** Inserta un texto nuevo en la página; devuelve el runId del objeto creado. */
  insertText(doc: DocHandle, pageIndex: number, spec: InsertTextSpec): number;
  /** Inserta una imagen (RGBA) en la página, colocada en el rectángulo dado. */
  insertImage(doc: DocHandle, pageIndex: number, spec: InsertImageSpec): boolean;
  /** Añade un resaltado (rectángulo de color, blend Multiply) sobre la caja dada. */
  highlightRect(doc: DocHandle, pageIndex: number, rect: RectPt, color: [number, number, number]): boolean;
  /**
   * Crea una nota adhesiva (anotación real /Subtype /Text) de 20×20 pt cuya esquina
   * superior-izquierda es (xPt, yPt) — el punto del clic — y `Contents` = text.
   * Devuelve el índice de la anotación entre todas las de la página.
   */
  addNote(doc: DocHandle, pageIndex: number, spec: { xPt: number; yPt: number; text: string }): number;
  /** Anotaciones de subtipo Text de la página. */
  getNotes(doc: DocHandle, pageIndex: number): NoteInfo[];
  /** Elimina la anotación en `index` (entre todas las de la página). */
  removeNote(doc: DocHandle, pageIndex: number, index: number): boolean;
  /** Campos de formulario AcroForm de la página (fase 1: se listan todos, solo texto/casilla son editables). */
  listFormFields(doc: DocHandle, pageIndex: number): FormField[];
  /** Escribe el valor de un campo de texto y regenera su apariencia. Solo actúa sobre `kind === 'text'` no readOnly. */
  setFormText(doc: DocHandle, pageIndex: number, annotIndex: number, value: string): boolean;
  /** Marca/desmarca una casilla y regenera su apariencia. Solo actúa sobre `kind === 'checkbox'` no readOnly. */
  setFormChecked(doc: DocHandle, pageIndex: number, annotIndex: number, checked: boolean): boolean;
  /** Dibuja un rectángulo relleno opaco (blend normal) sobre la caja dada. Base de subrayado/tachado. */
  fillRect(doc: DocHandle, pageIndex: number, rect: RectPt, color: [number, number, number]): boolean;
  /** Dibuja un trazo a mano alzada (polilínea) con el color y grosor dados. */
  drawStroke(doc: DocHandle, pageIndex: number, points: { xPt: number; yPt: number }[], color: [number, number, number], widthPt: number): boolean;
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
  /** Inserta todas las páginas de otro PDF (`srcBytes`) en la posición `atIndex`. */
  importPages(doc: DocHandle, srcBytes: Uint8Array, atIndex: number): boolean;
  /** Crea un PDF nuevo con las páginas indicadas (por índice) y devuelve sus bytes. */
  extractPages(doc: DocHandle, pageIndices: number[]): Uint8Array<ArrayBuffer>;
  /** Crea un PDF de una página que contiene la imagen (RGBA) a tamaño completo. */
  imageToPdf(rgba: Uint8Array, imgWidth: number, imgHeight: number): Uint8Array<ArrayBuffer>;
  /** Duplica una página, insertando la copia justo después. */
  duplicatePage(doc: DocHandle, pageIndex: number): boolean;
  save(doc: DocHandle): Uint8Array<ArrayBuffer>;
  close(doc: DocHandle): void;
}
