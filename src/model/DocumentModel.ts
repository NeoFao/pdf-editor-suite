import type { PageModel, Selection } from './types';

type ChangeCb = (pageIndex: number) => void;

/**
 * Estado del documento en memoria: proyección observable de las páginas y su
 * texto. Único sitio de verdad de la UI. No habla con el motor: los comandos
 * coordinan motor + modelo.
 */
export class DocumentModel {
  selection: Selection | null = null;
  private readonly listeners = new Set<ChangeCb>();

  constructor(readonly pages: PageModel[]) {}

  /** Suscribe a cambios de una página; devuelve la función para desuscribirse. */
  on(_event: 'change', cb: ChangeCb): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emitChange(pageIndex: number): void {
    for (const cb of this.listeners) cb(pageIndex);
  }

  /** Actualiza el texto de un run en la proyección y notifica. */
  updateRunText(pageIndex: number, runId: number, text: string): void {
    const page = this.pages[pageIndex];
    if (!page) return;
    const run = page.runs.find((r) => r.runId === runId);
    if (!run) return;
    run.text = text;
    this.emitChange(pageIndex);
  }
}
