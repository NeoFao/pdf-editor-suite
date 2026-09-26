import type { PdfEngine, DocHandle } from '../engine/PdfEngine';
import { DocumentModel } from './DocumentModel';
import type { PageModel } from './types';

/**
 * Sesión de edición: une motor + documento abierto + modelo, y sabe
 * reconstruir el modelo desde el documento (refresh) o recargar el documento
 * desde unos bytes (reload) — la base del deshacer por snapshot para las
 * operaciones que cambian el conjunto de objetos (borrar/insertar).
 *
 * Cumple el contrato Ctx que consumen los comandos.
 */
export class EditSession {
  private constructor(
    readonly engine: PdfEngine,
    public doc: DocHandle,
    readonly model: DocumentModel
  ) {}

  static buildPages(engine: PdfEngine, doc: DocHandle): PageModel[] {
    const pages: PageModel[] = [];
    const count = engine.pageCount(doc);
    for (let i = 0; i < count; i++) {
      pages.push({
        index: i,
        sizePt: engine.pageSize(doc, i),
        rotation: engine.pageRotation(doc, i),
        runs: engine.getPageText(doc, i)
      });
    }
    return pages;
  }

  static async open(engine: PdfEngine, bytes: Uint8Array): Promise<EditSession> {
    const doc = await engine.open(bytes);
    return new EditSession(engine, doc, new DocumentModel(EditSession.buildPages(engine, doc)));
  }

  /** Reconstruye el modelo desde el estado actual del documento. */
  refresh(): void {
    this.model.reset(EditSession.buildPages(this.engine, this.doc));
  }

  /** Recarga el documento desde unos bytes (snapshot) y reconstruye el modelo. */
  async reload(bytes: Uint8Array): Promise<void> {
    this.engine.close(this.doc);
    this.doc = await this.engine.open(bytes);
    this.refresh();
  }
}
