import { loadEngine, type Pdfium } from './loadEngine';
import { makeMem, leerCadenaPdfium, type Mem } from './mem';
import { standardFontFor, STANDARD_FONTS } from '../standardFontFor';
import { validarUrlEnlace } from '../validarUrlEnlace';
import { esCaracterDePalabra } from '../../texto/esCaracterDePalabra';
import type { QuadPt } from '../../coords/quads';
import type { PdfEngine, CharBox, DocHandle, SizePt, TextRun, EditResult, EditLineResult, LineaParaEditar, ReplaceFontResult, SetSizeResult, RenderResult, InsertTextSpec, InsertImageSpec, RectPt, MarkupKind, NoteInfo, CommentInfo, CommentKind, FormField, FormFieldKind, FormFieldOption, OutlineItem, AccionMarcador, ImagePixels, PageOp, PageOpResult } from '../PdfEngine';

const FPDF_PAGEOBJ_TEXT = 1;
const FPDF_PAGEOBJ_PATH = 2;
const FPDF_PAGEOBJ_IMAGE = 3;
// FPDFBitmap_GetFormat (public/fpdfview.h): formato del bitmap devuelto por
// FPDFImageObj_GetBitmap. Sin constantes propias en los .d.ts del paquete
// (son structs/enums C planos, invisibles para el wrapper) — valores
// estables de la API pública de PDFium.
const FPDFBitmap_Gray = 1;
const FPDFBitmap_BGR = 2;  // 3 bytes/píxel, sin alfa: el formato más común (imagen opaca), ver getImagePixels.
const FPDFBitmap_BGRx = 3;
const FPDFBitmap_BGRA = 4;
const FPDF_SEGMENT_MOVETO = 2; // FPDF_SEGMENTTYPE: inicia un subtrazo nuevo, sin conectar con el punto anterior.
const FPDF_ANNOT_TEXT = 1;    // FPDF_ANNOTATION_SUBTYPE: nota adhesiva ("sticky note")
const FPDF_ANNOT_LINK = 2;    // FPDF_ANNOTATION_SUBTYPE: enlace clicable (addLink, PR fase 2a)
// FPDF_ANNOTATION_SUBTYPE de las anotaciones que entiende el panel de comentarios.
const FPDF_ANNOT_FREETEXT = 3;
const FPDF_ANNOT_HIGHLIGHT = 9;
const FPDF_ANNOT_UNDERLINE = 10;
const FPDF_ANNOT_STRIKEOUT = 12;
const FPDF_ANNOT_POPUP = 16;
const FPDF_ANNOT_WIDGET = 20;
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
const FPDF_FORMFLAG_CHOICE_MULTISELECT = 0x200000; // bit 22 de /Ff (tabla 231, solo campos de elección).

import { OUTLINE_MAX_DEPTH, OUTLINE_MAX_NODES } from '../cotasOutline';

const PDFACTION_GOTO = 1;
const PDFACTION_REMOTEGOTO = 2;
const PDFACTION_URI = 3;
const PDFACTION_LAUNCH = 4; // FPDFAction_GetType: acción "ir a" (destino dentro del propio documento).

// Cotas del recorrido del outline (E-031, ver docs/ERRORES-CONOCIDOS.md): un
// PDF hostil puede definir un outline con ciclos (un /Next o /First que
// apunta hacia atrás) o una profundidad/cantidad de nodos desmedida. Sin
// estas cotas, un `while` que sigue /NextSibling entraría en bucle infinito.

/**
 * Implementación de PdfEngine sobre @embedpdf/pdfium (WASM).
 * FPDF_LoadMemDocument exige que el buffer de datos siga vivo mientras el
 * documento esté abierto: se guarda su puntero por documento y se libera al cerrar.
 */
/** Clave de las propiedades de `/Artifact` con la que este editor marca lo que inserta. */
const CLAVE_MARCA_EDITOR = 'PDFEditor';

/** Fecha en formato PDF (`D:AAAAMMDDHHmmSS`, hora local sin zona; /M de las anotaciones). */
function fechaPdf(d: Date): string {
  const z = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `D:${z(d.getFullYear(), 4)}${z(d.getMonth() + 1)}${z(d.getDate())}${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

export class PdfiumEngine implements PdfEngine {
  private readonly srcPtr = new Map<DocHandle, number>();
  // Entorno de formularios (AcroForm), uno por documento. `info` es el struct
  // FPDF_FORMFILLINFO reservado por PDFiumExt_OpenFormFillInfo; `form` es el
  // FPDF_FORMHANDLE que exigen todas las FPDFAnnot_GetFormField*/EPDFAnnot_*
  // relacionadas con campos. 0 si el motor de este build no trae el extra o
  // si la inicialización falló: entonces listFormFields devuelve siempre [].
  private readonly formEnv = new Map<DocHandle, { info: number; form: number }>();
  // Soporte de measureText(): un documento efímero propio del motor (nunca
  // expuesto como DocHandle a quien llama) que aloja las fuentes estándar
  // cargadas con FPDFText_LoadStandardFont, cacheadas por nombre — como
  // mucho 14 entradas (una por cada STANDARD_FONTS), nunca crecen sin límite
  // sin importar cuántas veces se llame a measureText. A diferencia de
  // FPDFPageObj_NewTextObj (que crea y posee su propia fuente internamente,
  // sin que el llamante deba liberarla), FPDFText_LoadStandardFont SÍ
  // transfiere la propiedad del FPDF_FONT devuelto: exige FPDFFont_Close
  // (§2.6). Se crean de forma perezosa (measureText puede no llamarse nunca
  // en una sesión que no convierte Markdown) y se liberan en
  // closeMeasureFonts() — no hay un punto de "cierre de sesión" natural en
  // esta app de una sola pestaña (el motor vive mientras vive la pestaña),
  // así que closeMeasureFonts() es higiene explícita para quien la necesite
  // (tests, o una futura recarga de motor sin recargar la página) más que
  // un requisito de fuga real: el máximo posible son 14 fuentes.
  private measureFontDoc: DocHandle | null = null;
  private readonly measureFontCache = new Map<string, number>();

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

  /**
   * PDF de una página en blanco, tamaño `widthPt`×`heightPt` en puntos PDF.
   * Mismo patrón que `imageToPdf`: documento efímero, una página, guardar y
   * cerrar en el propio método — aquí sin insertar ningún objeto, así que la
   * página queda vacía de verdad (sin contenido, sin recursos).
   */
  createBlank(widthPt: number, heightPt: number): Uint8Array<ArrayBuffer> {
    const doc = this.p.FPDF_CreateNewDocument();
    try {
      const page = this.p.FPDFPage_New(doc, 0, widthPt, heightPt);
      this.p.FPDF_ClosePage(page);
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

  findText(doc: DocHandle, pageIndex: number, query: string, opciones?: { mayusculas?: boolean; palabraCompleta?: boolean }): RectPt[] {
    if (!query) return [];
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const textPage = this.p.FPDFText_LoadPage(page);
    const wq = this.mem.wide(query);
    // flags: 0 = insensible a mayúsculas; FPDF_MATCHCASE=0x1. NO se usa
    // FPDF_MATCHWHOLEWORD (0x2): PDFium solo trata como letras el ASCII y '_',
    // así que "a" casaría dentro de "año". La palabra completa se filtra abajo
    // con `esCaracterDePalabra` (Unicode), el mismo criterio que buscarReemplazar.ts.
    const flags = opciones?.mayusculas ? 0x1 : 0;
    const palabraCompleta = !!opciones?.palabraCompleta;
    const sh = this.p.FPDFText_FindStart(textPage, wq, flags, 0);
    const matches: RectPt[] = [];
    try {
      while (this.p.FPDFText_FindNext(sh)) {
        const start = this.p.FPDFText_GetSchResultIndex(sh);
        const count = this.p.FPDFText_GetSchCount(sh);
        if (palabraCompleta) {
          // Índices de carácter de la página de texto; fuera de rango = sin vecino.
          const total = this.p.FPDFText_CountChars(textPage);
          const antes = start > 0 ? this.p.FPDFText_GetUnicode(textPage, start - 1) : 0;
          const despues = start + count < total ? this.p.FPDFText_GetUnicode(textPage, start + count) : 0;
          if (esCaracterDePalabra(antes) || esCaracterDePalabra(despues)) continue;
        }
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
      // handle del objeto → índice de objeto (runId), para atribuir cada carácter de la text page a su objeto.
      const indiceDe = new Map<number, number>();
      for (let i = 0; i < n; i++) indiceDe.set(this.p.FPDFPage_GetObject(page, i), i);
      const reales = this.textoRealPorObjeto(textPage, indiceDe);
      for (let i = 0; i < n; i++) {
        const obj = this.p.FPDFPage_GetObject(page, i);
        if (this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) continue;
        runs.push(this.readTextRun(obj, textPage, i, reales.get(i)));
      }
    } finally {
      this.p.FPDFText_ClosePage(textPage);
      this.p.FPDF_ClosePage(page);
    }
    return runs;
  }

  /**
   * Texto REAL de cada objeto de texto de la página (sin los caracteres que PDFium genera: huecos de `TJ`, saltos de
   * línea) y si PDFium generó un espacio justo antes de su primer carácter. Un único recorrido de la text page
   * (`FPDFText_GetTextObject` + `FPDFText_IsGenerated`). Clave: índice del objeto en la página.
   */
  private textoRealPorObjeto(textPage: number, indiceDe: Map<number, number>): Map<number, { texto: string; espacioAntes: boolean }> {
    const out = new Map<number, { texto: string; espacioAntes: boolean }>();
    const total = this.p.FPDFText_CountChars(textPage);
    let espacioPendiente = false;
    for (let k = 0; k < total; k++) {
      const u = this.p.FPDFText_GetUnicode(textPage, k);
      if (this.p.FPDFText_IsGenerated(textPage, k) === 1) {
        if (u === 32) espacioPendiente = true;
        else if (u === 10 || u === 13) espacioPendiente = false;
        continue;
      }
      const idx = indiceDe.get(this.p.FPDFText_GetTextObject(textPage, k));
      if (idx === undefined || u === 10 || u === 13) continue;
      let ch = '';
      try { ch = u > 0 && u <= 0x10ffff ? String.fromCodePoint(u) : ''; } catch { ch = ''; }
      let e = out.get(idx);
      if (!e) { e = { texto: '', espacioAntes: espacioPendiente }; out.set(idx, e); }
      e.texto += ch;
      espacioPendiente = false;
    }
    return out;
  }

  /** Texto real (sin caracteres generados) de UN objeto, leyendo solo los caracteres de la text page que le pertenecen. */
  private textoRealDeObjeto(textPage: number, obj: number): string {
    let texto = '';
    const total = this.p.FPDFText_CountChars(textPage);
    for (let k = 0; k < total; k++) {
      if (this.p.FPDFText_GetTextObject(textPage, k) !== obj || this.p.FPDFText_IsGenerated(textPage, k) === 1) continue;
      const u = this.p.FPDFText_GetUnicode(textPage, k);
      if (u === 10 || u === 13) continue;
      try { if (u > 0 && u <= 0x10ffff) texto += String.fromCodePoint(u); } catch { /* unidad suelta: se omite */ }
    }
    return texto;
  }

  /** Texto actual de un run para reescribirlo: el REAL (sin espacios generados por PDFium); si no hay, el de `GetText`. */
  private textoActualDelRun(obj: number, textPage: number): string {
    const real = this.textoRealDeObjeto(textPage, obj);
    if (real !== '') return real;
    return leerCadenaPdfium(
      this.mem,
      (buf, len) => this.p.FPDFTextObj_GetText(obj, textPage, buf, len),
      (ptr) => this.mem.readU16(ptr)
    );
  }

  /**
   * Única vía de escritura de texto en un objeto (`FPDFText_SetText`). PROHIBE la cadena vacía: con ella PDFium
   * provoca `RuntimeError: unreachable` y mata el WASM de todas las páginas abiertas (E-081). Un borrado elimina el
   * objeto (`deleteRun`), nunca lo deja vacío.
   */
  private escribirTexto(obj: number, texto: string): void {
    if (texto === '') throw new Error('Texto vacío: FPDFText_SetText("") bloquea el motor; para borrar se elimina el objeto.');
    const wptr = this.mem.wide(texto);
    try { this.p.FPDFText_SetText(obj, wptr); } finally { this.mem.free(wptr); }
  }

  /**
   * Relee, en la text page de la MISMA página y antes de generar contenido, lo que quedó escrito en `obj`; `true` si
   * coincide con `esperado`. En un subconjunto CID `FPDFFont_GetGlyphPath` da falsos positivos (dice «sí» a glifos que no
   * están y se guardan como `.notdef`, E-079), así que la cobertura de glifos NO se consulta antes: se verifica el
   * resultado. Cuando no coincide, el llamante cierra la página SIN `FPDFPage_GenerateContent` y el cambio se descarta
   * solo (cada llamada del motor reparsea la página desde el content stream).
   */
  private textoEscritoCoincide(page: number, obj: number, esperado: string): boolean {
    const textPage = this.p.FPDFText_LoadPage(page);
    try {
      const leido = leerCadenaPdfium(
        this.mem,
        (buf, len) => this.p.FPDFTextObj_GetText(obj, textPage, buf, len),
        (ptr) => this.mem.readU16(ptr)
      );
      // PDFium recorta el espacio final y puede colapsar los dobles al releer: eso no es un glifo ausente, así que los
      // blancos no cuentan en la comparación (un glifo que falta sí deja un hueco en las letras).
      const sinBlancos = (t: string): string => t.replace(/\s+/g, ' ').trim();
      const esp = sinBlancos(esperado);
      return sinBlancos(leido) === esp || sinBlancos(this.textoRealDeObjeto(textPage, obj)) === esp;
    } finally {
      this.p.FPDFText_ClosePage(textPage);
    }
  }

  getCharBoxes(doc: DocHandle, pageIndex: number): CharBox[] {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const textPage = this.p.FPDFText_LoadPage(page);
    const out: CharBox[] = [];
    // Cuatro doubles reutilizados para todos los caracteres (left, right, bottom, top).
    const l = this.mem.malloc(8), r = this.mem.malloc(8), b = this.mem.malloc(8), t = this.mem.malloc(8);
    try {
      const n = this.p.FPDFText_CountChars(textPage);
      for (let i = 0; i < n; i++) {
        const u = this.p.FPDFText_GetUnicode(textPage, i);
        let ch = '';
        try { ch = u > 0 && u <= 0x10ffff ? String.fromCodePoint(u) : ''; } catch { ch = ''; }
        this.p.FPDFText_GetCharBox(textPage, i, l, r, b, t);
        const L = this.mem.getValue(l, 'double'), R = this.mem.getValue(r, 'double');
        const B = this.mem.getValue(b, 'double'), T = this.mem.getValue(t, 'double');
        out.push(R > L && T > B
          ? { ch, boxPt: { xPt: L, yPt: B, wPt: R - L, hPt: T - B } }
          : { ch, boxPt: { xPt: 0, yPt: 0, wPt: 0, hPt: 0 } });
      }
    } finally {
      [l, r, b, t].forEach((ptr) => this.mem.free(ptr));
      this.p.FPDFText_ClosePage(textPage);
      this.p.FPDF_ClosePage(page);
    }
    return out;
  }

  /**
   * Avance natural de `texto` con la fuente `font` (handle prestado) a `Tf = sizePt`, a lo largo de la línea base y en pt de
   * página: suma de anchos de glifo × la escala de la matriz del objeto (`hypot(a, b)`, 0 = 1). No incluye `Tc`/`Tw` ni kerning.
   */
  private avanceNatural(font: number, sizePt: number, escala: number, texto: string): number {
    const m = this.mem;
    let avance = 0;
    const w = m.malloc(4);
    for (const ch of texto) {
      m.setValue(w, 0, 'float');
      if (this.p.FPDFFont_GetGlyphWidth(font, ch.codePointAt(0)!, sizePt, w)) avance += m.getValue(w, 'float');
    }
    m.free(w);
    return avance * (escala > 0 ? escala : 1);
  }

  /** Matriz del objeto (a, b, c, d, e, f) en pt de página. */
  private matrizDe(obj: number): [number, number, number, number, number, number] {
    const mat = this.mem.malloc(24);
    this.p.FPDFPageObj_GetMatrix(obj, mat);
    const v = [0, 4, 8, 12, 16, 20].map((off) => this.mem.getValue(mat + off, 'float')) as [number, number, number, number, number, number];
    this.mem.free(mat);
    return v;
  }

  /** Lee las propiedades de un objeto de texto (obj) usando la text page para el string. */
  private readTextRun(obj: number, textPage: number, runId: number, real?: { texto: string; espacioAntes: boolean }): TextRun {
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
    const matriz = [0, 4, 8, 12, 16, 20].map((off) => m.getValue(mat + off, 'float')) as TextRun['matriz'];
    m.free(mat);
    const originPt = { xPt: matriz[4], yPt: matriz[5] };
    // Dirección del texto en el espacio de usuario: ángulo (grados, antihorario, 0..359) del vector (a, b).
    const anguloDeg = (Math.round((Math.atan2(matriz[1], matriz[0]) * 180) / Math.PI) + 360) % 360;
    // E-080: el `Tf` es NOMINAL; lo que ve el usuario es Tf × la escala de la matriz (0,75 en los PDF de Chrome).
    const escala = Math.hypot(matriz[0], matriz[1]);
    const sizeEfectivoPt = escala > 0 ? sizePt * escala : sizePt;
    const textoReal = real?.texto ?? text;
    // Avance natural del texto real a lo largo de la línea base (pt de página): anchos de glifo al `Tf` × escala.
    const avancePt = this.avanceNatural(font, sizePt, escala, textoReal);
    return {
      runId, text, sizePt, sizeEfectivoPt, matriz, textoReal, espacioVirtualAntes: real?.espacioAntes ?? false, avancePt,
      renderMode: this.p.FPDFTextObj_GetTextRenderMode(obj), fuenteSubconjunto: /^[A-Z]{6}\+/.test(fontName),
      fontName, color, boxPt: { xPt: left, yPt: bottom, wPt: right - left, hPt: top - bottom }, originPt, anguloDeg
    };
  }

  /**
   * Árbol de marcadores del documento. Recorre `FPDFBookmark_GetFirstChild` /
   * `FPDFBookmark_GetNextSibling` con tres protecciones contra un outline
   * hostil (E-031): un `Set` de handles ya visitados corta cualquier ciclo
   * (hermano o hijo que apunte hacia atrás — los handles de PDFium son punteros
   * estables dentro del documento mientras dure el recorrido), un límite de
   * profundidad (`OUTLINE_MAX_DEPTH`) acota la recursión (no puede desbordar
   * la pila: JS ya rompe mucho antes de 32 niveles) y un límite total de nodos
   * (`OUTLINE_MAX_NODES`) acota el trabajo aunque no haya ciclo, por ejemplo
   * una lista de hermanos artificialmente larga.
   */
  getOutline(doc: DocHandle): OutlineItem[] {
    const visitados = new Set<number>();
    let total = 0;
    const leerHermanos = (padre: number, profundidad: number): OutlineItem[] => {
      if (profundidad > OUTLINE_MAX_DEPTH) return [];
      const items: OutlineItem[] = [];
      let marcador = this.p.FPDFBookmark_GetFirstChild(doc, padre);
      while (marcador) {
        if (visitados.has(marcador) || total >= OUTLINE_MAX_NODES) break;
        visitados.add(marcador);
        total++;
        const title = leerCadenaPdfium(
          this.mem,
          (buf, len) => this.p.FPDFBookmark_GetTitle(marcador, buf, len),
          (ptr) => this.mem.readU16(ptr)
        );
        const { pageIndex, accion } = this.bookmarkTarget(doc, marcador);
        const children = leerHermanos(marcador, profundidad + 1);
        items.push(accion ? { title, pageIndex, children, accion } : { title, pageIndex, children });
        marcador = this.p.FPDFBookmark_GetNextSibling(doc, marcador);
      }
      return items;
    };
    return leerHermanos(0, 0);
  }

  /**
   * Reescribe el árbol de marcadores COMPLETO con `EPDFBookmark_*` (el build
   * de @embedpdf/pdfium las expone; son las únicas que escriben outline).
   * Estrategia: validar el árbol con las cotas de E-031 ANTES de tocar nada
   * (así un árbol rechazado deja el documento intacto), borrar los marcadores
   * raíz actuales (`EPDFBookmark_Delete` arrastra a los hijos y reengancha
   * /First, /Last, /Next, /Prev, /Count, /Parent) y reconstruir con
   * `AppendChild` (padre 0 = raíz). Cada destino es `[página /Fit]`
   * (`EPDFDest_CreateView`, modo 2 = Fit, 0 parámetros); `pageIndex` nulo o
   * fuera de rango se escribe sin destino. El título lo codifica PDFium
   * (UTF-16BE con BOM): sobrevive ñ, emoji (pares sustitutos) y similares.
   * Acciones: los marcadores URI (http/https/mailto) se recrean con
   * `EPDFAction_CreateURI` + `EPDFBookmark_SetAction`; un árbol con cualquier
   * acción `no-soportada` se rechaza antes de tocar nada.
   */
  setOutline(doc: DocHandle, items: OutlineItem[]): void {
    this.validarOutline(items);
    // 1) Borra el outline vigente. Cotas anti-ciclo: sin ellas un outline
    // hostil (A→B→A) podría hacer que este bucle no terminara nunca.
    const borrados = new Set<number>();
    let raiz = this.p.FPDFBookmark_GetFirstChild(doc, 0);
    while (raiz && !borrados.has(raiz) && borrados.size < OUTLINE_MAX_NODES) {
      borrados.add(raiz);
      this.p.EPDFBookmark_Delete(doc, raiz);
      raiz = this.p.FPDFBookmark_GetFirstChild(doc, 0);
    }
    // 2) Reconstruye.
    const total = this.p.FPDF_GetPageCount(doc);
    const escribir = (padre: number, hijos: OutlineItem[]): void => {
      for (const item of hijos) {
        const titulo = this.mem.wide(item.title);
        const marcador = this.p.EPDFBookmark_AppendChild(doc, padre, titulo);
        this.mem.free(titulo);
        if (!marcador) throw new Error('PDFium no pudo crear el marcador');
        if (item.accion?.tipo === 'uri') {
          const accion = this.p.EPDFAction_CreateURI(doc, item.accion.uri);
          if (!accion || !this.p.EPDFBookmark_SetAction(doc, marcador, accion)) throw new Error('PDFium no pudo escribir la acción URI del marcador');
        } else if (item.pageIndex !== null && item.pageIndex >= 0 && item.pageIndex < total) {
          const page = this.p.FPDF_LoadPage(doc, item.pageIndex);
          if (page) {
            try {
              const params = this.mem.malloc(4);
              const dest = this.p.EPDFDest_CreateView(page, 2 /* Fit */, params, 0);
              this.mem.free(params);
              if (dest) this.p.EPDFBookmark_SetDest(doc, marcador, dest);
            } finally {
              this.p.FPDF_ClosePage(page);
            }
          }
        }
        escribir(marcador, item.children);
      }
    };
    escribir(0, items);
  }

  /** Lanza si el árbol supera las cotas de E-031 (profundidad o nodos). Sin efectos. */
  private validarOutline(items: OutlineItem[]): void {
    let nodos = 0;
    const visitar = (hijos: OutlineItem[], profundidad: number): void => {
      if (hijos.length > 0 && profundidad > OUTLINE_MAX_DEPTH) {
        throw new RangeError(`Outline demasiado profundo (máximo ${OUTLINE_MAX_DEPTH} niveles de profundidad)`);
      }
      for (const h of hijos) {
        if (h.accion?.tipo === 'no-soportada') {
          throw new Error(`Hay marcadores con acciones que este editor no puede conservar (${h.accion.descripcion}): no se reescribe el outline`);
        }
        if (h.accion?.tipo === 'uri' && validarUrlEnlace(h.accion.uri) === null) throw new Error('URI de marcador con esquema no permitido');
        if (++nodos > OUTLINE_MAX_NODES) throw new RangeError(`Outline con demasiados nodos (máximo ${OUTLINE_MAX_NODES})`);
        visitar(h.children, profundidad + 1);
      }
    };
    visitar(items, 0);
  }

  /**
   * Destino de un marcador: página (`/Dest` o acción GoTo), URI permitida, o
   * una acción que no sabemos conservar (`no-soportada`: Launch, GoToR,
   * JavaScript, nombrada, URI con esquema no permitido, destino sin página).
   * Solo se LEE: ninguna acción se ejecuta jamás. Sin destino ni acción:
   * `{ pageIndex: null }` sin `accion`.
   */
  private bookmarkTarget(doc: DocHandle, marcador: number): { pageIndex: number | null; accion?: AccionMarcador } {
    const noSop = (descripcion: string) => ({ pageIndex: null, accion: { tipo: 'no-soportada', descripcion } as AccionMarcador });
    const paginaDe = (dest: number): number | null => {
      const i = this.p.FPDFDest_GetDestPageIndex(doc, dest);
      return i >= 0 ? i : null;
    };
    // Primero la acción: `FPDFBookmark_GetDest` también devuelve el `/D` de una
    // acción GoToR (otro documento) y lo resolvería, falsamente, contra ESTE
    // documento. Solo sin acción vale el `/Dest` directo.
    const action = this.p.FPDFBookmark_GetAction(marcador);
    if (!action) {
      const dirigido = this.p.FPDFBookmark_GetDest(doc, marcador);
      if (!dirigido) return { pageIndex: null };
      const i = paginaDe(dirigido);
      return i === null ? noSop('Destino sin página resoluble') : { pageIndex: i };
    }
    switch (this.p.FPDFAction_GetType(action)) {
      case PDFACTION_GOTO: {
        const dest = this.p.FPDFAction_GetDest(doc, action);
        const i = dest ? paginaDe(dest) : null;
        return i === null ? noSop('Acción GoTo sin página resoluble') : { pageIndex: i };
      }
      case PDFACTION_URI: {
        // ASCII de 7 bits según la especificación; patrón de dos llamadas (E-028).
        const uri = leerCadenaPdfium(
          this.mem,
          (buf, len) => this.p.FPDFAction_GetURIPath(doc, action, buf, len),
          (ptr) => this.mem.UTF8ToString(ptr)
        );
        return validarUrlEnlace(uri) !== null ? { pageIndex: null, accion: { tipo: 'uri', uri } } : noSop('URI con esquema no permitido');
      }
      case PDFACTION_LAUNCH: return noSop('Acción Launch (abrir fichero)');
      case PDFACTION_REMOTEGOTO: return noSop('Acción GoToR (otro documento)');
      default: return noSop('Acción no soportada (JavaScript, nombrada u otra)');
    }
  }

  editTextRun(doc: DocHandle, pageIndex: number, runId: number, newText: string): EditResult {
    // E-081: nunca se escribe la cadena vacía (bloquea el WASM); quitar una línea es eliminar el objeto.
    if (newText === '') return { ok: false, reason: 'empty-text' };
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const obj = this.p.FPDFPage_GetObject(page, runId);
      if (!obj || this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) {
        return { ok: false, reason: 'not-a-text-run' };
      }
      // Edición EN SITIO: mismo objeto → conserva fuente, tamaño, color y matriz. Se escribe y se RELEE (E-079): si la
      // fuente no tiene algún glifo se cierra la página sin generar contenido y no queda nada escrito.
      this.escribirTexto(obj, newText);
      if (!this.textoEscritoCoincide(page, obj, newText)) return { ok: false, reason: 'glyph-missing' };
      this.p.FPDFPage_GenerateContent(page);
      return { ok: true };
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  editLine(doc: DocHandle, pageIndex: number, linea: LineaParaEditar, textoNuevo: string, opciones: { fuenteEstandar?: boolean } = {}): EditLineResult {
    // E-081: nunca se escribe la cadena vacía; quitar la línea entera es eliminar sus objetos (`deleteRuns`).
    if (textoNuevo === '') return { ok: false, reason: 'empty-text' };
    if (textoNuevo === linea.text) return { ok: true, sinCambios: true };
    if (linea.runIds.length === 0) return { ok: false, reason: 'not-a-text-run' };
    // Línea de un solo objeto (nativo.pdf, Word…): exactamente el camino de siempre.
    if (linea.runIds.length === 1) {
      const runId = linea.runIds[0]!;
      if (opciones.fuenteEstandar) {
        const r = this.replaceRunWithStandardFont(doc, pageIndex, runId, textoNuevo);
        return r.ok
          ? { ok: true, lineaRunIdInicial: r.runId, dxPt: 0, fuenteEstandar: r.fontName }
          : { ok: false, reason: r.reason === 'invalid-font' ? 'not-a-text-run' : r.reason };
      }
      const r = this.editTextRun(doc, pageIndex, runId, textoNuevo);
      return r.ok ? { ok: true, lineaRunIdInicial: runId, dxPt: 0 } : r;
    }
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      return this.editarLineaCompuesta(doc, page, linea, textoNuevo, opciones.fuenteEstandar === true);
    } finally {
      // Sin `GenerateContent` (error o verificación fallida) el cambio en memoria se descarta al cerrar la página.
      this.p.FPDF_ClosePage(page);
    }
  }

  /**
   * Núcleo de `editLine` para una línea de varios objetos: el diff mínimo del diseño N1 (§3.2), todo sobre la MISMA página
   * cargada y con UN solo `FPDFPage_GenerateContent` al final (E-037).
   *
   * Unidades: los índices `P`, `E`, `A0`, `A1` son UTF-16 sobre `linea.text`. `u` es la coordenada a lo largo del texto, en
   * pt del espacio de usuario de la página SIN girar con la matriz del objeto ya aplicada (θ = atan2(b, a)); Δ también es
   * pt sobre ese eje, y la traslación del sufijo es (Δ·cosθ, Δ·sinθ) pt en el mismo espacio (la que usa `moveRun`).
   */
  private editarLineaCompuesta(doc: DocHandle, page: number, linea: LineaParaEditar, nuevo: string, estandar: boolean): EditLineResult {
    const m = this.mem;
    const viejo = linea.text;
    const tr = linea.tramos;
    if (tr.length === 0) return { ok: false, reason: 'stale' };

    // Objetos de la línea y comprobación de que el texto de cada uno sigue siendo el que dice la línea (si no, `stale`).
    const n = this.p.FPDFPage_CountObjects(page);
    const indiceDe = new Map<number, number>();
    for (let i = 0; i < n; i++) indiceDe.set(this.p.FPDFPage_GetObject(page, i), i);
    const objDe = (runId: number): number => this.p.FPDFPage_GetObject(page, runId);
    for (const t of tr) {
      const o = objDe(t.runId);
      if (!o || this.p.FPDFPageObj_GetType(o) !== FPDF_PAGEOBJ_TEXT) return { ok: false, reason: 'not-a-text-run' };
    }
    const textPage = this.p.FPDFText_LoadPage(page);
    try {
      const reales = this.textoRealPorObjeto(textPage, indiceDe);
      for (const t of tr) if ((reales.get(t.runId)?.texto ?? '') !== viejo.slice(t.inicio, t.fin)) return { ok: false, reason: 'stale' };
    } finally {
      this.p.FPDFText_ClosePage(textPage);
    }

    // Diff: prefijo P y sufijo S comunes (sin partir un par sustituto). [P, E) es lo cambiado en el texto viejo.
    const max = Math.min(viejo.length, nuevo.length);
    let P = 0;
    while (P < max && viejo.charCodeAt(P) === nuevo.charCodeAt(P)) P++;
    let S = 0;
    while (S < max - P && viejo.charCodeAt(viejo.length - 1 - S) === nuevo.charCodeAt(nuevo.length - 1 - S)) S++;
    if (P > 0 && (viejo.charCodeAt(P - 1) & 0xfc00) === 0xd800) P--;
    if (S > 0 && (viejo.charCodeAt(viejo.length - S) & 0xfc00) === 0xdc00) S--;
    const E = viejo.length - S;

    // Tramo afectado [i0, i1] (índices de `tramos`, en orden visual): los objetos con algún carácter en [P, E). Una
    // inserción pura (o un cambio que cae en un hueco) cuelga del objeto que acaba en P: hereda el estilo del carácter
    // anterior, como un procesador de textos; al inicio de la línea, del primero.
    let i0 = tr.findIndex((t) => t.fin > P && t.inicio < E);
    let i1 = i0;
    if (i0 < 0) {
      for (let k = 0; k < tr.length; k++) if (tr[k]!.fin <= P) i0 = k;
      if (i0 < 0) i0 = 0;
      i1 = i0;
    } else {
      for (let k = tr.length - 1; k >= i0; k--) if (tr[k]!.inicio < E && tr[k]!.fin > P) { i1 = k; break; }
    }
    // Un cambio que toca un hueco entre objetos (espacio generado por PDFium) arrastra a los objetos vecinos.
    while (i0 > 0 && tr[i0]!.inicio > P) i0--;
    while (i1 < tr.length - 1 && tr[i1]!.fin < E) i1++;
    // Un objeto que acabara en espacio pierde ese espacio al releer el texto de la página (PDFium lo recorta y además
    // genera un hueco falso más adelante): si el medio nuevo acaba en blanco, el objeto escrito se alarga con el siguiente.
    const medioDe = (): string => nuevo.slice(tr[i0]!.inicio, nuevo.length - (viejo.length - tr[i1]!.fin));
    while (i1 < tr.length - 1 && /\s$/.test(medioDe())) i1++;
    const medioNuevo = medioDe();

    const afectados = tr.slice(i0, i1 + 1).map((t) => ({ runId: t.runId, obj: objDe(t.runId) }));
    const sufijo = tr.slice(i1 + 1).map((t) => objDe(t.runId));
    const primero = afectados[0]!;
    const ultimo = afectados[afectados.length - 1]!;
    const primeroLinea = objDe(tr[0]!.runId);

    // Medidas ANTES de escribir. θ y u de la matriz del primer afectado; final viejo del tramo = u + avance natural del
    // último afectado (el hueco con el sufijo, si lo hay, se conserva: solo se mueve Δ).
    const matP = this.matrizDe(primero.obj);
    const theta = Math.atan2(matP[1], matP[0]);
    const cos = Math.cos(theta), sin = Math.sin(theta);
    const uDe = (mt: number[]): number => mt[4]! * cos + mt[5]! * sin;
    const matU = this.matrizDe(ultimo.obj);
    const fontU = this.p.FPDFTextObj_GetFont(ultimo.obj);
    const tfU = m.malloc(4); this.p.FPDFTextObj_GetFontSize(ultimo.obj, tfU);
    const sizeU = m.getValue(tfU, 'float'); m.free(tfU);
    const textoUltimo = viejo.slice(tr[i1]!.inicio, tr[i1]!.fin);
    const finViejoU = uDe(matU) + this.avanceNatural(fontU, sizeU, Math.hypot(matU[0], matU[1]), textoUltimo);
    const nombreFuente = leerCadenaPdfium(
      m,
      (buf, len) => this.p.FPDFFont_GetBaseFontName(this.p.FPDFTextObj_GetFont(primero.obj), buf, len),
      (ptr) => m.UTF8ToString(ptr)
    );
    const tfP = m.malloc(4); this.p.FPDFTextObj_GetFontSize(primero.obj, tfP);
    const sizeP = m.getValue(tfP, 'float'); m.free(tfP);

    // Escritura. Con medio vacío (se borró el tramo entero) no se escribe nada: los objetos del tramo se eliminan todos.
    let objEscrito = primero.obj;
    let fuenteEstandar: string | undefined;
    let finNuevoU = uDe(matP);
    let eliminar = afectados.slice(1);
    if (medioNuevo === '') {
      eliminar = afectados;
    } else if (estandar) {
      // E-047: el TRAMO cambiado en la fuente estándar más parecida (el resto de la línea conserva la suya).
      const destino = standardFontFor(nombreFuente);
      const res = this.sustituirObjeto(page, primero.obj, primero.runId, medioNuevo, () => this.p.FPDFPageObj_NewTextObj(doc, destino, sizeP));
      if (!res.ok) return res;
      objEscrito = res.obj;
      fuenteEstandar = destino;
    } else {
      // En sitio: se escribe y se RELEE (E-079). Si no coincide, no se genera contenido y el cambio se descarta al cerrar.
      this.escribirTexto(primero.obj, medioNuevo);
      if (!this.textoEscritoCoincide(page, primero.obj, medioNuevo)) return { ok: false, reason: 'glyph-missing' };
    }
    if (medioNuevo !== '') {
      const fontN = this.p.FPDFTextObj_GetFont(objEscrito);
      const tfN = m.malloc(4); this.p.FPDFTextObj_GetFontSize(objEscrito, tfN);
      const sizeN = m.getValue(tfN, 'float'); m.free(tfN);
      const matN = this.matrizDe(objEscrito);
      finNuevoU = uDe(matN) + this.avanceNatural(fontN, sizeN, Math.hypot(matN[0], matN[1]), medioNuevo);
    }
    const delta = finNuevoU - finViejoU;

    // Los objetos sobrantes del tramo desaparecen (índices descendentes) y el sufijo se traslada Δ a lo largo del texto.
    const aEliminar = eliminar
      .map((a) => ({ obj: a.obj, idx: indiceDe.get(a.obj)! }))
      .sort((a, b) => b.idx - a.idx);
    for (const a of aEliminar) {
      if (!this.p.FPDFPage_RemoveObject(page, a.obj)) continue;
      this.p.FPDFPageObj_Destroy(a.obj);
    }
    if (delta !== 0) for (const o of sufijo) this.p.FPDFPageObj_Transform(o, 1, 0, 0, 1, delta * cos, delta * sin);

    // Índice del primer objeto de la línea tras los borrados (los de índice menor lo desplazan).
    const eraPrimero = i0 === 0 && medioNuevo !== '' ? objEscrito : primeroLinea;
    let lineaRunIdInicial = -1;
    const total = this.p.FPDFPage_CountObjects(page);
    for (let i = 0; i < total; i++) if (this.p.FPDFPage_GetObject(page, i) === eraPrimero) { lineaRunIdInicial = i; break; }
    this.p.FPDFPage_GenerateContent(page);
    return { ok: true, lineaRunIdInicial, dxPt: delta, ...(fuenteEstandar ? { fuenteEstandar } : {}) };
  }

  /**
   * Sustituye un run por un objeto de texto nuevo en la fuente estándar PDF
   * más parecida (ver `standardFontFor`) cuando la fuente original (subconjunto
   * incrustado sin el glifo tecleado) impide editar en sitio. Réplica del
   * comportamiento de Acrobat: conserva posición/tamaño/color, cambia la
   * fuente. Devuelve `glyph-missing` sin tocar nada si la fuente estándar
   * tampoco cubre `newText` (p. ej. CJK).
   */
  replaceRunWithStandardFont(doc: DocHandle, pageIndex: number, runId: number, newText: string): ReplaceFontResult {
    const m = this.mem;
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const obj = this.p.FPDFPage_GetObject(page, runId);
      if (!obj || this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) {
        return { ok: false, reason: 'not-a-text-run' };
      }

      // Tamaño de fuente original (out float).
      const fsPtr = m.malloc(4); this.p.FPDFTextObj_GetFontSize(obj, fsPtr);
      const size = m.getValue(fsPtr, 'float'); m.free(fsPtr);

      // Nombre de fuente original (bytes UTF-8/Latin-1), para clasificar con
      // el mismo criterio que cssFontFor (E-028: patrón de dos llamadas).
      const font = this.p.FPDFTextObj_GetFont(obj);
      const fontName = leerCadenaPdfium(
        m,
        (buf, len) => this.p.FPDFFont_GetBaseFontName(font, buf, len),
        (ptr) => m.UTF8ToString(ptr)
      );

      const target = standardFontFor(fontName);
      const res = this.swapTextObject(doc, page, obj, runId, newText, () => this.p.FPDFPageObj_NewTextObj(doc, target, size));
      if (!res.ok) return res;
      return { ok: true, fontName: target, runId: res.runId };
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  /**
   * Cambia el tamaño de fuente de un run conservando la MISMA fuente
   * incrustada: `FPDFTextObj_GetFont(obj)` da el handle de esa fuente y
   * `FPDFPageObj_CreateTextObj(doc, font, sizePt)` crea el objeto nuevo con
   * ella (a diferencia de `FPDFPageObj_NewTextObj`, que solo acepta el
   * NOMBRE de una de las 14 fuentes estándar — no serviría aquí porque
   * cambiaría la fuente, no solo el tamaño). El handle de `GetFont` es una
   * referencia PRESTADA (ver `swapTextObject`): no se libera con
   * `FPDFFont_Close`.
   */
  setRunFontSize(doc: DocHandle, pageIndex: number, runId: number, sizePt: number): SetSizeResult {
    if (!Number.isFinite(sizePt) || sizePt < 1 || sizePt > 400) {
      return { ok: false, reason: 'invalid-size' };
    }
    const m = this.mem;
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const textPage = this.p.FPDFText_LoadPage(page);
    try {
      const obj = this.p.FPDFPage_GetObject(page, runId);
      if (!obj || this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) {
        return { ok: false, reason: 'not-a-text-run' };
      }
      // Texto actual del run: el REAL, sin los espacios que PDFium genera (si no, se escribirían como espacios reales).
      const text = this.textoActualDelRun(obj, textPage);
      // E-080: `sizePt` es el tamaño EFECTIVO que pidió el usuario; la matriz del objeto (que `swapTextObject` copia)
      // ya escala el `Tf` (0,75 en los PDF de Chrome), así que el `Tf` nominal del objeto nuevo es pedido / escala.
      const mt = m.malloc(16);
      this.p.FPDFPageObj_GetMatrix(obj, mt);
      const escala = Math.hypot(m.getValue(mt, 'float'), m.getValue(mt + 4, 'float'));
      m.free(mt);
      const tfNominal = escala > 0 ? sizePt / escala : sizePt;
      // Fuente incrustada ORIGINAL (referencia prestada, ver comentario de arriba).
      const font = this.p.FPDFTextObj_GetFont(obj);
      const res = this.swapTextObject(doc, page, obj, runId, text, () => this.p.FPDFPageObj_CreateTextObj(doc, font, tfNominal));
      // Mismo texto y misma fuente que ya tenían el glifo a otro tamaño: la
      // comprobación de glifos de `swapTextObject` no debería fallar nunca
      // aquí (la existencia de un glifo no depende del tamaño), pero el
      // contrato de `setRunFontSize` no tiene 'glyph-missing' — se traduce a
      // 'not-a-text-run' por si el build del motor lo produjera igualmente.
      if (!res.ok) return { ok: false, reason: 'not-a-text-run' };
      return { ok: true, runId: res.runId };
    } finally {
      this.p.FPDFText_ClosePage(textPage);
      this.p.FPDF_ClosePage(page);
    }
  }

  /**
   * Cambia la fuente de un run a una de las 14 fuentes estándar PDF elegida
   * por el usuario, conservando el texto ACTUAL del run (a diferencia de
   * `replaceRunWithStandardFont`, que sustituye también el texto porque
   * viene de una edición con glifo faltante). Comparte `swapTextObject` con
   * ambos métodos.
   */
  setRunFont(doc: DocHandle, pageIndex: number, runId: number, standardFontName: string): ReplaceFontResult {
    if (!(STANDARD_FONTS as readonly string[]).includes(standardFontName)) {
      return { ok: false, reason: 'invalid-font' };
    }
    const m = this.mem;
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const textPage = this.p.FPDFText_LoadPage(page);
    try {
      const obj = this.p.FPDFPage_GetObject(page, runId);
      if (!obj || this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_TEXT) {
        return { ok: false, reason: 'not-a-text-run' };
      }
      const fsPtr = m.malloc(4); this.p.FPDFTextObj_GetFontSize(obj, fsPtr);
      const size = m.getValue(fsPtr, 'float'); m.free(fsPtr);
      const text = this.textoActualDelRun(obj, textPage);
      const res = this.swapTextObject(doc, page, obj, runId, text, () => this.p.FPDFPageObj_NewTextObj(doc, standardFontName, size));
      if (!res.ok) return res;
      return { ok: true, fontName: standardFontName, runId: res.runId };
    } finally {
      this.p.FPDFText_ClosePage(textPage);
      this.p.FPDF_ClosePage(page);
    }
  }

  /**
   * Núcleo compartido de `replaceRunWithStandardFont`, `setRunFont` y
   * `setRunFontSize`: los tres sustituyen un objeto de texto por uno nuevo
   * (PDFium no permite cambiar la fuente ni recrear con otro tamaño en
   * sitio) conservando color de relleno, color de trazo (si lo hay), modo de
   * render y matriz de posición completa (E-030) del objeto original.
   *
   * `newObjFactory` decide cómo se crea el objeto nuevo (por nombre de fuente
   * estándar, o por el handle de una fuente incrustada existente) — es lo
   * único que difiere entre los tres métodos. El `Tf` nominal del objeto nuevo
   * lo fija quien llama (E-080: la matriz del original, que se copia, ya lo
   * escala).
   *
   * Inserta el objeto nuevo en el mismo índice de `runId` para conservar el
   * z-order y RELEE lo escrito (E-079): si la fuente nueva no cubre `newText`
   * devuelve `glyph-missing` SIN generar contenido, y al cerrar la página el
   * documento queda como estaba (la fuente estándar tampoco cubre CJK, y un
   * subconjunto no tiene los glifos que no usó).
   *
   * Nunca llama a `FPDFFont_Close`: en los tres casos la fuente del objeto
   * NUEVO sale de `FPDFTextObj_GetFont(newObj)` — una referencia PRESTADA
   * mientras ese objeto exista (el propio nombre de la función en el header
   * de PDFium, "Get", ya lo indica: no hay un "New"/"Load" de por medio que
   * transfiera la propiedad al llamante). `FPDFFont_Close` solo hace falta
   * para una fuente devuelta por `FPDFText_LoadFont`/`FPDFText_LoadStandardFont`,
   * que sí crean una referencia propia del llamante — ninguno de los tres
   * métodos usa esas funciones.
   */
  private swapTextObject(
    doc: DocHandle,
    page: number,
    obj: number,
    runId: number,
    newText: string,
    newObjFactory: () => number
  ): { ok: true; runId: number } | { ok: false; reason: 'glyph-missing' } {
    const res = this.sustituirObjeto(page, obj, runId, newText, newObjFactory);
    if (!res.ok) return res;
    this.p.FPDFPage_GenerateContent(page);
    return { ok: true, runId: res.runId };
  }

  /**
   * Mitad de `swapTextObject` que NO genera contenido: crea el objeto nuevo, le copia color, trazo, modo de render y
   * matriz del original, lo inserta en el mismo índice y RELEE lo escrito (E-079). El llamante decide cuándo llamar a
   * `FPDFPage_GenerateContent` (una sola vez al final: `editLine` lo combina con borrados y traslaciones, E-037).
   * Devuelve el handle del objeto nuevo.
   */
  private sustituirObjeto(
    page: number,
    obj: number,
    runId: number,
    newText: string,
    newObjFactory: () => number
  ): { ok: true; runId: number; obj: number } | { ok: false; reason: 'glyph-missing' } {
    const m = this.mem;
    // E-081: una línea vacía no se escribe (bloquea el WASM).
    if (newText === '') return { ok: false, reason: 'glyph-missing' };

    // Color de relleno original (RGBA 0-255, out uints).
    const r = m.malloc(4), g = m.malloc(4), b = m.malloc(4), a = m.malloc(4);
    this.p.FPDFPageObj_GetFillColor(obj, r, g, b, a);
    const fillColor: [number, number, number, number] = [m.getValue(r, 'i32'), m.getValue(g, 'i32'), m.getValue(b, 'i32'), m.getValue(a, 'i32')];
    [r, g, b, a].forEach((ptr) => m.free(ptr));

    // Color de trazo, si el objeto original lo tiene (la mayoría de texto no
    // tiene trazo propio: FPDFPageObj_GetStrokeColor devuelve false y no se
    // copia nada — el objeto nuevo se queda con su trazo por defecto).
    let strokeColor: [number, number, number, number] | null = null;
    {
      const sr = m.malloc(4), sg = m.malloc(4), sb = m.malloc(4), sa = m.malloc(4);
      const leido = this.p.FPDFPageObj_GetStrokeColor(obj, sr, sg, sb, sa);
      if (leido) strokeColor = [m.getValue(sr, 'i32'), m.getValue(sg, 'i32'), m.getValue(sb, 'i32'), m.getValue(sa, 'i32')];
      [sr, sg, sb, sa].forEach((ptr) => m.free(ptr));
    }

    // Modo de render (normal/invisible/trazo/...): FPDFTextObj_GetTextRenderMode
    // devuelve un entero de la enumeración FPDF_TEXT_RENDERMODE (-1 si falla).
    const renderMode = this.p.FPDFTextObj_GetTextRenderMode(obj);

    // Matriz completa original (FS_MATRIX: a,b,c,d,e,f — 6 floats de 4 bytes,
    // contiguos): posición, escala, rotación y sesgo. Se copia tal cual al
    // objeto nuevo para que la línea no se mueva ni un punto (E-030).
    const getMatBuf = m.malloc(24);
    this.p.FPDFPageObj_GetMatrix(obj, getMatBuf);
    const mat = [0, 4, 8, 12, 16, 20].map((off) => m.getValue(getMatBuf + off, 'float'));
    m.free(getMatBuf);

    const newObj = newObjFactory();

    this.escribirTexto(newObj, newText);
    this.p.FPDFPageObj_SetFillColor(newObj, fillColor[0], fillColor[1], fillColor[2], fillColor[3]);
    if (strokeColor) this.p.FPDFPageObj_SetStrokeColor(newObj, strokeColor[0], strokeColor[1], strokeColor[2], strokeColor[3]);
    if (renderMode >= 0) this.p.FPDFTextObj_SetTextRenderMode(newObj, renderMode);
    const setMatBuf = m.malloc(24);
    mat.forEach((v, i) => m.setValue(setMatBuf + i * 4, v, 'float'));
    this.p.FPDFPageObj_SetMatrix(newObj, setMatBuf);
    m.free(setMatBuf);

    // Elimina el original: RemoveObject transfiere la propiedad al llamante
    // (igual que deleteRun), así que hay que destruirlo.
    this.p.FPDFPage_RemoveObject(page, obj);
    this.p.FPDFPageObj_Destroy(obj);

    // Inserta el nuevo EN LA MISMA POSICIÓN del orden de dibujo (z-order):
    // tras quitar el original, el índice `runId` quedó libre (todo lo
    // posterior se desplazó una posición hacia abajo); reinsertar ahí lo
    // devuelve exactamente a su sitio en la pila de dibujo. Si el build de
    // PDFium no lo permite (devuelve false), se añade al final — esa línea
    // pasa a dibujarse por encima de todo lo demás en vez de en su lugar
    // original; solo se nota si otro objeto se solapa visualmente con ella,
    // caso raro para una línea de texto suelta.
    let newRunId = runId;
    const insertedAtIndex = this.p.FPDFPage_InsertObjectAtIndex(page, newObj, runId);
    if (!insertedAtIndex) {
      this.p.FPDFPage_InsertObject(page, newObj);
      newRunId = this.p.FPDFPage_CountObjects(page) - 1;
    }

    // E-079: se relee lo escrito; si no coincide, no se genera contenido (el llamante cierra la página y el cambio,
    // incluido el borrado del original, se descarta).
    if (!this.textoEscritoCoincide(page, newObj, newText)) return { ok: false, reason: 'glyph-missing' };

    return { ok: true, runId: newRunId, obj: newObj };
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

  moveRuns(doc: DocHandle, pageIndex: number, runIds: readonly number[], dxPt: number, dyPt: number): boolean {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const objs = runIds.map((id) => this.p.FPDFPage_GetObject(page, id));
      if (objs.length === 0 || objs.some((o) => !o || this.p.FPDFPageObj_GetType(o) !== FPDF_PAGEOBJ_TEXT)) return false;
      for (const o of objs) this.p.FPDFPageObj_Transform(o, 1, 0, 0, 1, dxPt, dyPt); // traslación pura
      this.p.FPDFPage_GenerateContent(page);
      return true;
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  deleteRuns(doc: DocHandle, pageIndex: number, runIds: readonly number[]): number {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      // Primero los handles (los índices se desplazan al borrar), luego se eliminan.
      const objs = runIds.map((id) => this.p.FPDFPage_GetObject(page, id)).filter((o) => o && this.p.FPDFPageObj_GetType(o) === FPDF_PAGEOBJ_TEXT);
      let borrados = 0;
      for (const o of objs) {
        if (!this.p.FPDFPage_RemoveObject(page, o)) continue;
        this.p.FPDFPageObj_Destroy(o);
        borrados++;
      }
      if (borrados > 0) this.p.FPDFPage_GenerateContent(page);
      return borrados;
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
    const [res] = this.applyPageOps(doc, pageIndex, [{ type: 'insertText', spec }]);
    return (res as Extract<PageOpResult, { type: 'insertText' }>).runId;
  }

  insertImage(doc: DocHandle, pageIndex: number, spec: InsertImageSpec): boolean {
    const [res] = this.applyPageOps(doc, pageIndex, [{ type: 'insertImage', spec }]);
    return (res as Extract<PageOpResult, { type: 'insertImage' }>).ok;
  }

  /**
   * Crea el objeto de página IMAGEN para `spec`, sin insertarlo todavía (el
   * llamador decide en qué página y cuándo regenerar el contenido — usado
   * por `insertImage` suelto y por el caso `insertImage` de `applyPageOps`,
   * E-037: nunca un `FPDF_LoadPage`/`GenerateContent` por imagen cuando se
   * insertan varias en la misma página, p. ej. un DOCX con varias imágenes).
   */
  private crearObjetoImagen(doc: DocHandle, spec: InsertImageSpec): number {
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
      return obj;
    } finally {
      this.p.FPDFBitmap_Destroy(bmp);
    }
  }

  /** Objetos de página de tipo imagen, con su caja actual (puntos PDF, de `FPDFPageObj_GetBounds`). */
  listImageObjects(doc: DocHandle, pageIndex: number): { objIndex: number; rectPt: RectPt }[] {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const m = this.mem;
    const out: { objIndex: number; rectPt: RectPt }[] = [];
    try {
      const n = this.p.FPDFPage_CountObjects(page);
      for (let i = 0; i < n; i++) {
        const obj = this.p.FPDFPage_GetObject(page, i);
        if (this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_IMAGE) continue;
        const l = m.malloc(4), bo = m.malloc(4), ri = m.malloc(4), to = m.malloc(4);
        this.p.FPDFPageObj_GetBounds(obj, l, bo, ri, to);
        const left = m.getValue(l, 'float'), bottom = m.getValue(bo, 'float');
        const right = m.getValue(ri, 'float'), top = m.getValue(to, 'float');
        [l, bo, ri, to].forEach((ptr) => m.free(ptr));
        out.push({ objIndex: i, rectPt: { xPt: left, yPt: bottom, wPt: right - left, hPt: top - bottom } });
      }
    } finally {
      this.p.FPDF_ClosePage(page);
    }
    return out;
  }

  /**
   * Fija la matriz del objeto IMAGEN en `objIndex` a `[wPt 0 0 hPt xPt yPt]`
   * (mismo mapeo del cuadrado unidad que usa `insertImage`). Fase 1: si la
   * matriz actual tiene rotación/sesgo (b≠0 o c≠0), no la toca — devuelve
   * `false` sin modificar nada, documentado en el contrato de `PdfEngine`.
   */
  setObjectRect(doc: DocHandle, pageIndex: number, objIndex: number, rectPt: RectPt): boolean {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const m = this.mem;
    try {
      const obj = this.p.FPDFPage_GetObject(page, objIndex);
      if (!obj || this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_IMAGE) return false;

      const getBuf = m.malloc(24);
      this.p.FPDFPageObj_GetMatrix(obj, getBuf);
      const b = m.getValue(getBuf + 4, 'float');
      const c = m.getValue(getBuf + 8, 'float');
      m.free(getBuf);
      if (Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6) return false; // rotada/sesgada: fuera de alcance de esta fase

      const setBuf = m.malloc(24);
      const vals = [rectPt.wPt, 0, 0, rectPt.hPt, rectPt.xPt, rectPt.yPt];
      vals.forEach((v, i) => m.setValue(setBuf + i * 4, v, 'float'));
      this.p.FPDFPageObj_SetMatrix(obj, setBuf);
      m.free(setBuf);
      this.p.FPDFPage_GenerateContent(page);
      return true;
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  /**
   * Carga TODAS las páginas del documento y devuelve el puntero al array
   * (para pasarlo tal cual a `FPDFImageObj_SetBitmap`/`LoadJpegFileInline`,
   * que lo piden para poder invalidar el caché de render de cualquier
   * página que comparta el objeto imagen que se está sustituyendo) junto
   * con los handles, reutilizando `keepOpenPage` (ya cargado por el
   * llamante) en su propio índice en vez de volver a cargarlo. Liberar
   * SIEMPRE con `freeAllPagesArray` en un `finally`.
   */
  private loadAllPagesArray(doc: DocHandle, keepOpenPageIndex: number, keepOpenPage: number): { pagesPtr: number; handles: number[] } {
    const m = this.mem;
    const count = Math.max(1, this.p.FPDF_GetPageCount(doc));
    const handles: number[] = [];
    const pagesPtr = m.malloc(count * 4);
    for (let i = 0; i < count; i++) {
      const pg = i === keepOpenPageIndex ? keepOpenPage : this.p.FPDF_LoadPage(doc, i);
      handles.push(pg);
      m.setValue(pagesPtr + i * 4, pg, 'i32');
    }
    return { pagesPtr, handles };
  }

  /** Contraparte de `loadAllPagesArray`: libera el array y cierra todas las páginas salvo la que ya tenía abierta el llamante. */
  private freeAllPagesArray(pagesPtr: number, handles: number[], keepOpenPageIndex: number): void {
    this.mem.free(pagesPtr);
    handles.forEach((pg, i) => { if (i !== keepOpenPageIndex) this.p.FPDF_ClosePage(pg); });
  }

  /**
   * Píxeles RGBA del objeto IMAGEN en `objIndex`, a su resolución nativa.
   * Ver JSDoc del contrato (`PdfEngine.getImagePixels`).
   */
  getImagePixels(doc: DocHandle, pageIndex: number, objIndex: number): ImagePixels | null {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const heap = this.mem.HEAPU8;
    try {
      const obj = this.p.FPDFPage_GetObject(page, objIndex);
      if (!obj || this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_IMAGE) return null;
      const bmp = this.p.FPDFImageObj_GetBitmap(obj);
      if (!bmp) return null;
      try {
        const width = this.p.FPDFBitmap_GetWidth(bmp);
        const height = this.p.FPDFBitmap_GetHeight(bmp);
        const stride = this.p.FPDFBitmap_GetStride(bmp);
        const format = this.p.FPDFBitmap_GetFormat(bmp);
        const buf = this.p.FPDFBitmap_GetBuffer(bmp);
        if (width <= 0 || height <= 0 || !buf) return null;

        // FPDFImageObj_GetBitmap da el bitmap de COLOR a resolución NATIVA,
        // pero NUNCA compone la máscara de transparencia (/SMask o /Mask):
        // comprobado contra el motor real, una imagen con alfa real vuelve
        // aquí con sus 4 píxeles en 255 (opaco), aunque el propio formato
        // sea BGRA. Por eso el alfa se llena primero a 255 (placeholder) y
        // se sustituye más abajo por el de FPDFImageObj_GetRenderedBitmap,
        // que SÍ compone la máscara (verificado con un caso 255/0 conocido:
        // los 4 cuadrantes de un 2×2 con solo el primer píxel opaco salen
        // [255,0,0,0]).
        const rgba = new Uint8Array(width * height * 4);
        if (format === FPDFBitmap_BGRA) {
          for (let y = 0; y < height; y++) {
            const row = buf + y * stride;
            for (let x = 0; x < width; x++) {
              const s = row + x * 4, d = (y * width + x) * 4;
              rgba[d] = heap[s + 2]!; rgba[d + 1] = heap[s + 1]!; rgba[d + 2] = heap[s]!; rgba[d + 3] = 255;
            }
          }
        } else if (format === FPDFBitmap_BGRx) {
          for (let y = 0; y < height; y++) {
            const row = buf + y * stride;
            for (let x = 0; x < width; x++) {
              const s = row + x * 4, d = (y * width + x) * 4;
              rgba[d] = heap[s + 2]!; rgba[d + 1] = heap[s + 1]!; rgba[d + 2] = heap[s]!; rgba[d + 3] = 255;
            }
          }
        } else if (format === FPDFBitmap_BGR) {
          // 3 bytes/píxel, sin alfa: el formato que PDFium usa de hecho para
          // CUALQUIER imagen SIN transparencia real tras pasar por
          // FPDFImageObj_SetBitmap/insertImage — el caso más común con
          // diferencia (cualquier foto o página escaneada opaca). No estaba
          // en la lista original del contrato (solo BGRA/BGRx/Gray); se
          // añadió al comprobarlo contra el motor real: sin esto,
          // getImagePixels devolvía null para casi cualquier imagen normal.
          for (let y = 0; y < height; y++) {
            const row = buf + y * stride;
            for (let x = 0; x < width; x++) {
              const s = row + x * 3, d = (y * width + x) * 4;
              rgba[d] = heap[s + 2]!; rgba[d + 1] = heap[s + 1]!; rgba[d + 2] = heap[s]!; rgba[d + 3] = 255;
            }
          }
        } else if (format === FPDFBitmap_Gray) {
          for (let y = 0; y < height; y++) {
            const row = buf + y * stride;
            for (let x = 0; x < width; x++) {
              const g = heap[row + x]!, d = (y * width + x) * 4;
              rgba[d] = g; rgba[d + 1] = g; rgba[d + 2] = g; rgba[d + 3] = 255;
            }
          }
        } else {
          return null; // formato no soportado por ninguno de los 4 casos anteriores
        }

        // Alfa REAL: FPDFImageObj_GetRenderedBitmap sí compone la máscara,
        // pero a la resolución de COLOCACIÓN en la página (p. ej. una imagen
        // nativa de 8×6 puesta en una caja de 80×60pt puede volver como
        // 80×60), no la nativa — por eso solo se usa para el canal alfa,
        // remuestreado al tamaño nativo por vecino más cercano (basta para
        // una máscara de transparencia; no es una imagen de color que deba
        // verse nítida). Si falla o no aporta un formato con alfa, el
        // bitmap se queda opaco (el valor por defecto puesto arriba).
        const rendBmp = this.p.FPDFImageObj_GetRenderedBitmap(doc, page, obj);
        if (rendBmp) {
          try {
            const rw = this.p.FPDFBitmap_GetWidth(rendBmp);
            const rh = this.p.FPDFBitmap_GetHeight(rendBmp);
            const rformat = this.p.FPDFBitmap_GetFormat(rendBmp);
            if (rw > 0 && rh > 0 && rformat === FPDFBitmap_BGRA) {
              const rstride = this.p.FPDFBitmap_GetStride(rendBmp);
              const rbuf = this.p.FPDFBitmap_GetBuffer(rendBmp);
              for (let y = 0; y < height; y++) {
                const ry = Math.min(rh - 1, Math.floor((y * rh) / height));
                const rrow = rbuf + ry * rstride;
                for (let x = 0; x < width; x++) {
                  const rx = Math.min(rw - 1, Math.floor((x * rw) / width));
                  rgba[(y * width + x) * 4 + 3] = heap[rrow + rx * 4 + 3]!;
                }
              }
            }
          } finally {
            this.p.FPDFBitmap_Destroy(rendBmp);
          }
        }

        return { rgba, width, height };
      } finally {
        this.p.FPDFBitmap_Destroy(bmp);
      }
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  /**
   * Sustituye los píxeles del objeto IMAGEN en `objIndex` conservando su
   * matriz actual (posición/tamaño en la página). Ver JSDoc del contrato.
   */
  replaceImagePixels(doc: DocHandle, pageIndex: number, objIndex: number, rgba: Uint8Array, width: number, height: number): boolean {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const m = this.mem;
    try {
      const obj = this.p.FPDFPage_GetObject(page, objIndex);
      if (!obj || this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_IMAGE) return false;

      // Mismo volcado BGRA que insertImage, sobre un bitmap del tamaño NUEVO
      // (puede no coincidir con el de la imagen anterior: SetBitmap sustituye
      // el bitmap entero, no lo redimensiona en sitio).
      const bmp = this.p.FPDFBitmap_Create(width, height, 1);
      try {
        const stride = this.p.FPDFBitmap_GetStride(bmp);
        const buf = this.p.FPDFBitmap_GetBuffer(bmp);
        const heap = m.HEAPU8;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const s = (y * width + x) * 4;
            const d = buf + y * stride + x * 4;
            heap[d] = rgba[s + 2]!; heap[d + 1] = rgba[s + 1]!; heap[d + 2] = rgba[s]!; heap[d + 3] = rgba[s + 3]!;
          }
        }

        const { pagesPtr, handles } = this.loadAllPagesArray(doc, pageIndex, page);
        try {
          const ok = this.p.FPDFImageObj_SetBitmap(pagesPtr, handles.length, obj, bmp);
          if (!ok) return false;
          this.p.FPDFPage_GenerateContent(page);
          return true;
        } finally {
          this.freeAllPagesArray(pagesPtr, handles, pageIndex);
        }
      } finally {
        this.p.FPDFBitmap_Destroy(bmp);
      }
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  /**
   * Sustituye el objeto IMAGEN en `objIndex` por un JPEG ya codificado
   * (`jpegBytes`), conservando su matriz actual. Ver JSDoc del contrato.
   */
  replaceImageJpeg(doc: DocHandle, pageIndex: number, objIndex: number, jpegBytes: Uint8Array): boolean {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const m = this.mem;
    let jpegPtr = 0;
    let cb = -1;
    let fa = 0;
    try {
      const obj = this.p.FPDFPage_GetObject(page, objIndex);
      if (!obj || this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_IMAGE) return false;

      jpegPtr = m.copyIn(jpegBytes);
      // FPDF_FILEACCESS.m_GetBlock: int(*)(void* param, unsigned long position,
      // unsigned char* pBuf, unsigned long size) → 1 si copió `size` bytes
      // desde `position` a `pBuf`, 0 si falló. Firma Emscripten 'iiiii'
      // (retorno + 4 argumentos). `jpegPtr` viene del closure, no de `param`
      // (que PDFium rellena con FPDF_FILEACCESS.m_Param, sin usar aquí).
      cb = m.addFunction((_param: number, position: number, pBufPtr: number, size: number): number => {
        m.HEAPU8.set(m.HEAPU8.subarray(jpegPtr + position, jpegPtr + position + size), pBufPtr);
        return 1;
      }, 'iiiii');

      // FPDF_FILEACCESS (12 bytes, wasm32 sin padding): m_FileLen (i32) @0,
      // m_GetBlock (puntero a función) @4, m_Param (i32) @8 — mismo patrón de
      // struct-a-mano que FPDF_FILEWRITE en save() (8 bytes: version + WriteBlock).
      fa = m.malloc(12);
      m.setValue(fa, jpegBytes.length, 'i32');
      m.setValue(fa + 4, cb, 'i32');
      m.setValue(fa + 8, 0, 'i32');

      const { pagesPtr, handles } = this.loadAllPagesArray(doc, pageIndex, page);
      try {
        // LoadJpegFileInline conserva el JPEG tal cual (stream DCTDecode) en
        // vez de decodificar y recomprimir (LoadJpegFile sin "Inline" sí lo haría).
        const ok = this.p.FPDFImageObj_LoadJpegFileInline(pagesPtr, handles.length, obj, fa);
        if (!ok) return false;
        this.p.FPDFPage_GenerateContent(page);
        return true;
      } finally {
        this.freeAllPagesArray(pagesPtr, handles, pageIndex);
      }
    } finally {
      if (fa) m.free(fa);
      if (cb >= 0) m.removeFunction(cb);
      if (jpegPtr) m.free(jpegPtr);
      this.p.FPDF_ClosePage(page);
    }
  }

  /** Tamaño en bytes del stream de imagen tal como está codificado hoy. Ver JSDoc del contrato. */
  getImageRawSize(doc: DocHandle, pageIndex: number, objIndex: number): number | null {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const obj = this.p.FPDFPage_GetObject(page, objIndex);
      if (!obj || this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_IMAGE) return null;
      return this.p.FPDFImageObj_GetImageDataRaw(obj, 0, 0);
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  /** Elimina el objeto de página en `objIndex` (cualquier tipo). RemoveObject transfiere la propiedad al llamante: hay que destruirlo (igual que deleteRun). */
  deleteObject(doc: DocHandle, pageIndex: number, objIndex: number): boolean {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const obj = this.p.FPDFPage_GetObject(page, objIndex);
      if (!obj) return false;
      if (!this.p.FPDFPage_RemoveObject(page, obj)) return false;
      this.p.FPDFPageObj_Destroy(obj);
      this.p.FPDFPage_GenerateContent(page);
      return true;
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  addLink(doc: DocHandle, pageIndex: number, rectPt: RectPt, url: string): boolean {
    const [res] = this.applyPageOps(doc, pageIndex, [{ type: 'addLink', rect: rectPt, url }]);
    return (res as Extract<PageOpResult, { type: 'addLink' }>).ok;
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

  addMarkup(doc: DocHandle, pageIndex: number, tipo: MarkupKind, quads: readonly QuadPt[], color: [number, number, number], contenido = '', autor = ''): number {
    if (quads.length === 0) return -1;
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const subtipo = tipo === 'highlight' ? FPDF_ANNOT_HIGHLIGHT : tipo === 'underline' ? FPDF_ANNOT_UNDERLINE : FPDF_ANNOT_STRIKEOUT;
      const annot = this.p.FPDFPage_CreateAnnot(page, subtipo);
      if (!annot) return -1;
      try {
        // FS_QUADPOINTSF = 8 floats (x1,y1 .. x4,y4) en pt PDF de usuario; se añade uno por línea.
        const qptr = this.mem.malloc(32);
        try {
          for (const q of quads) {
            q.forEach((v, i) => this.mem.setValue(qptr + i * 4, v, 'float'));
            if (!this.p.FPDFAnnot_AppendAttachmentPoints(annot, qptr)) return -1;
          }
        } finally {
          this.mem.free(qptr);
        }
        // /Rect = envolvente de todos los quads (FS_RECTF {left, top, right, bottom}, pt PDF).
        const xs = quads.flatMap((q) => [q[0], q[2], q[4], q[6]]);
        const ys = quads.flatMap((q) => [q[1], q[3], q[5], q[7]]);
        const rptr = this.mem.malloc(16);
        this.mem.setValue(rptr, Math.min(...xs), 'float');
        this.mem.setValue(rptr + 4, Math.max(...ys), 'float');
        this.mem.setValue(rptr + 8, Math.max(...xs), 'float');
        this.mem.setValue(rptr + 12, Math.min(...ys), 'float');
        this.p.FPDFAnnot_SetRect(annot, rptr);
        this.mem.free(rptr);
        this.p.FPDFAnnot_SetColor(annot, FPDFANNOT_COLORTYPE_Color, color[0], color[1], color[2], 255);
        const poner = (clave: string, valor: string): void => {
          const w = this.mem.wide(valor);
          try { this.p.FPDFAnnot_SetStringValue(annot, clave, w); } finally { this.mem.free(w); }
        };
        if (contenido) poner('Contents', contenido);
        if (autor) poner('T', autor);
        poner('M', fechaPdf(new Date()));
        // Sin /AP PDFium no pinta el marcado (verificado en la investigación T11).
        this.p.EPDFAnnot_GenerateAppearance(annot);
      } finally {
        this.p.FPDFPage_CloseAnnot(annot);
      }
      return this.p.FPDFPage_GetAnnotCount(page) - 1; // la anotación creada es la última
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  getMarkupQuads(doc: DocHandle, pageIndex: number, index: number): QuadPt[] {
    return this.conAnotacion(doc, pageIndex, index, (annot) => {
      const out: QuadPt[] = [];
      const n = this.p.FPDFAnnot_CountAttachmentPoints(annot);
      const qptr = this.mem.malloc(32);
      try {
        for (let i = 0; i < n; i++) {
          if (!this.p.FPDFAnnot_GetAttachmentPoints(annot, i, qptr)) continue;
          out.push(Array.from({ length: 8 }, (_, k) => this.mem.getValue(qptr + k * 4, 'float')) as unknown as QuadPt);
        }
      } finally {
        this.mem.free(qptr);
      }
      return out;
    }) ?? [];
  }

  getMarkupColor(doc: DocHandle, pageIndex: number, index: number): [number, number, number] | null {
    return this.conAnotacion(doc, pageIndex, index, (annot) => {
      const ptr = this.mem.malloc(12); // 3 unsigned int: R, G, B (EPDFAnnot_GetColor; FPDFAnnot_GetColor falla con /AP generada)
      try {
        if (!this.p.EPDFAnnot_GetColor(annot, FPDFANNOT_COLORTYPE_Color, ptr, ptr + 4, ptr + 8)) return null;
        return [this.mem.getValue(ptr, 'i32'), this.mem.getValue(ptr + 4, 'i32'), this.mem.getValue(ptr + 8, 'i32')] as [number, number, number];
      } finally {
        this.mem.free(ptr);
      }
    }) ?? null;
  }

  /** Abre la anotación `index` de la página, ejecuta `fn` y la cierra siempre; null si no existe. */
  private conAnotacion<T>(doc: DocHandle, pageIndex: number, index: number, fn: (annot: number) => T): T | null {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      if (index < 0 || index >= this.p.FPDFPage_GetAnnotCount(page)) return null;
      const annot = this.p.FPDFPage_GetAnnot(page, index);
      if (!annot) return null;
      try { return fn(annot); } finally { this.p.FPDFPage_CloseAnnot(annot); }
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

  getComments(doc: DocHandle, pageIndex: number): CommentInfo[] {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const out: CommentInfo[] = [];
    try {
      const n = this.p.FPDFPage_GetAnnotCount(page);
      for (let i = 0; i < n; i++) {
        const annot = this.p.FPDFPage_GetAnnot(page, i);
        if (!annot) continue;
        try {
          const sub = this.p.FPDFAnnot_GetSubtype(annot);
          if (sub === FPDF_ANNOT_LINK || sub === FPDF_ANNOT_POPUP || sub === FPDF_ANNOT_WIDGET) continue;
          // Patrón de dos llamadas: ver leerCadenaPdfium (E-028).
          const leer = (clave: string): string =>
            leerCadenaPdfium(this.mem, (buf, len) => this.p.FPDFAnnot_GetStringValue(annot, clave, buf, len), (ptr) => this.mem.readU16(ptr));
          const text = leer('Contents');
          const esMarcado = sub === FPDF_ANNOT_HIGHLIGHT || sub === FPDF_ANNOT_UNDERLINE || sub === FPDF_ANNOT_STRIKEOUT;
          if (sub !== FPDF_ANNOT_TEXT && !esMarcado && text === '') continue;
          const rectPtr = this.mem.malloc(16);
          this.p.FPDFAnnot_GetRect(annot, rectPtr);
          const left = this.mem.getValue(rectPtr, 'float');
          const top = this.mem.getValue(rectPtr + 4, 'float');
          const right = this.mem.getValue(rectPtr + 8, 'float');
          const bottom = this.mem.getValue(rectPtr + 12, 'float');
          this.mem.free(rectPtr);
          const kind: CommentKind =
            sub === FPDF_ANNOT_TEXT ? 'note'
            : sub === FPDF_ANNOT_HIGHLIGHT ? 'highlight'
            : sub === FPDF_ANNOT_UNDERLINE ? 'underline'
            : sub === FPDF_ANNOT_STRIKEOUT ? 'strikeout'
            : sub === FPDF_ANNOT_FREETEXT ? 'freetext'
            : 'other';
          out.push({ index: i, kind, text, author: leer('T'), rectPt: { xPt: left, yPt: bottom, wPt: right - left, hPt: top - bottom } });
        } finally {
          this.p.FPDFPage_CloseAnnot(annot);
        }
      }
    } finally {
      this.p.FPDF_ClosePage(page);
    }
    return out;
  }

  setNoteText(doc: DocHandle, pageIndex: number, index: number, text: string): boolean {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      if (index < 0 || index >= this.p.FPDFPage_GetAnnotCount(page)) return false;
      const annot = this.p.FPDFPage_GetAnnot(page, index);
      if (!annot) return false;
      try {
        const sub = this.p.FPDFAnnot_GetSubtype(annot);
        if (sub === FPDF_ANNOT_LINK || sub === FPDF_ANNOT_POPUP || sub === FPDF_ANNOT_WIDGET) return false;
        const wptr = this.mem.wide(text);
        try {
          return !!this.p.FPDFAnnot_SetStringValue(annot, 'Contents', wptr);
        } finally {
          this.mem.free(wptr);
        }
      } finally {
        this.p.FPDFPage_CloseAnnot(annot);
      }
    } finally {
      this.p.FPDF_ClosePage(page);
    }
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
    // Solo radio: el valor de exportación de ESTE widget (distingue qué widget
    // del grupo es, ya que `value`/`checked` son del campo compartido).
    const exportValue = kind === 'radio'
      ? leerCadenaPdfium(
          m,
          (buf, len) => this.p.FPDFAnnot_GetFormFieldExportValue(form, annot, buf, len),
          (ptr) => m.readU16(ptr)
        )
      : undefined;
    const options = this.readFormFieldOptions(form, annot, kind);
    const multiSelect = kind === 'list' && (flags & FPDF_FORMFLAG_CHOICE_MULTISELECT) !== 0;
    // FS_RECTF = {left, top, right, bottom} en puntos PDF (floats, 16 bytes), como en getNotes().
    const rectPtr = m.malloc(16);
    this.p.FPDFAnnot_GetRect(annot, rectPtr);
    const left = m.getValue(rectPtr, 'float'), top = m.getValue(rectPtr + 4, 'float');
    const right = m.getValue(rectPtr + 8, 'float'), bottom = m.getValue(rectPtr + 12, 'float');
    m.free(rectPtr);
    return {
      annotIndex, name, kind, value, checked, readOnly, options, multiSelect,
      rectPt: { xPt: left, yPt: bottom, wPt: right - left, hPt: top - bottom },
      ...(exportValue !== undefined ? { exportValue } : {})
    };
  }

  /** Opciones de un combo/lista (vacío para el resto de tipos). Ver `FormFieldOption`. */
  private readFormFieldOptions(form: number, annot: number, kind: FormFieldKind): FormFieldOption[] {
    if (kind !== 'combo' && kind !== 'list') return [];
    const m = this.mem;
    const n = this.p.FPDFAnnot_GetOptionCount(form, annot);
    const options: FormFieldOption[] = [];
    for (let i = 0; i < n; i++) {
      const label = leerCadenaPdfium(
        m,
        (buf, len) => this.p.FPDFAnnot_GetOptionLabel(form, annot, i, buf, len),
        (ptr) => m.readU16(ptr)
      );
      const selected = this.p.FPDFAnnot_IsOptionSelected(form, annot, i);
      options.push({ label, value: label, selected });
    }
    return options;
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

  /**
   * Selección de combo/lista. Dos mecanismos distintos según el TIPO de campo
   * —verificado empíricamente contra el motor real, porque ninguno de los dos
   * cubre todos los casos por sí solo—: la decisión es por `multiSelect`, NO
   * por `values.length`, porque el caso "vaciar una lista MultiSelect" (0
   * valores) solo funciona por la vía de índices (ver abajo).
   *
   * - Combo, o lista SIN el bit MultiSelect: `EPDFAnnot_SetFormFieldValue` con
   *   ese valor (o cadena vacía para "ninguno"; `values` no puede traer más
   *   de 1 en este caso, se valida antes). Directo y suficiente.
   * - Lista CON el bit MultiSelect (`/Ff` bit 22, `0x200000`), para 0, 1 o
   *   varios valores: hace falta `FORM_SetIndexSelected` por índice —
   *   `EPDFAnnot_SetFormFieldValue` solo admite una cadena, no puede expresar
   *   varias opciones a la vez, y confirmado que con una cadena vacía TAMPOCO
   *   sirve para vaciar una lista MultiSelect (a diferencia de un combo, donde
   *   sí limpia la selección): devuelve `false` y no cambia nada. Por eso se
   *   usa la vía de índices para los tres casos (0/1/N) en este tipo de
   *   campo, no solo para N>1. `FORM_SetIndexSelected` exige que el widget
   *   esté enfocado (`FORM_SetFocusedAnnot`) y el cambio no se aplica al
   *   campo hasta `FORM_ForceToKillFocus` (semántica de edición interactiva
   *   de PDFium, no un setter directo).
   */
  setFormChoice(doc: DocHandle, pageIndex: number, annotIndex: number, values: string[]): boolean {
    return this.withFormPage(doc, pageIndex, (page, form) => {
      if (!form) return false;
      const annot = this.p.FPDFPage_GetAnnot(page, annotIndex);
      if (!annot) return false;
      try {
        const kind = FPDF_FORMFIELD_KIND[this.p.FPDFAnnot_GetFormFieldType(form, annot)];
        if (kind !== 'combo' && kind !== 'list') return false;
        if (this.p.FPDFAnnot_GetFormFieldFlags(form, annot) & FPDF_FORMFLAG_READONLY) return false;
        const flags = this.p.FPDFAnnot_GetFormFieldFlags(form, annot);
        const multiSelect = kind === 'list' && (flags & FPDF_FORMFLAG_CHOICE_MULTISELECT) !== 0;
        if (values.length > 1 && !multiSelect) return false;

        if (multiSelect) {
          const wanted = new Set(values);
          const n = this.p.FPDFAnnot_GetOptionCount(form, annot);
          this.p.FORM_SetFocusedAnnot(form, annot);
          for (let i = 0; i < n; i++) {
            const label = leerCadenaPdfium(
              this.mem,
              (buf, len) => this.p.FPDFAnnot_GetOptionLabel(form, annot, i, buf, len),
              (ptr) => this.mem.readU16(ptr)
            );
            this.p.FORM_SetIndexSelected(form, page, i, wanted.has(label));
          }
          this.p.FORM_ForceToKillFocus(form);
        } else {
          const wptr = this.mem.wide(values[0] ?? '');
          const ok = this.p.EPDFAnnot_SetFormFieldValue(form, annot, wptr);
          this.mem.free(wptr);
          if (!ok) return false;
        }
        this.p.EPDFAnnot_GenerateFormFieldAP(annot);
        return true;
      } finally {
        this.p.FPDFPage_CloseAnnot(annot);
      }
    });
  }

  /**
   * Marca este widget de radio dentro de su grupo. `EPDFAnnot_SetFormFieldValue`
   * con el `exportValue` PROPIO del widget basta: verificado que actualiza el
   * `/V` del campo (compartido por el grupo) y refleja correctamente el estado
   * marcado/desmarcado del resto de widgets hermanos sin tocarlos uno a uno
   * (persiste igual tras guardar y reabrir).
   */
  setFormRadio(doc: DocHandle, pageIndex: number, annotIndex: number): boolean {
    return this.withFormPage(doc, pageIndex, (page, form) => {
      if (!form) return false;
      const annot = this.p.FPDFPage_GetAnnot(page, annotIndex);
      if (!annot) return false;
      try {
        if (FPDF_FORMFIELD_KIND[this.p.FPDFAnnot_GetFormFieldType(form, annot)] !== 'radio') return false;
        if (this.p.FPDFAnnot_GetFormFieldFlags(form, annot) & FPDF_FORMFLAG_READONLY) return false;
        const exportValue = leerCadenaPdfium(
          this.mem,
          (buf, len) => this.p.FPDFAnnot_GetFormFieldExportValue(form, annot, buf, len),
          (ptr) => this.mem.readU16(ptr)
        );
        const wptr = this.mem.wide(exportValue);
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

  /**
   * Deja el grupo de radio (al que pertenece `annotIndex`, sea cual sea su
   * estado) sin ningún widget marcado. "Off" es el nombre de estado reservado
   * por la especificación PDF para "sin marcar" (32000-1 §12.7.4.2.3) y ningún
   * widget del grupo puede tener ese nombre como su propio valor de
   * exportación real, así que fijarlo en cualquier widget del grupo limpia el
   * campo entero (comprobado igual que en `setFormRadio`).
   */
  clearFormRadio(doc: DocHandle, pageIndex: number, annotIndex: number): boolean {
    return this.withFormPage(doc, pageIndex, (page, form) => {
      if (!form) return false;
      const annot = this.p.FPDFPage_GetAnnot(page, annotIndex);
      if (!annot) return false;
      try {
        if (FPDF_FORMFIELD_KIND[this.p.FPDFAnnot_GetFormFieldType(form, annot)] !== 'radio') return false;
        if (this.p.FPDFAnnot_GetFormFieldFlags(form, annot) & FPDF_FORMFLAG_READONLY) return false;
        const wptr = this.mem.wide('Off');
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
    const [res] = this.applyPageOps(doc, pageIndex, [{ type: 'fillRect', rect, color }]);
    return (res as Extract<PageOpResult, { type: 'fillRect' }>).ok;
  }

  drawStroke(doc: DocHandle, pageIndex: number, points: { xPt: number; yPt: number }[], color: [number, number, number], widthPt: number): boolean {
    const [res] = this.applyPageOps(doc, pageIndex, [{ type: 'drawStroke', points, color, widthPt }]);
    return (res as Extract<PageOpResult, { type: 'drawStroke' }>).ok;
  }

  /** Rectángulo solo borde (sin relleno); ver el contrato en PdfEngine.ts. */
  drawRect(doc: DocHandle, pageIndex: number, rect: RectPt, color: [number, number, number], widthPt: number): boolean {
    const [res] = this.applyPageOps(doc, pageIndex, [{ type: 'drawRect', rect, color, widthPt }]);
    return (res as Extract<PageOpResult, { type: 'drawRect' }>).ok;
  }

  /**
   * Núcleo compartido de `insertText`, `fillRect`,
   * `drawStroke` y `drawRect` (E-037, docs/ERRORES-CONOCIDOS.md): carga la
   * página UNA vez, crea el objeto de cada op sin regenerar el contenido
   * entre medias, y solo al final —si al menos una op mutó de verdad la
   * página— llama a `FPDFPage_GenerateContent()` una sola vez. Cada método
   * unitario delega aquí con un array de un solo elemento, así que esta es
   * la ÚNICA implementación real de cada tipo de op; no hay lógica
   * duplicada entre la ruta "una op" y la ruta "en lote".
   */
  applyPageOps(doc: DocHandle, pageIndex: number, ops: PageOp[]): PageOpResult[] {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      const results: PageOpResult[] = [];
      let mutado = false;
      for (const op of ops) {
        switch (op.type) {
          case 'insertText': {
            const spec = op.spec;
            if (spec.text === '') throw new Error('insertText: el texto está vacío (SetText vacío bloquea el motor, E-081).');
            const obj = this.p.FPDFPageObj_NewTextObj(doc, spec.fontName ?? 'Helvetica', spec.sizePt);
            this.escribirTexto(obj, spec.text);
            const [r, g, b] = spec.color ?? [0, 0, 0];
            const alfa = Math.round(255 * Math.min(1, Math.max(0, spec.opacidad ?? 1)));
            this.p.FPDFPageObj_SetFillColor(obj, r, g, b, alfa);
            if (spec.giroGrados) {
              const t = (spec.giroGrados * Math.PI) / 180;
              // Giro antihorario alrededor del origen y luego traslación a (xPt, yPt), puntos PDF.
              this.p.FPDFPageObj_Transform(obj, Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), spec.xPt, spec.yPt);
            } else {
              this.p.FPDFPageObj_Transform(obj, 1, 0, 0, 1, spec.xPt, spec.yPt);
            }
            if (spec.invisible) this.p.FPDFTextObj_SetTextRenderMode(obj, 3); // 3 = invisible (OCR)
            let runId: number;
            if (spec.alFondo && this.p.FPDFPage_InsertObjectAtIndex(page, obj, 0)) {
              runId = 0;
            } else {
              this.p.FPDFPage_InsertObject(page, obj);
              runId = this.p.FPDFPage_CountObjects(page) - 1;
            }
            if (spec.marca) this.marcarArtefacto(doc, obj, spec.marca);
            mutado = true;
            results.push({ type: 'insertText', runId });
            break;
          }
          case 'fillRect': {
            const obj = this.p.FPDFPageObj_CreateNewRect(op.rect.xPt, op.rect.yPt, op.rect.wPt, op.rect.hPt);
            this.p.FPDFPath_SetDrawMode(obj, 2, false); // 2 = relleno por winding, sin trazo
            const [r, g, b] = op.color;
            this.p.FPDFPageObj_SetFillColor(obj, r, g, b, 255);
            // Blend normal (sin SetBlendMode): rectángulo opaco, base de subrayado/tachado.
            this.p.FPDFPage_InsertObject(page, obj);
            mutado = true;
            results.push({ type: 'fillRect', ok: true });
            break;
          }
          case 'drawStroke': {
            if (op.points.length < 2) { results.push({ type: 'drawStroke', ok: false }); break; }
            const path = this.p.FPDFPageObj_CreateNewPath(op.points[0]!.xPt, op.points[0]!.yPt);
            for (let i = 1; i < op.points.length; i++) this.p.FPDFPath_LineTo(path, op.points[i]!.xPt, op.points[i]!.yPt);
            const [r, g, b] = op.color;
            this.p.FPDFPageObj_SetStrokeColor(path, r, g, b, 255);
            this.p.FPDFPageObj_SetStrokeWidth(path, op.widthPt);
            this.p.FPDFPath_SetDrawMode(path, 0, true); // sin relleno, con trazo
            this.p.FPDFPage_InsertObject(page, path);
            mutado = true;
            results.push({ type: 'drawStroke', ok: true });
            break;
          }
          case 'drawRect': {
            if (op.rect.wPt < 3 || op.rect.hPt < 3) { results.push({ type: 'drawRect', ok: false }); break; } // fue un clic, no un arrastre real
            const obj = this.p.FPDFPageObj_CreateNewRect(op.rect.xPt, op.rect.yPt, op.rect.wPt, op.rect.hPt);
            this.p.FPDFPath_SetDrawMode(obj, 0, true); // 0 = sin relleno, con trazo
            const [r, g, b] = op.color;
            this.p.FPDFPageObj_SetStrokeColor(obj, r, g, b, 255);
            this.p.FPDFPageObj_SetStrokeWidth(obj, op.widthPt);
            this.p.FPDFPage_InsertObject(page, obj);
            mutado = true;
            results.push({ type: 'drawRect', ok: true });
            break;
          }
          case 'insertImage': {
            const obj = this.crearObjetoImagen(doc, op.spec);
            this.p.FPDFPage_InsertObject(page, obj);
            mutado = true;
            results.push({ type: 'insertImage', ok: true });
            break;
          }
          case 'addLink': {
            // Solo http:/https:/mailto: (validarUrlEnlace.ts): un PDF es
            // entrada no confiable, así que esta comprobación es la última
            // línea de defensa aunque el llamador (DOCX/Markdown) ya filtre
            // antes de construir el lote — mismo principio que E-003/E-027.
            const urlValida = validarUrlEnlace(op.url);
            if (!urlValida) { results.push({ type: 'addLink', ok: false }); break; }
            const annot = this.p.FPDFPage_CreateAnnot(page, FPDF_ANNOT_LINK);
            if (!annot) { results.push({ type: 'addLink', ok: false }); break; }
            try {
              // FS_RECTF = {left, top, right, bottom} en puntos PDF (floats, 16 bytes), igual que addNote/getNotes.
              const rectPtr = this.mem.malloc(16);
              this.mem.setValue(rectPtr, op.rect.xPt, 'float');
              this.mem.setValue(rectPtr + 4, op.rect.yPt + op.rect.hPt, 'float');
              this.mem.setValue(rectPtr + 8, op.rect.xPt + op.rect.wPt, 'float');
              this.mem.setValue(rectPtr + 12, op.rect.yPt, 'float');
              this.p.FPDFAnnot_SetRect(annot, rectPtr);
              this.mem.free(rectPtr);
              // Sin esto, PDFium (como la mayoría de visores) pinta el borde
              // POR DEFECTO de la anotación /Link (un rectángulo de 1pt
              // alrededor del texto) — nada que ver con el azul+subrayado
              // del propio texto, y nada profesional: Acrobat/Chrome/Word
              // generan siempre un borde invisible en sus enlaces, el
              // "aspecto" de enlace lo da el estilo del texto, no la caja
              // de la anotación.
              this.p.FPDFAnnot_SetBorder(annot, 0, 0, 0);
              // Acción /URI: EPDFAction_CreateURI crea la acción (marshaling
              // de "string" a cargo del propio binding, ver index.d.ts) y
              // EPDFAnnot_SetAction la asocia a la anotación /Link recién
              // creada. No hace falta FPDFPage_GenerateContent: una
              // anotación no vive en el flujo de contenido de la página.
              const action = this.p.EPDFAction_CreateURI(doc, urlValida);
              const ok = action ? this.p.EPDFAnnot_SetAction(annot, action) : false;
              results.push({ type: 'addLink', ok });
            } finally {
              this.p.FPDFPage_CloseAnnot(annot);
            }
            break;
          }
        }
      }
      if (mutado) this.p.FPDFPage_GenerateContent(page); // una sola vez, pase lo que pase el número de ops
      return results;
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  /** Añade `/Artifact <</PDFEditor valor>>` al objeto (contenido de marca; ver `InsertTextSpec.marca`). */
  private marcarArtefacto(doc: DocHandle, obj: number, valor: string): void {
    const mark = this.p.FPDFPageObj_AddMark(obj, 'Artifact');
    if (mark) this.p.FPDFPageObjMark_SetStringParam(doc, obj, mark, CLAVE_MARCA_EDITOR, valor);
  }

  /** Valor de `/PDFEditor` en la marca `/Artifact` del objeto, o null si no es nuestro. */
  private valorMarcaEditor(obj: number): string | null {
    const n = this.p.FPDFPageObj_CountMarks(obj);
    const m = this.mem;
    const out = m.malloc(4);
    try {
      for (let i = 0; i < n; i++) {
        const mark = this.p.FPDFPageObj_GetMark(obj, i);
        if (!mark) continue;
        const nombre = leerCadenaPdfium(
          m,
          (buf, len) => { this.p.FPDFPageObjMark_GetName(mark, buf, len, out); return m.getValue(out, 'i32'); },
          (ptr) => m.readU16(ptr)
        );
        if (nombre !== 'Artifact') continue;
        const valor = leerCadenaPdfium(
          m,
          (buf, len) => { this.p.FPDFPageObjMark_GetParamStringValue(mark, CLAVE_MARCA_EDITOR, buf, len, out); return m.getValue(out, 'i32'); },
          (ptr) => m.readU16(ptr)
        );
        if (valor) return valor;
      }
      return null;
    } finally {
      m.free(out);
    }
  }

  removeMarkedObjects(doc: DocHandle, pageIndex: number, valor?: string): number {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    try {
      let quitados = 0;
      // De atrás hacia delante: quitar un objeto reindexa los siguientes.
      for (let i = this.p.FPDFPage_CountObjects(page) - 1; i >= 0; i--) {
        const obj = this.p.FPDFPage_GetObject(page, i);
        if (!obj) continue;
        const v = this.valorMarcaEditor(obj);
        if (v === null || (valor !== undefined && v !== valor)) continue;
        if (this.p.FPDFPage_RemoveObject(page, obj)) { this.p.FPDFPageObj_Destroy(obj); quitados++; }
      }
      if (quitados > 0) this.p.FPDFPage_GenerateContent(page);
      return quitados;
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  /** Objetos PATH de la página, con su caja y si tienen trazo activo; ver el contrato en PdfEngine.ts. */
  listPathObjects(doc: DocHandle, pageIndex: number): { objIndex: number; rectPt: RectPt; hasStroke: boolean }[] {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const m = this.mem;
    const out: { objIndex: number; rectPt: RectPt; hasStroke: boolean }[] = [];
    try {
      const n = this.p.FPDFPage_CountObjects(page);
      for (let i = 0; i < n; i++) {
        const obj = this.p.FPDFPage_GetObject(page, i);
        if (this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_PATH) continue;
        const l = m.malloc(4), bo = m.malloc(4), ri = m.malloc(4), to = m.malloc(4);
        this.p.FPDFPageObj_GetBounds(obj, l, bo, ri, to);
        const left = m.getValue(l, 'float'), bottom = m.getValue(bo, 'float');
        const right = m.getValue(ri, 'float'), top = m.getValue(to, 'float');
        [l, bo, ri, to].forEach((ptr) => m.free(ptr));

        const fillPtr = m.malloc(4), strokePtr = m.malloc(4);
        this.p.FPDFPath_GetDrawMode(obj, fillPtr, strokePtr);
        const hasStroke = m.getValue(strokePtr, 'i32') !== 0;
        m.free(fillPtr); m.free(strokePtr);

        out.push({ objIndex: i, rectPt: { xPt: left, yPt: bottom, wPt: right - left, hPt: top - bottom }, hasStroke });
      }
    } finally {
      this.p.FPDF_ClosePage(page);
    }
    return out;
  }

  /** Aristas rectas del contorno del path; ver el contrato en PdfEngine.ts (unidades: puntos PDF, matriz del objeto ya aplicada). */
  getPathSegments(doc: DocHandle, pageIndex: number, objIndex: number): { ax: number; ay: number; bx: number; by: number }[] {
    const page = this.p.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error(`No se pudo cargar la página ${pageIndex}`);
    const m = this.mem;
    try {
      const obj = this.p.FPDFPage_GetObject(page, objIndex);
      if (!obj || this.p.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_PATH) return [];

      // Matriz completa del objeto (a,b,c,d,e,f): los puntos de segmento que
      // da PDFium están en el espacio LOCAL del path, hay que llevarlos al
      // espacio de página aplicando esta matriz (igual patrón que
      // swapTextObject/setObjectRect).
      const matBuf = m.malloc(24);
      this.p.FPDFPageObj_GetMatrix(obj, matBuf);
      const mat = [0, 4, 8, 12, 16, 20].map((off) => m.getValue(matBuf + off, 'float'));
      m.free(matBuf);
      const [a, b, c, dd, e, f] = mat as [number, number, number, number, number, number];
      const aplicar = (x: number, y: number): { x: number; y: number } => ({ x: a * x + c * y + e, y: b * x + dd * y + f });

      const n = this.p.FPDFPath_CountSegments(obj);
      const xPtr = m.malloc(4), yPtr = m.malloc(4);
      const puntos: { x: number; y: number }[] = [];
      const esMoveTo: boolean[] = [];
      const cierraAqui: boolean[] = [];
      for (let i = 0; i < n; i++) {
        const seg = this.p.FPDFPath_GetPathSegment(obj, i);
        this.p.FPDFPathSegment_GetPoint(seg, xPtr, yPtr);
        const lx = m.getValue(xPtr, 'float'), ly = m.getValue(yPtr, 'float');
        puntos.push(aplicar(lx, ly));
        esMoveTo.push(this.p.FPDFPathSegment_GetType(seg) === FPDF_SEGMENT_MOVETO);
        cierraAqui.push(this.p.FPDFPathSegment_GetClose(seg));
      }
      m.free(xPtr); m.free(yPtr);

      const segmentos: { ax: number; ay: number; bx: number; by: number }[] = [];
      let inicioSubtrazo = 0;
      for (let i = 1; i < puntos.length; i++) {
        if (esMoveTo[i]) { inicioSubtrazo = i; continue; }
        const p0 = puntos[i - 1]!, p1 = puntos[i]!;
        segmentos.push({ ax: p0.x, ay: p0.y, bx: p1.x, by: p1.y });
        if (cierraAqui[i]) {
          const inicio = puntos[inicioSubtrazo]!;
          segmentos.push({ ax: p1.x, ay: p1.y, bx: inicio.x, by: inicio.y });
        }
      }
      return segmentos;
    } finally {
      this.p.FPDF_ClosePage(page);
    }
  }

  save(doc: DocHandle): Uint8Array<ArrayBuffer> {
    const chunks: Uint8Array[] = [];
    // Igual que en replaceImageJpeg (§2.6, E-036): cada addFunction() ocupa
    // un slot nuevo de la tabla de funciones indirectas de WASM hasta que se
    // libera con removeFunction(). save() se llama muchísimo (cada comando
    // con deshacer por snapshot, además de exportar), así que sin el
    // removeFunction en el finally la tabla crece sin límite en cualquier
    // sesión de edición larga.
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
      this.mem.removeFunction(cb);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  /**
   * Guardado compacto (E-038): descarta los streams de contenido HUÉRFANOS
   * que fue dejando cada `FPDFPage_GenerateContent()` sobre este documento en
   * memoria. NO muta `doc` — guarda, abre una copia efímera desde esos bytes
   * (al analizarlos, el motor solo reconstruye lo alcanzable desde cada
   * página) y guarda esa copia. Mismo mecanismo, generalizado, que ya usaba
   * `ComprimirDocumentoCmd` con un `reload()` explícito para las imágenes
   * sustituidas.
   */
  async saveCompact(doc: DocHandle): Promise<Uint8Array<ArrayBuffer>> {
    const bytes = this.save(doc);
    const tmp = await this.open(bytes);
    try {
      return this.save(tmp);
    } finally {
      this.close(tmp);
    }
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

  measureText(fontName: string, sizePt: number, text: string): number {
    if (text.length === 0) return 0;
    if (this.measureFontDoc === null) this.measureFontDoc = this.p.FPDF_CreateNewDocument();
    let font = this.measureFontCache.get(fontName);
    if (font === undefined) {
      font = this.p.FPDFText_LoadStandardFont(this.measureFontDoc, fontName);
      this.measureFontCache.set(fontName, font);
    }
    const outPtr = this.mem.malloc(4); // float*
    try {
      let total = 0;
      // Recorre por punto de código (no por unidad UTF-16): un carácter fuera
      // del BMP no debe partirse en dos "glifos" de medio par subrogado.
      for (const ch of text) {
        const code = ch.codePointAt(0)!;
        this.mem.setValue(outPtr, 0, 'float');
        const ok = this.p.FPDFFont_GetGlyphWidth(font, code, sizePt, outPtr);
        if (ok) total += this.mem.getValue(outPtr, 'float');
      }
      return total;
    } finally {
      this.mem.free(outPtr);
    }
  }

  /**
   * Libera las fuentes estándar cacheadas por `measureText` y el documento
   * efímero que las aloja (`FPDFFont_Close` + `FPDF_CloseDocument`, §2.6).
   * No es parte del contrato `PdfEngine` (no hay un punto de "cierre de
   * sesión" del motor en la app: vive mientras vive la pestaña) — existe
   * para tests e higiene explícita. Segura de llamar aunque `measureText`
   * nunca se haya usado (no crea nada).
   */
  closeMeasureFonts(): void {
    for (const font of this.measureFontCache.values()) this.p.FPDFFont_Close(font);
    this.measureFontCache.clear();
    if (this.measureFontDoc !== null) { this.p.FPDF_CloseDocument(this.measureFontDoc); this.measureFontDoc = null; }
  }
}
