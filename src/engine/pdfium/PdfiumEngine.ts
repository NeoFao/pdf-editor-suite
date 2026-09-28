import { loadEngine, type Pdfium } from './loadEngine';
import { makeMem, leerCadenaPdfium, type Mem } from './mem';
import type { PdfEngine, DocHandle, SizePt, TextRun, EditResult, RenderResult, InsertTextSpec, InsertImageSpec, RectPt, NoteInfo, FormField, FormFieldKind } from '../PdfEngine';

const FPDF_PAGEOBJ_TEXT = 1;
const FPDF_ANNOT_TEXT = 1;    // FPDF_ANNOTATION_SUBTYPE: nota adhesiva ("sticky note")
const FPDF_ANNOT_FLAG = 0x01; // flag de FPDF_RenderPageBitmap: pinta también las anotaciones
const FPDFANNOT_COLORTYPE_Color = 0;

// FPDF_FORMFIELD_* (fpdf_formfill.h): tipo devuelto por FPDFAnnot_GetFormFieldType.
// -1 (o cualquier valor fuera de esta tabla) significa "no es un campo de formulario".
const FPDF_FORMFIELD_KIND: Record<number, FormFieldKind> = {
  0: 'unknown',
  1: 'button',
  2: 'checkbox',
  3: 'radio',
  4: 'combo',
  5: 'list',
  6: 'text',
  7: 'signature'
};
const FPDF_FORMFLAG_READONLY = 0x01; // bit 1 de /Ff (PDF 32000-1, tabla 221).

/**
 * Implementación de PdfEngine sobre @embedpdf/pdfium (WASM).
 * FPDF_LoadMemDocument exige que el buffer de datos siga vivo mientras el
 * documento esté abierto: se guarda su puntero por documento y se libera al cerrar.
 */
export class PdfiumEngine implements PdfEngine {
  private readonly srcPtr = new Map<DocHandle, number>();
  // Entorno de formularios (AcroForm), uno por documento. `info` es el struct
  // FPDF_FORMFILLINFO reservado por PDFiumExt_OpenFormFillInfo; `form` es el
  // FPDF_FORMHANDLE que exigen todas las FPDFAnnot_GetFormField*/EPDFAnnot_*
  // relacionadas con campos. 0 si el motor de este build no trae el extra o
  // si la inicialización falló: entonces listFormFields devuelve siempre [].
  private readonly formEnv = new Map<DocHandle, { info: number; form: number }>();

  private constructor(private readonly p: Pdfium, private readonly mem: Mem) {}

  static async create(): Promise<PdfiumEngine> {
    const p = await loadEngine();
    return new PdfiumEngine(p, makeMem(p));
  }

  async open(bytes: Uint8Array): Promise<DocHandle> {
    const ptr = this.mem.copyIn(bytes);
    const doc = this.p.FPDF_LoadMemDocument(ptr, bytes.length, '') as DocHandle;
    if (!doc) { this.mem.free(ptr); throw new Error('PDF no válido o cifrado no soportado'); }
    this.srcPtr.set(doc, ptr);
    const info = this.p.PDFiumExt_OpenFormFillInfo();
    const form = info ? this.p.PDFiumExt_InitFormFillEnvironment(doc, info) : 0;
    this.formEnv.set(doc, { info, form: form || 0 });
    return doc;
  }

  /** FPDF_FORMHANDLE del documento, o 0 si no hay entorno de formularios disponible. */
  private formHandle(doc: DocHandle): number {
    return this.formEnv.get(doc)?.form ?? 0;
  }

  /**
   * Carga la página emparejándola con el entorno de formularios (FORM_OnAfterLoadPage)
   * cuando existe, y la cierra en el orden inverso correcto (§2.6: cierra lo que abres).
   */
  private withFormPage<T>(doc: DocHandle, pageIndex: number, fn: (page: number, form: number) => T): T {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const form = this.formHandle(doc);
    if (form) this.p.FORM_OnAfterLoadPage(page, form);
    try {
      return fn(page, form);
    } finally {
      if (form) this.p.FORM_OnBeforeClosePage(page, form);
      this.p.FPDF_ClosePage(page);
    }
  }

  pageCount(doc: DocHandle): number {
    return this.p.FPDF_GetPageCount(doc);
  }

  pageSize(doc: DocHandle, pageIndex: number): SizePt {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      return { widthPt: this.p.FPDF_GetPageWidthF(page), heightPt: this.p.FPDF_GetPageHeightF(page) };
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  rotatePage(doc: DocHandle, pageIndex: number, deltaDeg: number): 0 | 90 | 180 | 270 {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const cur = this.p.FPDFPage_GetRotation(page); // 0..3
      const next = (((cur + Math.round(deltaDeg / 90)) % 4) + 4) % 4;
      this.p.FPDFPage_SetRotation(page, next);
      return (next * 90) as 0 | 90 | 180 | 270;
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  deletePage(doc: DocHandle, pageIndex: number): void {
    this.p.FPDFPage_Delete(doc, pageIndex);
  }

  importPages(doc: DocHandle, srcBytes: Uint8Array, atIndex: number): boolean {
    const srcPtr = this.mem.copyIn(srcBytes);
    const srcDoc = this.p.FPDF_LoadMemDocument(srcPtr, srcBytes.length, '');
    if (!srcDoc) { this.mem.free(srcPtr); throw new Error('El PDF a insertar no es válido'); }
    try {
      const n = this.p.FPDF_GetPageCount(srcDoc);
      return this.p.FPDF_ImportPages(doc, srcDoc, `1-${n}`, atIndex);
    } finally {
      // Las páginas se copian a fondo en el destino; el origen puede cerrarse ya.
      this.p.FPDF_CloseDocument(srcDoc);
      this.mem.free(srcPtr);
    }
  }

  duplicatePage(doc: DocHandle, pageIndex: number): boolean {
    const arr = this.mem.malloc(4);
    this.mem.setValue(arr, pageIndex, 'i32');
    try {
      // Importa la misma página (del propio doc) justo después de ella.
      return this.p.FPDF_ImportPagesByIndex(doc, doc, arr, 1, pageIndex + 1);
    } finally {
      this.mem.free(arr);
    }
  }

  imageToPdf(rgba: Uint8Array, imgWidth: number, imgHeight: number): Uint8Array<ArrayBuffer> {
    // Página del tamaño de la imagen (1 px = 1 pt), con la imagen a página completa.
    const doc = this.p.FPDF_CreateNewDocument();
    try {
      const page = this.p.FPDFPage_New(doc, 0, imgWidth, imgHeight);
      this.p.FPDF_ClosePage(page);
      this.insertImage(doc, 0, { rgba, imgWidth, imgHeight, xPt: 0, yPt: 0, wPt: imgWidth, hPt: imgHeight });
      return this.save(doc);
    } finally {
      this.p.FPDF_CloseDocument(doc);
    }
  }

  extractPages(doc: DocHandle, pageIndices: number[]): Uint8Array<ArrayBuffer> {
    const dest = this.p.FPDF_CreateNewDocument();
    try {
      const range = pageIndices.map((i) => i + 1).join(','); // 1-based, "1,3,5"
      this.p.FPDF_ImportPages(dest, doc, range, 0);
      return this.save(dest);
    } finally {
      this.p.FPDF_CloseDocument(dest);
    }
  }

  movePage(doc: DocHandle, fromIndex: number, toIndex: number): boolean {
    const arr = this.mem.malloc(4);
    this.mem.setValue(arr, fromIndex, 'i32');
    try {
      return this.p.FPDF_MovePages(doc, arr, 1, toIndex);
    } finally {
      this.mem.free(arr);
    }
  }

  pageRotation(doc: DocHandle, pageIndex: number): 0 | 90 | 180 | 270 {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const grados = (this.p.FPDFPage_GetRotation(page) * 90) % 360;
      return grados as 0 | 90 | 180 | 270;
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  renderPage(doc: DocHandle, pageIndex: number, scale: number): RenderResult {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const width = Math.max(1, Math.round(this.p.FPDF_GetPageWidthF(page) * scale));
    const height = Math.max(1, Math.round(this.p.FPDF_GetPageHeightF(page) * scale));
    // Bitmap BGRA, fondo blanco; el /Rotate de la página lo aplica PDFium con rotate=0.
    const bmp = this.p.FPDFBitmap_Create(width, height, 0);
    try {
      this.p.FPDFBitmap_FillRect(bmp, 0, 0, width, height, 0xffffffff);
      // Flag FPDF_ANNOT: pinta también las anotaciones (p. ej. el icono de las notas).
      this.p.FPDF_RenderPageBitmap(bmp, page, 0, 0, width, height, 0, FPDF_ANNOT_FLAG);
      const stride = this.p.FPDFBitmap_GetStride(bmp);
      const buf = this.p.FPDFBitmap_GetBuffer(bmp);
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        const row = buf + y * stride;
        for (let x = 0; x < width; x++) {
          const src = row + x * 4;      // BGRA
          const dst = (y * width + x) * 4;
          rgba[dst] = this.mem.HEAPU8[src + 2]!;     // R ← B
          rgba[dst + 1] = this.mem.HEAPU8[src + 1]!; // G
          rgba[dst + 2] = this.mem.HEAPU8[src]!;     // B ← R
          rgba[dst + 3] = this.mem.HEAPU8[src + 3]!; // A
        }
      }
      return { width, height, data: rgba };
    } finally {
      this.p.FPDFBitmap_Destroy(bmp);
      this.p.FPDF_ClosePage(page);
    }
  }

  findText(doc: DocHandle, pageIndex: number, query: string): RectPt[] {
    if (!query) return [];
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const textPage = this.p.FPDFText_LoadPage(page);
    const wq = this.mem.wide(query);
    const sh = this.p.FPDFText_FindStart(textPage, wq, 0, 0); // flags 0 = insensible a mayúsculas
    const matches: RectPt[] = [];
    try {
      while (this.p.FPDFText_FindNext(sh)) {
        const start = this.p.FPDFText_GetSchResultIndex(sh);
        const count = this.p.FPDFText_GetSchCount(sh);
        let minL = Infinity, minB = Infinity, maxR = -Infinity, maxT = -Infinity;
        for (let k = 0; k < count; k++) {
          const l = this.mem.malloc(8), r = this.mem.malloc(8), b = this.mem.malloc(8), t = this.mem.malloc(8);
          this.p.FPDFText_GetCharBox(textPage, start + k, l, r, b, t); // left, right, bottom, top (doubles)
          const L = this.mem.getValue(l, 'double'), R = this.mem.getValue(r, 'double');
          const B = this.mem.getValue(b, 'double'), T = this.mem.getValue(t, 'double');
          [l, r, b, t].forEach((ptr) => this.mem.free(ptr));
          if (R <= L || T <= B) continue; // char sin caja (espacios)
          minL = Math.min(minL, L); maxR = Math.max(maxR, R);
          minB = Math.min(minB, B); maxT = Math.max(maxT, T);
        }
        if (Number.isFinite(minL)) matches.push({ xPt: minL, yPt: minB, wPt: maxR - minL, hPt: maxT - minB });
      }
    } finally {
      this.p.FPDFText_FindClose(sh);
      this.mem.free(wq);
      this.p.FPDFText_ClosePage(textPage);
      this.p.FPDF_ClosePage(page);
    }
    return matches;
  }

  getPageText(doc: DocHandle, pageIndex: number): TextRun[] {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const textPage = this.p.FPDFText_LoadPage(page);
    const runs: TextRun[] = [];
    try {
      const n = this.p.FPDFPage_CountObjects(page);
      for (let i = 0; i < n; i++) {
        const obj = this.p.FPDFPage_GetObject(page, i);
        if (this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) continue;
        runs.push(this.readTextRun(obj, textPage, i));
      }
    } finally {
      this.p.FPDFText_ClosePage(textPage);
      this.p.FPDF_ClosePage(page);
    }
    return runs;
  }

  /** Lee las propiedades de un objeto de texto (obj) usando la text page para el string. */
  private readTextRun(obj: number, textPage: number, runId: number): TextRun {
    const m = this.mem;
    // Texto (UTF-16). Patrón de dos llamadas: ver leerCadenaPdfium (E-028).
    const text = leerCadenaPdfium(
      m,
      (buf, len) => this.p.FPDFTextObj_GetText(obj, textPage, buf, len),
      (ptr) => m.readU16(ptr)
    );
    // Tamaño de fuente (out float)
    const fs = m.malloc(4); this.p.FPDFTextObj_GetFontSize(obj, fs);
    const sizePt = m.getValue(fs, 'float'); m.free(fs);
    // Nombre de fuente (bytes UTF-8/Latin-1, no UTF-16).
    const font = this.p.FPDFTextObj_GetFont(obj);
    const fontName = leerCadenaPdfium(
      m,
      (buf, len) => this.p.FPDFFont_GetBaseFontName(font, buf, len),
      (ptr) => m.UTF8ToString(ptr)
    );
    // Color de relleno (RGBA, out uints)
    const r = m.malloc(4), g = m.malloc(4), b = m.malloc(4), a = m.malloc(4);
    this.p.FPDFPageObj_GetFillColor(obj, r, g, b, a);
    const color: [number, number, number, number] = [m.getValue(r, 'i32'), m.getValue(g, 'i32'), m.getValue(b, 'i32'), m.getValue(a, 'i32')];
    [r, g, b, a].forEach((ptr) => m.free(ptr));
    // Caja (left, bottom, right, top)
    const l = m.malloc(4), bo = m.malloc(4), ri = m.malloc(4), to = m.malloc(4);
    this.p.FPDFPageObj_GetBounds(obj, l, bo, ri, to);
    const left = m.getValue(l, 'float'), bottom = m.getValue(bo, 'float'), right = m.getValue(ri, 'float'), top = m.getValue(to, 'float');
    [l, bo, ri, to].forEach((ptr) => m.free(ptr));
    // Matriz del objeto (FS_MATRIX: a,b,c,d,e,f — 6 floats de 4 bytes, contiguos).
    // (e, f) es el origen de la línea base en puntos PDF (E-030). Se asume texto
    // horizontal: si hay rotación/sesgo (b≠0 o c≠0) igual se usa (e, f) tal cual;
    // la alineación de edición no corrige esos casos.
    const mat = m.malloc(24);
    this.p.FPDFPageObj_GetMatrix(obj, mat);
    const originPt = { xPt: m.getValue(mat + 16, 'float'), yPt: m.getValue(mat + 20, 'float') };
    m.free(mat);
    return { runId, text, sizePt, fontName, color, boxPt: { xPt: left, yPt: bottom, wPt: right - left, hPt: top - bottom }, originPt };
  }

  editTextRun(doc: DocHandle, pageIndex: number, runId: number, newText: string): EditResult {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const obj = this.p.FPDFPage_GetObject(page, runId);
      if (!obj || this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) {
        return { ok: false, reason: 'not-a-text-run' };
      }
      // La fuente del propio run: garantiza que el texto nuevo se dibuja con ella.
      const font = this.p.FPDFTextObj_GetFont(obj);
      const fs = this.mem.malloc(4); this.p.FPDFTextObj_GetFontSize(obj, fs);
      const size = this.mem.getValue(fs, 'float'); this.mem.free(fs);
      // Si la fuente no tiene el glifo de algún carácter (no blanco), no editamos.
      for (const ch of newText) {
        if (/\s/.test(ch)) continue;
        const cp = ch.codePointAt(0)!;
        if (this.p.FPDFFont_GetGlyphPath(font, cp, size) === 0) {
          return { ok: false, reason: 'glyph-missing' };
        }
      }
      // Edición EN SITIO: mismo objeto → conserva fuente, tamaño, color y matriz.
      const wptr = this.mem.wide(newText);
      this.p.FPDFText_SetText(obj, wptr);
      this.mem.free(wptr);
      this.p.FPDFPage_GenerateContent(page);
      return { ok: true };
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  moveRun(doc: DocHandle, pageIndex: number, runId: number, dxPt: number, dyPt: number): boolean {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const obj = this.p.FPDFPage_GetObject(page, runId);
      if (!obj || this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) return false;
      this.p.FPDFPageObj_Transform(obj, 1, 0, 0, 1, dxPt, dyPt); // traslación pura
      this.p.FPDFPage_GenerateContent(page);
      return true;
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  setRunColor(doc: DocHandle, pageIndex: number, runId: number, color: [number, number, number]): boolean {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const obj = this.p.FPDFPage_GetObject(page, runId);
      if (!obj || this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) return false;
      const [r, g, b] = color;
      this.p.FPDFPageObj_SetFillColor(obj, r, g, b, 255);
      this.p.FPDFPage_GenerateContent(page);
      return true;
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  deleteRun(doc: DocHandle, pageIndex: number, runId: number): boolean {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const obj = this.p.FPDFPage_GetObject(page, runId);
      if (!obj || this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) return false;
      // RemoveObject transfiere la propiedad al llamante: hay que destruirlo.
      if (!this.p.FPDFPage_RemoveObject(page, obj)) return false;
      this.p.FPDFPageObj_Destroy(obj);
      this.p.FPDFPage_GenerateContent(page);
      return true;
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  insertText(doc: DocHandle, pageIndex: number, spec: InsertTextSpec): number {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const obj = this.p.FPDFPageObj_NewTextObj(doc, spec.fontName ?? 'Helvetica', spec.sizePt);
      const wptr = this.mem.wide(spec.text);
      this.p.FPDFText_SetText(obj, wptr);
      this.mem.free(wptr);
      const [r, g, b] = spec.color ?? [0, 0, 0];
      this.p.FPDFPageObj_SetFillColor(obj, r, g, b, 255);
      // Matriz identidad + traslación a (x, y) en puntos PDF.
      this.p.FPDFPageObj_Transform(obj, 1, 0, 0, 1, spec.xPt, spec.yPt);
      if (spec.invisible) {
        // Modo de render 3 = invisible: el texto queda extraíble/buscable pero no se pinta. Para capas de OCR.
        this.p.FPDFTextObj_SetTextRenderMode(obj, 3);
      }
      this.p.FPDFPage_InsertObject(page, obj);
      this.p.FPDFPage_GenerateContent(page);
      return this.p.FPDFPage_CountObjects(page) - 1; // el objeto insertado es el último
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  insertImage(doc: DocHandle, pageIndex: number, spec: InsertImageSpec): boolean {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    // FPDFBitmap_Create: formato BGRA con alfa (3 = BGRA). El motor copia los
    // píxeles al generar el contenido, así que el bitmap puede destruirse luego.
    const bmp = this.p.FPDFBitmap_Create(spec.imgWidth, spec.imgHeight, 1);
    try {
      const stride = this.p.FPDFBitmap_GetStride(bmp);
      const buf = this.p.FPDFBitmap_GetBuffer(bmp);
      const heap = this.mem.HEAPU8;
      for (let y = 0; y < spec.imgHeight; y++) {
        for (let x = 0; x < spec.imgWidth; x++) {
          const s = (y * spec.imgWidth + x) * 4;
          const d = buf + y * stride + x * 4;
          heap[d] = spec.rgba[s + 2]!;     // B
          heap[d + 1] = spec.rgba[s + 1]!; // G
          heap[d + 2] = spec.rgba[s]!;     // R
          heap[d + 3] = spec.rgba[s + 3]!; // A
        }
      }
      const obj = this.p.FPDFPageObj_NewImageObj(doc);
      this.p.FPDFImageObj_SetBitmap(0, 0, obj, bmp);
      // La imagen se define en un cuadrado unidad: la matriz la escala y sitúa.
      this.p.FPDFPageObj_Transform(obj, spec.wPt, 0, 0, spec.hPt, spec.xPt, spec.yPt);
      this.p.FPDFPage_InsertObject(page, obj);
      this.p.FPDFPage_GenerateContent(page);
      return true;
    } finally {
      this.p.FPDFBitmap_Destroy(bmp);
      this.p.FPDF_ClosePage(page);
    }
  }

  highlightRect(doc: DocHandle, pageIndex: number, rect: RectPt, color: [number, number, number]): boolean {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const obj = this.p.FPDFPageObj_CreateNewRect(rect.xPt, rect.yPt, rect.wPt, rect.hPt);
      this.p.FPDFPath_SetDrawMode(obj, 2, false); // 2 = relleno por winding, sin trazo
      const [r, g, b] = color;
      this.p.FPDFPageObj_SetFillColor(obj, r, g, b, 255);
      // Multiply: amarillo * blanco = amarillo; el texto negro sigue negro (marcador real).
      this.p.FPDFPageObj_SetBlendMode(obj, 'Multiply');
      this.p.FPDFPage_InsertObject(page, obj);
      this.p.FPDFPage_GenerateContent(page);
      return true;
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  addNote(doc: DocHandle, pageIndex: number, spec: { xPt: number; yPt: number; text: string }): number {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const annot = this.p.FPDFPage_CreateAnnot(page, FPDF_ANNOT_TEXT);
      if (!annot) throw new Error('No se pudo crear la anotación de nota');
      try {
        // FS_RECTF = {left, top, right, bottom} en puntos PDF (floats, 16 bytes).
        // El clic marca la esquina superior-izquierda del icono; icono de 20×20 pt.
        const rectPtr = this.mem.malloc(16);
        this.mem.setValue(rectPtr, spec.xPt, 'float');
        this.mem.setValue(rectPtr + 4, spec.yPt, 'float');
        this.mem.setValue(rectPtr + 8, spec.xPt + 20, 'float');
        this.mem.setValue(rectPtr + 12, spec.yPt - 20, 'float');
        this.p.FPDFAnnot_SetRect(annot, rectPtr);
        this.mem.free(rectPtr);

        const wptr = this.mem.wide(spec.text);
        this.p.FPDFAnnot_SetStringValue(annot, 'Contents', wptr);
        this.mem.free(wptr);

        // Amarillo, como el icono de nota de Acrobat.
        this.p.FPDFAnnot_SetColor(annot, FPDFANNOT_COLORTYPE_Color, 255, 220, 0, 255);
      } finally {
        this.p.FPDFPage_CloseAnnot(annot);
      }
      return this.p.FPDFPage_GetAnnotCount(page) - 1; // la anotación creada es la última
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  getNotes(doc: DocHandle, pageIndex: number): NoteInfo[] {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const notes: NoteInfo[] = [];
    try {
      const n = this.p.FPDFPage_GetAnnotCount(page);
      for (let i = 0; i < n; i++) {
        const annot = this.p.FPDFPage_GetAnnot(page, i);
        if (!annot) continue;
        try {
          if (this.p.FPDFAnnot_GetSubtype(annot) !== FPDF_ANNOT_TEXT) continue;
          const rectPtr = this.mem.malloc(16);
          this.p.FPDFAnnot_GetRect(annot, rectPtr);
          const left = this.mem.getValue(rectPtr, 'float');
          const top = this.mem.getValue(rectPtr + 4, 'float');
          const right = this.mem.getValue(rectPtr + 8, 'float');
          const bottom = this.mem.getValue(rectPtr + 12, 'float');
          this.mem.free(rectPtr);

          // Patrón de dos llamadas: ver leerCadenaPdfium (E-028).
          const text = leerCadenaPdfium(
            this.mem,
            (buf, len) => this.p.FPDFAnnot_GetStringValue(annot, 'Contents', buf, len),
            (ptr) => this.mem.readU16(ptr)
          );

          notes.push({ index: i, text, rectPt: { xPt: left, yPt: bottom, wPt: right - left, hPt: top - bottom } });
        } finally {
          this.p.FPDFPage_CloseAnnot(annot);
        }
      }
    } finally {
      this.p.FPDF_ClosePage(page);
    }
    return notes;
  }

  removeNote(doc: DocHandle, pageIndex: number, index: number): boolean {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      return this.p.FPDFPage_RemoveAnnot(page, index);
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  listFormFields(doc: DocHandle, pageIndex: number): FormField[] {
    return this.withFormPage(doc, pageIndex, (page, form) => {
      const fields: FormField[] = [];
      if (!form) return fields; // sin entorno de formularios: ningún campo es legible
      const n = this.p.FPDFPage_GetAnnotCount(page);
      for (let i = 0; i < n; i++) {
        const annot = this.p.FPDFPage_GetAnnot(page, i);
        if (!annot) continue;
        try {
          const field = this.readFormField(form, annot, i);
          if (field) fields.push(field);
        } finally {
          this.p.FPDFPage_CloseAnnot(annot);
        }
      }
      return fields;
    });
  }

  /** Lee un campo de formulario a partir de su anotación (widget). null si `annot` no es un campo. */
  private readFormField(form: number, annot: number, annotIndex: number): FormField | null {
    const type = this.p.FPDFAnnot_GetFormFieldType(form, annot); // -1 = no es un campo de formulario
    const kind = FPDF_FORMFIELD_KIND[type];
    if (!kind) return null;
    const m = this.mem;
    // Patrón de dos llamadas: ver leerCadenaPdfium (E-028).
    const name = leerCadenaPdfium(
      m,
      (buf, len) => this.p.FPDFAnnot_GetFormFieldName(form, annot, buf, len),
      (ptr) => m.readU16(ptr)
    );
    const value = leerCadenaPdfium(
      m,
      (buf, len) => this.p.FPDFAnnot_GetFormFieldValue(form, annot, buf, len),
      (ptr) => m.readU16(ptr)
    );
    const flags = this.p.FPDFAnnot_GetFormFieldFlags(form, annot);
    const readOnly = (flags & FPDF_FORMFLAG_READONLY) !== 0;
    const checked = (kind === 'checkbox' || kind === 'radio') ? this.p.FPDFAnnot_IsChecked(form, annot) : false;
    // FS_RECTF = {left, top, right, bottom} en puntos PDF (floats, 16 bytes), como en getNotes().
    const rectPtr = m.malloc(16);
    this.p.FPDFAnnot_GetRect(annot, rectPtr);
    const left = m.getValue(rectPtr, 'float'), top = m.getValue(rectPtr + 4, 'float');
    const right = m.getValue(rectPtr + 8, 'float'), bottom = m.getValue(rectPtr + 12, 'float');
    m.free(rectPtr);
    return { annotIndex, name, kind, value, checked, readOnly, rectPt: { xPt: left, yPt: bottom, wPt: right - left, hPt: top - bottom } };
  }

  setFormText(doc: DocHandle, pageIndex: number, annotIndex: number, value: string): boolean {
    return this.withFormPage(doc, pageIndex, (page, form) => {
      if (!form) return false;
      const annot = this.p.FPDFPage_GetAnnot(page, annotIndex);
      if (!annot) return false;
      try {
        if (FPDF_FORMFIELD_KIND[this.p.FPDFAnnot_GetFormFieldType(form, annot)] !== 'text') return false;
        if (this.p.FPDFAnnot_GetFormFieldFlags(form, annot) & FPDF_FORMFLAG_READONLY) return false;
        const wptr = this.mem.wide(value);
        const ok = this.p.EPDFAnnot_SetFormFieldValue(form, annot, wptr);
        this.mem.free(wptr);
        if (!ok) return false;
        // Regenera la apariencia del widget: sin esto, otros visores (y el
        // propio render de esta app) seguirían mostrando el valor anterior.
        this.p.EPDFAnnot_GenerateFormFieldAP(annot);
        return true;
      } finally {
        this.p.FPDFPage_CloseAnnot(annot);
      }
    });
  }

  setFormChecked(doc: DocHandle, pageIndex: number, annotIndex: number, checked: boolean): boolean {
    return this.withFormPage(doc, pageIndex, (page, form) => {
      if (!form) return false;
      const annot = this.p.FPDFPage_GetAnnot(page, annotIndex);
      if (!annot) return false;
      try {
        if (FPDF_FORMFIELD_KIND[this.p.FPDFAnnot_GetFormFieldType(form, annot)] !== 'checkbox') return false;
        if (this.p.FPDFAnnot_GetFormFieldFlags(form, annot) & FPDF_FORMFLAG_READONLY) return false;
        // El valor "marcado" es el nombre de exportación del propio widget
        // (su sub-diccionario /AP /N distinto de "Off"), no siempre "Yes".
        const onValue = leerCadenaPdfium(
          this.mem,
          (buf, len) => this.p.FPDFAnnot_GetFormFieldExportValue(form, annot, buf, len),
          (ptr) => this.mem.readU16(ptr)
        );
        const target = checked ? (onValue || 'Yes') : 'Off';
        const wptr = this.mem.wide(target);
        const ok = this.p.EPDFAnnot_SetFormFieldValue(form, annot, wptr);
        this.mem.free(wptr);
        if (!ok) return false;
        this.p.EPDFAnnot_GenerateFormFieldAP(annot);
        return true;
      } finally {
        this.p.FPDFPage_CloseAnnot(annot);
      }
    });
  }

  fillRect(doc: DocHandle, pageIndex: number, rect: RectPt, color: [number, number, number]): boolean {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const obj = this.p.FPDFPageObj_CreateNewRect(rect.xPt, rect.yPt, rect.wPt, rect.hPt);
      this.p.FPDFPath_SetDrawMode(obj, 2, false); // 2 = relleno por winding, sin trazo
      const [r, g, b] = color;
      this.p.FPDFPageObj_SetFillColor(obj, r, g, b, 255);
      // Blend normal (sin SetBlendMode): rectángulo opaco, base de subrayado/tachado.
      this.p.FPDFPage_InsertObject(page, obj);
      this.p.FPDFPage_GenerateContent(page);
      return true;
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  drawStroke(doc: DocHandle, pageIndex: number, points: { xPt: number; yPt: number }[], color: [number, number, number], widthPt: number): boolean {
    if (points.length < 2) return false;
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const path = this.p.FPDFPageObj_CreateNewPath(points[0]!.xPt, points[0]!.yPt);
      for (let i = 1; i < points.length; i++) this.p.FPDFPath_LineTo(path, points[i]!.xPt, points[i]!.yPt);
      const [r, g, b] = color;
      this.p.FPDFPageObj_SetStrokeColor(path, r, g, b, 255);
      this.p.FPDFPageObj_SetStrokeWidth(path, widthPt);
      this.p.FPDFPath_SetDrawMode(path, 0, true); // sin relleno, con trazo
      this.p.FPDFPage_InsertObject(page, path);
      this.p.FPDFPage_GenerateContent(page);
      return true;
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  save(doc: DocHandle): Uint8Array<ArrayBuffer> {
    const chunks: Uint8Array[] = [];
    const cb = this.mem.addFunction((_pThis: number, pData: number, size: number): number => {
      chunks.push(Uint8Array.from(this.mem.HEAPU8.subarray(pData, pData + size)));
      return 1;
    }, 'iiii');
    const fw = this.mem.malloc(8);
    this.mem.setValue(fw, 1, 'i32');      // FPDF_FILEWRITE.version = 1
    this.mem.setValue(fw + 4, cb, 'i32'); // WriteBlock
    try {
      this.p.FPDF_SaveAsCopy(doc, fw, 0);
    } finally {
      this.mem.free(fw);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  close(doc: DocHandle): void {
    const env = this.formEnv.get(doc);
    if (env) {
      // Orden inverso al de open(): salir del entorno antes de cerrar el
      // documento que lo respalda, y liberar el struct FORMFILLINFO al final.
      if (env.form) this.p.PDFiumExt_ExitFormFillEnvironment(env.form);
      if (env.info) this.p.PDFiumExt_CloseFormFillInfo(env.info);
      this.formEnv.delete(doc);
    }
    this.p.FPDF_CloseDocument(doc);
    const ptr = this.srcPtr.get(doc);
    if (ptr !== undefined) { this.mem.free(ptr); this.srcPtr.delete(doc); }
  }
}
