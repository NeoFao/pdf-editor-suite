import type { Command, Ctx } from './Command';

/** Inserta las páginas de otro PDF; deshacer por snapshot (restaura el documento previo). */
export class InsertPdfCmd implements Command {
  readonly id = 'insert-pdf';
  readonly label = 'Insertar PDF';
  private before: Uint8Array<ArrayBuffer> | null = null;

  constructor(readonly srcBytes: Uint8Array, readonly atIndex: number) {}

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    c.engine.importPages(c.doc, this.srcBytes, this.atIndex);
    c.refresh();
  }
  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
