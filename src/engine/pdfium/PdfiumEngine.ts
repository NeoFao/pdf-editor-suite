import { loadEngine, type Pdfium } from './loadEngine';
import { makeMem, type Mem } from './mem';
import type { PdfEngine, DocHandle, SizePt, TextRun, EditResult, RenderResult, InsertTextSpec, RectPt } from '../PdfEngine';

const FPDF_PAGEOBJ_TEXT = 1;

/**
 * Implementación de PdfEngine sobre @embedpdf/pdfium (WASM).
 * FPDF_LoadMemDocument exige que el buffer de datos siga vivo mientras el
 * documento esté abierto: se guarda su puntero por documento y se libera al cerrar.
 */
export class PdfiumEngine implements PdfEngine {
  private readonly srcPtr = new Map<DocHandle, number>();

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
    return doc;
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
      this.p.FPDF_RenderPageBitmap(bmp, page, 0, 0, width, height, 0, 0);
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
    // Texto (UTF-16)
    const tbuf = m.malloc(1024);
    this.p.FPDFTextObj_GetText(obj, textPage, tbuf, 1024);
    const text = m.readU16(tbuf); m.free(tbuf);
    // Tamaño de fuente (out float)
    const fs = m.malloc(4); this.p.FPDFTextObj_GetFontSize(obj, fs);
    const sizePt = m.getValue(fs, 'float'); m.free(fs);
    // Nombre de fuente
    const font = this.p.FPDFTextObj_GetFont(obj);
    const nbuf = m.malloc(256); this.p.FPDFFont_GetBaseFontName(font, nbuf, 256);
    const fontName = m.UTF8ToString(nbuf); m.free(nbuf);
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
    return { runId, text, sizePt, fontName, color, boxPt: { xPt: left, yPt: bottom, wPt: right - left, hPt: top - bottom } };
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
      this.p.FPDFPage_InsertObject(page, obj);
      this.p.FPDFPage_GenerateContent(page);
      return this.p.FPDFPage_CountObjects(page) - 1; // el objeto insertado es el último
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
    this.p.FPDF_CloseDocument(doc);
    const ptr = this.srcPtr.get(doc);
    if (ptr !== undefined) { this.mem.free(ptr); this.srcPtr.delete(doc); }
  }
}
