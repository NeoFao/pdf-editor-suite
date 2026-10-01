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
  | { ok: false; reason: 'glyph-missing' | 'not-a-text-run' | 'invalid-font' };

/**
 * Resultado de `setRunFontSize`. Igual que `ReplaceFontResult`, `runId` en el
 * caso `ok` es el del objeto NUEVO: el motor recrea el objeto de texto para
 * cambiar el tamaño (ver `PdfiumEngine.setRunFontSize`), así que el original
 * se elimina y el runId cambia.
 */
export type SetSizeResult =
  | { ok: true; runId: number }
  | { ok: false; reason: 'not-a-text-run' | 'invalid-size' };

/** Nota adhesiva (anotación PDF real de subtipo Text). `index` es su índice entre TODAS las anotaciones de la página. */
export interface NoteInfo { index: number; text: string; rectPt: RectPt }

/** Tipo de campo AcroForm (FPDF_FORMFIELD_*). Fase 1 solo edita 'text' y 'checkbox'. */
export type FormFieldKind = 'text' | 'checkbox' | 'radio' | 'combo' | 'list' | 'button' | 'signature' | 'unknown';

/**
 * Opción de un campo de elección (combo/lista), con su selección actual.
 * `value` coincide con `label`: PDFium solo expone el texto visible de cada
 * opción (`FPDFAnnot_GetOptionLabel`); a diferencia de una casilla o un radio
 * (`FPDFAnnot_GetFormFieldExportValue`), no hay getter de valor de exportación
 * distinto por índice de opción. Si el PDF define pares [exportValue, label]
 * distintos, este motor no los distingue — se usa el label para ambos.
 */
export interface FormFieldOption {
  label: string;
  value: string;
  selected: boolean;
}

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
  /** Opciones de un combo/lista, con su selección actual. Vacío en el resto de tipos. */
  options: FormFieldOption[];
  /**
   * Solo en lista (`kind === 'list'`): si admite más de una opción marcada a
   * la vez (`/Ff` bit 22, `0x200000`). Siempre `false` en el resto de tipos —
   * un combo, por estructura, nunca admite selección múltiple. La UI la usa
   * para decidir si el `<select>` lleva el atributo `multiple`.
   */
  multiSelect: boolean;
  /**
   * Solo en radio: el valor de exportación de ESTE widget concreto. Un grupo
   * de radio son varios widgets (uno por `annotIndex`) que comparten `name`;
   * `value` es el del CAMPO (compartido por todo el grupo, `/V`), mientras que
   * `exportValue` distingue a cuál de los widgets corresponde este `annotIndex`.
   */
  exportValue?: string;
}

/** Bitmap RGBA listo para volcar en un canvas. */
export interface RenderResult { width: number; height: number; data: Uint8ClampedArray }

/** Píxeles RGBA de un objeto imagen, a su resolución NATIVA (no la de render en pantalla). */
export interface ImagePixels { rgba: Uint8Array; width: number; height: number }

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

/**
 * Nodo del árbol de marcadores (outline) de Acrobat. `pageIndex` es `null`
 * cuando el marcador no tiene destino resoluble (sin `/Dest` ni acción GoTo
 * con destino, o un destino que no apunta a ninguna página del documento).
 */
export interface OutlineItem {
  title: string;
  pageIndex: number | null;
  children: OutlineItem[];
}

/** Puntero opaco al documento dentro del motor. */
export type DocHandle = number;

/**
 * Una operación de dibujo/texto sobre una página, para `applyPageOps` (E-037).
 * Cada variante corresponde 1:1 a los argumentos de su método unitario
 * homónimo (`insertText`, `fillRect`, `highlightRect`, `drawStroke`,
 * `drawRect`): `applyPageOps` es la única implementación real de cada una,
 * y esos métodos delegan en ella con un solo op en el array.
 */
export type PageOp =
  | { type: 'insertText'; spec: InsertTextSpec }
  | { type: 'fillRect'; rect: RectPt; color: [number, number, number] }
  | { type: 'highlightRect'; rect: RectPt; color: [number, number, number] }
  | { type: 'drawStroke'; points: { xPt: number; yPt: number }[]; color: [number, number, number]; widthPt: number }
  | { type: 'drawRect'; rect: RectPt; color: [number, number, number]; widthPt: number };

/** Resultado de un `PageOp`, en el mismo orden que se pasó a `applyPageOps`. */
export type PageOpResult =
  | { type: 'insertText'; runId: number }
  | { type: 'fillRect'; ok: boolean }
  | { type: 'highlightRect'; ok: boolean }
  | { type: 'drawStroke'; ok: boolean }
  | { type: 'drawRect'; ok: boolean };

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
   * Árbol de marcadores (outline) del documento, en el orden en que Acrobat
   * lo muestra. `[]` si el documento no tiene marcadores. Fase 1: solo
   * lectura y navegación, sin editar. Protegido contra outlines hostiles
   * (ciclos, profundidad o cantidad de nodos excesivas) — ver la
   * implementación del motor.
   */
  getOutline(doc: DocHandle): OutlineItem[];
  /**
   * Reescribe el árbol de marcadores completo (reemplaza el anterior). Lanza
   * `RangeError` —sin tocar el documento— si el árbol supera las cotas de
   * E-031 (`OUTLINE_MAX_DEPTH`, `OUTLINE_MAX_NODES`). `pageIndex` nulo o fuera
   * de rango se escribe sin destino.
   */
  setOutline(doc: DocHandle, items: OutlineItem[]): void;
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
   * Cambia el tamaño de fuente de un run, conservando la MISMA fuente
   * incrustada del run original (no la sustituye por una estándar). Recrea
   * el objeto de texto porque PDFium no expone un setter de tamaño en sitio;
   * conserva texto, color, matriz de posición (solo cambia el tamaño en la
   * matriz de fuente) y modo de render. `runId` en el resultado `ok` es el
   * del objeto NUEVO. Rango válido de `sizePt`: 1 a 400; fuera de rango
   * devuelve `invalid-size` sin modificar nada.
   */
  setRunFontSize(doc: DocHandle, pageIndex: number, runId: number, sizePt: number): SetSizeResult;
  /**
   * Cambia la fuente de un run a una de las 14 fuentes estándar PDF elegida
   * por el usuario (`standardFontName` debe ser uno de `STANDARD_FONTS`, ver
   * `standardFontFor.ts`; cualquier otro valor devuelve `invalid-font` sin
   * modificar nada). A diferencia de `replaceRunWithStandardFont` (que
   * sustituye also el TEXTO porque viene de una edición con glifo faltante),
   * este método conserva el texto ACTUAL del run y solo cambia la fuente.
   * Igual que `replaceRunWithStandardFont`, si la fuente elegida no cubre
   * algún carácter del texto actual, no modifica nada y devuelve
   * `glyph-missing`. `runId` en el resultado `ok` es el del objeto NUEVO.
   */
  setRunFont(doc: DocHandle, pageIndex: number, runId: number, standardFontName: string): ReplaceFontResult;
  /**
   * Redacción real: elimina el objeto de texto del flujo de contenido (no lo tapa).
   * Tras guardar, el texto ya no es extraíble. Devuelve true si eliminó un run.
   */
  deleteRun(doc: DocHandle, pageIndex: number, runId: number): boolean;
  /** Inserta un texto nuevo en la página; devuelve el runId del objeto creado. */
  insertText(doc: DocHandle, pageIndex: number, spec: InsertTextSpec): number;
  /** Inserta una imagen (RGBA) en la página, colocada en el rectángulo dado. */
  insertImage(doc: DocHandle, pageIndex: number, spec: InsertImageSpec): boolean;
  /**
   * Objetos de página de tipo imagen (`FPDF_PAGEOBJ_IMAGE`), con su caja
   * actual en puntos PDF (`FPDFPageObj_GetBounds`). Base del marco
   * interactivo del sello/firma insertados (#20/#21 de la tabla de
   * paridad): seleccionar, mover y redimensionar una imagen ya colocada.
   */
  listImageObjects(doc: DocHandle, pageIndex: number): { objIndex: number; rectPt: RectPt }[];
  /**
   * Coloca el objeto IMAGEN en `objIndex` exactamente en `rectPt`: fija su
   * matriz a `[wPt 0 0 hPt xPt yPt]`, que mapea el cuadrado unidad en el que
   * se define toda imagen (ver `insertImage`) al rectángulo dado. Fase 1:
   * solo imágenes sin rotación/sesgo — si la matriz actual del objeto tiene
   * b≠0 o c≠0, no la toca y devuelve `false` (para conservar esa rotación
   * habría que componerla en la matriz nueva en vez de sustituirla, fuera de
   * alcance de esta fase). `false` también si `objIndex` no es una imagen.
   */
  setObjectRect(doc: DocHandle, pageIndex: number, objIndex: number, rectPt: RectPt): boolean;
  /**
   * Píxeles RGBA del objeto IMAGEN en `objIndex`, a su resolución NATIVA
   * (`FPDFImageObj_GetBitmap` + `FPDFBitmap_GetFormat`, no el tamaño con que
   * se ve en la página). Base de los filtros de imagen (#25 de la tabla de
   * paridad, §9) y de la compresión (#29): a diferencia de la app vieja, que
   * rasteriza la PÁGINA entera, esto opera solo sobre el bitmap del objeto —
   * el texto y los vectores de la página no se tocan. Convierte desde el
   * formato que devuelva PDFium (BGRA, BGR, BGRx o Gray) a RGBA — BGR (3
   * bytes/píxel, sin alfa) es el más común de los cuatro: PDFium lo usa para
   * CUALQUIER imagen totalmente opaca (alfa 255 en todos los píxeles) tras
   * pasar por `FPDFImageObj_SetBitmap`, no solo BGRA/BGRx/Gray como podría
   * asumirse. `null` si `objIndex` no es una imagen, o si el bitmap viene en
   * un formato que ninguno de esos cuatro cubre (no debería darse con los
   * documentos que produce este motor; sí podría darse con un PDF externo
   * con un espacio de color exótico, p. ej. CMYK indexado).
   */
  getImagePixels(doc: DocHandle, pageIndex: number, objIndex: number): ImagePixels | null;
  /**
   * Sustituye los píxeles del objeto IMAGEN en `objIndex` por `rgba`
   * (`width`×`height`, puede tener una resolución distinta a la anterior),
   * conservando la MATRIZ actual del objeto — es decir, su posición y tamaño
   * en la página no cambian, solo el contenido del bitmap
   * (`FPDFImageObj_SetBitmap`). `false` si `objIndex` no es una imagen.
   */
  replaceImagePixels(doc: DocHandle, pageIndex: number, objIndex: number, rgba: Uint8Array, width: number, height: number): boolean;
  /**
   * Sustituye el objeto IMAGEN en `objIndex` por un JPEG YA CODIFICADO
   * (`jpegBytes`), conservando la MATRIZ actual (posición/tamaño en la
   * página) — `FPDFImageObj_LoadJpegFileInline`, que guarda el JPEG tal cual
   * como stream `DCTDecode` en vez de decodificar y recomprimir. Base de
   * `ComprimirDocumentoCmd`: la codificación JPEG en sí ocurre en el
   * navegador (canvas), este método solo la incrusta. `false` si `objIndex`
   * no es una imagen o si PDFium rechaza el JPEG (datos corruptos).
   */
  replaceImageJpeg(doc: DocHandle, pageIndex: number, objIndex: number, jpegBytes: Uint8Array): boolean;
  /**
   * Tamaño en bytes del stream de imagen TAL COMO está codificado hoy en el
   * PDF (`FPDFImageObj_GetImageDataRaw`, solo para consultar el tamaño). Lo
   * usa `ComprimirDocumentoCmd` para no sustituir una imagen por un JPEG que
   * saldría MÁS pesado que lo que ya había. `null` si `objIndex` no es una
   * imagen.
   */
  getImageRawSize(doc: DocHandle, pageIndex: number, objIndex: number): number | null;
  /**
   * Elimina el objeto de página en `objIndex` (de cualquier tipo:
   * `FPDFPage_RemoveObject` + `FPDFPageObj_Destroy`). Reindexa los objetos
   * posteriores, igual que `deleteRun`. `false` si el índice no existe.
   */
  deleteObject(doc: DocHandle, pageIndex: number, objIndex: number): boolean;
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
  /** Campos de formulario AcroForm de la página (todos los tipos son editables desde fase 2, salvo botón/firma). */
  listFormFields(doc: DocHandle, pageIndex: number): FormField[];
  /** Escribe el valor de un campo de texto y regenera su apariencia. Solo actúa sobre `kind === 'text'` no readOnly. */
  setFormText(doc: DocHandle, pageIndex: number, annotIndex: number, value: string): boolean;
  /** Marca/desmarca una casilla y regenera su apariencia. Solo actúa sobre `kind === 'checkbox'` no readOnly. */
  setFormChecked(doc: DocHandle, pageIndex: number, annotIndex: number, checked: boolean): boolean;
  /**
   * Fija la selección de un combo o una lista. `values` son las etiquetas
   * (`FormFieldOption.label`) a seleccionar. Un combo, o una lista sin el bit
   * MultiSelect (`/Ff` bit 22, `0x200000`), solo admite 0 o 1 valores —con más
   * de uno devuelve `false` sin modificar nada. Solo actúa sobre `kind ===
   * 'combo' | 'list'` no readOnly. Regenera la apariencia del widget.
   */
  setFormChoice(doc: DocHandle, pageIndex: number, annotIndex: number, values: string[]): boolean;
  /**
   * Marca el widget de radio en `annotIndex` y desmarca el resto de widgets de
   * su mismo grupo (mismo `name`): el valor del campo (`/V`, compartido por
   * todo el grupo) pasa a ser el `exportValue` de este widget. Solo actúa
   * sobre `kind === 'radio'` no readOnly. Regenera la apariencia del widget.
   */
  setFormRadio(doc: DocHandle, pageIndex: number, annotIndex: number): boolean;
  /**
   * Deja el grupo de radio al que pertenece el widget en `annotIndex` sin
   * ningún widget marcado (`/V` = 'Off'). `annotIndex` puede ser cualquier
   * widget del grupo, esté o no marcado: el valor es del campo, no del widget.
   */
  clearFormRadio(doc: DocHandle, pageIndex: number, annotIndex: number): boolean;
  /** Dibuja un rectángulo relleno opaco (blend normal) sobre la caja dada. Base de subrayado/tachado. */
  fillRect(doc: DocHandle, pageIndex: number, rect: RectPt, color: [number, number, number]): boolean;
  /** Dibuja un trazo a mano alzada (polilínea) con el color y grosor dados. */
  drawStroke(doc: DocHandle, pageIndex: number, points: { xPt: number; yPt: number }[], color: [number, number, number], widthPt: number): boolean;
  /**
   * Dibuja un rectángulo (solo borde, sin relleno) con el color y grosor
   * dados — base de la herramienta rectángulo (#16 de la tabla de paridad).
   * Un rectángulo menor de 3×3 pt no se crea (fue un clic, no un arrastre
   * real): devuelve `false` sin modificar nada.
   */
  drawRect(doc: DocHandle, pageIndex: number, rect: RectPt, color: [number, number, number], widthPt: number): boolean;
  /**
   * Objetos de página de tipo PATH (`FPDF_PAGEOBJ_PATH`), con su caja actual
   * (puntos PDF, de `FPDFPageObj_GetBounds`). OJO: un trazo de pluma
   * (`drawStroke`) y un rectángulo (`drawRect`) son PATH, pero un resaltado
   * (`highlightRect`) y un subrayado/tachado (`fillRect`) TAMBIÉN lo son —
   * son rectángulos rellenos sin trazo. `hasStroke` (de
   * `FPDFPath_GetDrawMode`) distingue unos de otros: `true` solo para los
   * paths con el trazo activo (pluma y rectángulo), `false` para los de solo
   * relleno (resaltado/subrayado/tachado). Base de la selección del borrador
   * (#17): ver `deleteObject` y la nota en `getPathSegments`.
   */
  listPathObjects(doc: DocHandle, pageIndex: number): { objIndex: number; rectPt: RectPt; hasStroke: boolean }[];
  /**
   * Segmentos rectos (aristas) del contorno del path en `objIndex`, en puntos
   * PDF, con la matriz del objeto ya aplicada (si la tuviera). Cada segmento
   * une dos vértices consecutivos del contorno; si el contorno está cerrado
   * (un rectángulo), incluye también la arista de cierre. Los segmentos de
   * curva (bezier) se aproximan por su punto final — suficiente aquí porque
   * esta app solo dibuja polilíneas y rectángulos, nunca curvas. Base de la
   * selección por proximidad REAL del borrador (a la arista, no a la caja
   * completa: un clic en el hueco interior de un rectángulo grande no debe
   * encontrar nada).
   */
  getPathSegments(doc: DocHandle, pageIndex: number, objIndex: number): { ax: number; ay: number; bx: number; by: number }[];
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
  /** Crea un PDF nuevo de una página en blanco, del tamaño dado en puntos PDF. */
  createBlank(widthPt: number, heightPt: number): Uint8Array<ArrayBuffer>;
  /** Duplica una página, insertando la copia justo después. */
  duplicatePage(doc: DocHandle, pageIndex: number): boolean;
  /**
   * Aplica varias `PageOp` sobre la MISMA página con una sola carga
   * (`FPDF_LoadPage`), un solo `FPDFPage_GenerateContent()` al terminar todas
   * y un solo `FPDF_ClosePage()` — en vez de ese trío por operación. Cada
   * `GenerateContent()` reserializa TODO el contenido ya insertado en la
   * página, así que N llamadas sueltas cuestan O(N²); esta es la ruta que
   * usan internamente `insertText`/`fillRect`/`highlightRect`/`drawStroke`/
   * `drawRect` cuando se llaman sueltas (con un solo op), y la que debe usar
   * cualquier llamador que vaya a insertar/dibujar VARIAS cosas en la misma
   * página de una vez (E-037: visto con OCR de una página densa y con la
   * conversión Markdown → PDF). Devuelve un resultado por op, en el mismo
   * orden.
   */
  applyPageOps(doc: DocHandle, pageIndex: number, ops: PageOp[]): PageOpResult[];
  save(doc: DocHandle): Uint8Array<ArrayBuffer>;
  /**
   * Igual que `save()`, pero además descarta los streams de contenido de
   * página HUÉRFANOS que deja cada `FPDFPage_GenerateContent()` sobre el
   * MISMO objeto de página: cada llamada crea un stream nuevo y actualiza
   * `/Contents` para apuntar a él, pero el stream anterior sigue vivo en la
   * tabla de objetos del documento en memoria — `save()` lo sigue
   * escribiendo aunque ya nada lo referencie (E-038, mismo mecanismo que ya
   * se documentó para imágenes sustituidas en `ComprimirDocumentoCmd`). NO
   * muta `doc`: guarda, abre una copia efímera desde esos bytes —al
   * analizarlos, el motor solo reconstruye los objetos alcanzables desde la
   * página, así que los huérfanos se quedan fuera— y vuelve a guardar esa
   * copia. Coste añadido, medido: unas décimas de milisegundo sobre un
   * documento ya editado. Úsalo en cualquier guardado DE CARA AL USUARIO
   * (botón Guardar/descargar, imprimir, informe de Comprimir); los
   * snapshots internos de deshacer siguen usando `save()` a secas —
   * priorizan velocidad y se descartan enseguida, así que arrastrar
   * huérfanos ahí no se acumula de por vida como si se guardaran en disco.
   */
  saveCompact(doc: DocHandle): Promise<Uint8Array<ArrayBuffer>>;
  close(doc: DocHandle): void;
  /**
   * Ancho en puntos PDF de `text` si se pintara con la fuente estándar
   * `fontName` (una de las 14 de `STANDARD_FONTS`) al tamaño `sizePt`. No
   * necesita un documento abierto por el llamante: el motor gestiona su
   * propia fuente interna, cacheada por nombre. Base del ajuste de línea del
   * maquetador Markdown → PDF (§9 fila #32): mide el ancho real de cada
   * palabra antes de decidir dónde cortar la línea, en vez de aproximar por
   * número de caracteres.
   */
  measureText(fontName: string, sizePt: number, text: string): number;
}
