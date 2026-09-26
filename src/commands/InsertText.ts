import type { Command, Ctx } from './Command';
import type { InsertTextSpec } from '../engine/PdfEngine';

/** Inserta un texto nuevo, con deshacer por snapshot (restaura el documento previo). */
export class InsertTextCmd implements Command {
  readonly id = 'insert-text';
  readonly label = 'Insertar texto';
  private before: Uint8Array<ArrayBuffer> | null = null;

  constructor(readonly pageIndex: number, readonly spec: InsertTextSpec) {}

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    c.engine.insertText(c.doc, this.pageIndex, this.spec);
    c.refresh();
  }

  async undo(c: Ctx): Promise<void> {
    if (this.before) await c.reload(this.before);
  }
}
