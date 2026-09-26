import { loadEngine, type Pdfium } from './loadEngine';
import { makeMem, type Mem } from './mem';
import type { PdfEngine, DocHandle, SizePt, TextRun } from '../PdfEngine';

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

  save(doc: DocHandle): Uint8Array {
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
