import type { Command, Ctx } from './Command';
import type { InsertImageSpec } from '../engine/PdfEngine';

/** Inserta una imagen; deshacer por snapshot (restaura el documento previo). */
export class InsertImageCmd implements Command {
  readonly id = 'insert-image';
  readonly label = 'Insertar imagen';
  private before: Uint8Array<ArrayBuffer> | null = null;
  constructor(readonly pageIndex: number, readonly spec: InsertImageSpec) {}

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    c.engine.insertImage(c.doc, this.pageIndex, this.spec);
    c.refresh();
  }
  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
