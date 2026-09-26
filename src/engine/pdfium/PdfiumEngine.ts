import { loadEngine, type Pdfium } from './loadEngine';
import { makeMem, type Mem } from './mem';
import type { PdfEngine, DocHandle, SizePt } from '../PdfEngine';

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
