import type { Command, Ctx } from './Command';

/** Redacción real de un run, con deshacer por snapshot (restaura el documento previo). */
export class DeleteRunCmd implements Command {
  readonly id = 'delete-run';
  readonly label = 'Borrar texto';
  private before: Uint8Array<ArrayBuffer> | null = null;

  constructor(readonly pageIndex: number, readonly runId: number) {}

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);           // snapshot previo
    c.engine.deleteRun(c.doc, this.pageIndex, this.runId);
    c.refreshPage(this.pageIndex);                  // el borrado reindexa runs DE ESTA página: solo hace falta recargarla a ella
  }

  async undo(c: Ctx): Promise<void> {
    if (this.before) await c.reload(this.before);
  }
}
