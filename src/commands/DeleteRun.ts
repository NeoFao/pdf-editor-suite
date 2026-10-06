import type { Command, Ctx } from './Command';

/**
 * Redacción real de un run, con deshacer por snapshot (restaura el documento previo). Una línea editable compuesta
 * (N1) pasa `runIds` con TODOS sus objetos: se eliminan juntos, en una sola carga de página.
 */
export class DeleteRunCmd implements Command {
  readonly id = 'delete-run';
  readonly label = 'Borrar texto';
  private before: Uint8Array<ArrayBuffer> | null = null;
  readonly runIds: readonly number[];

  constructor(readonly pageIndex: number, readonly runId: number, runIds?: readonly number[]) {
    this.runIds = runIds && runIds.length > 0 ? runIds : [runId];
  }

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);           // snapshot previo
    if (this.runIds.length > 1) c.engine.deleteRuns(c.doc, this.pageIndex, this.runIds);
    else c.engine.deleteRun(c.doc, this.pageIndex, this.runId);
    c.refreshPage(this.pageIndex);                  // el borrado reindexa runs DE ESTA página: solo hace falta recargarla a ella
  }

  async undo(c: Ctx): Promise<void> {
    if (this.before) await c.reload(this.before);
  }
}
