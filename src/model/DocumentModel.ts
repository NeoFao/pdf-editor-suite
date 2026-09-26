import type { PageModel, Selection } from './types';

type ChangeCb = (pageIndex: number) => void;
type ReloadCb = () => void;

/**
 * Estado del documento en memoria: proyección observable de las páginas y su
 * texto. Único sitio de verdad de la UI. No habla con el motor: los comandos
 * coordinan motor + modelo.
 */
export class DocumentModel {
  selection: Selection | null = null;
  private _pages: PageModel[];
  private readonly changeListeners = new Set<ChangeCb>();
  private readonly reloadListeners = new Set<ReloadCb>();

  constructor(pages: PageModel[]) {
    this._pages = pages;
  }

  get pages(): PageModel[] { return this._pages; }

  /** Suscribe a cambios de una página; devuelve la función para desuscribirse. */
  on(_event: 'change', cb: ChangeCb): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  /** Suscribe a una recarga completa (cambia el conjunto de páginas). */
  onReload(cb: ReloadCb): () => void {
    this.reloadListeners.add(cb);
    return () => this.reloadListeners.delete(cb);
  }

  private emitChange(pageIndex: number): void {
    for (const cb of this.changeListeners) cb(pageIndex);
  }

  /** Actualiza el texto de un run en la proyección y notifica. */
  updateRunText(pageIndex: number, runId: number, text: string): void {
    const page = this._pages[pageIndex];
    if (!page) return;
    const run = page.runs.find((r) => r.runId === runId);
    if (!run) return;
    run.text = text;
    this.emitChange(pageIndex);
  }

  /** Reemplaza los runs de una página (tras una operación que los reindexa). */
  setPageRuns(pageIndex: number, runs: PageModel['runs']): void {
    const page = this._pages[pageIndex];
    if (!page) return;
    page.runs = runs;
    this.emitChange(pageIndex);
  }

  /** Reemplaza todas las páginas (recarga completa del documento) y notifica. */
  reset(pages: PageModel[]): void {
    this._pages = pages;
    for (const cb of this.reloadListeners) cb();
  }
}
