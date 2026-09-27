import type { Command, Ctx } from './Command';

/** Duplica una página; deshacer por snapshot (restaura el documento previo). */
export class DuplicatePageCmd implements Command {
  readonly id = 'duplicate-page';
  readonly label = 'Duplicar página';
  private before: Uint8Array<ArrayBuffer> | null = null;
  constructor(readonly pageIndex: number) {}

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    c.engine.duplicatePage(c.doc, this.pageIndex);
    c.refresh();
  }
  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
