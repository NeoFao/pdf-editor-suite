import type { Command, Ctx } from './Command';

/** Elimina una página; deshacer por snapshot (restaura el documento previo). */
export class DeletePageCmd implements Command {
  readonly id = 'delete-page';
  readonly label = 'Eliminar página';
  private before: Uint8Array<ArrayBuffer> | null = null;
  constructor(readonly pageIndex: number) {}

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    c.engine.deletePage(c.doc, this.pageIndex);
    c.refresh();
  }
  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
