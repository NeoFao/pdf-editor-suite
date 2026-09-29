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
  private readonly pageRebuiltListeners = new Set<ReloadCb>();

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

  /**
   * Suscribe específicamente a `refreshPage()` (no a `updateRunText`): la
   * señal de "esta página se RECONSTRUYÓ desde el motor, los índices de sus
   * runs pueden haber cambiado" — a diferencia de un simple editar-el-texto-
   * en-sitio, donde el runId seleccionado sigue siendo válido por
   * construcción. `App.reconcileSelectionAfterReload` se engancha aquí (y a
   * `onReload`) para no dejar la selección/panel de propiedades apuntando a
   * un run que ya no existe tras rotar/insertar/cambiar fuente… (E-043/
   * E-044, docs/ERRORES-CONOCIDOS.md) sin reconciliar también, de forma
   * indeseada, tras cada pulsación al editar texto (que si mirase 'change'
   * a secas, resetearía sin motivo `appliedFontLabel`).
   */
  onPageRebuilt(cb: ReloadCb): () => void {
    this.pageRebuiltListeners.add(cb);
    return () => this.pageRebuiltListeners.delete(cb);
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

  /**
   * Reemplaza LA PÁGINA entera (tamaño, rotación y runs) sin tocar el resto
   * del documento — el mecanismo de invalidación "por página" que evita
   * reconstruir las N páginas del documento cuando un comando (rotar,
   * insertar texto, dibujar…) solo tocó una (E-043/E-044,
   * docs/ERRORES-CONOCIDOS.md). Notifica DOS señales: 'change' (pageIndex) —
   * la misma que usan Viewer y la miniatura de `App` para repintar solo esa
   * página — y `onPageRebuilt` (sin pageIndex: quien la escucha, hoy solo la
   * reconciliación de selección, revisa su propio estado por su cuenta).
   */
  refreshPage(pageIndex: number, page: PageModel): void {
    if (pageIndex < 0 || pageIndex >= this._pages.length) return;
    this._pages[pageIndex] = page;
    this.emitChange(pageIndex);
    for (const cb of this.pageRebuiltListeners) cb();
  }

  /** Reemplaza todas las páginas (recarga completa del documento) y notifica. */
  reset(pages: PageModel[]): void {
    this._pages = pages;
    for (const cb of this.reloadListeners) cb();
  }
}
