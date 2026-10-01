import type { Command, Ctx } from './Command';

/** Borra la anotación `annotIndex` (entre todas las de la página); deshacer por snapshot. */
export class RemoveNoteCmd implements Command {
  readonly id = 'remove-note';
  readonly label = 'Borrar nota';
  private before: Uint8Array<ArrayBuffer> | null = null;
  constructor(readonly pageIndex: number, readonly annotIndex: number) {}

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    c.engine.removeNote(c.doc, this.pageIndex, this.annotIndex);
    c.refreshPage(this.pageIndex);
  }
  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
