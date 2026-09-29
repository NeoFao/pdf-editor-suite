import type { Command, Ctx } from './Command';

/**
 * Borra un objeto de página (una imagen: sello/firma insertados, #20/#21 de
 * la tabla de paridad). Deshacer por snapshot (restaura el documento
 * previo), igual que `DeleteRunCmd`: eliminar reindexa los objetos
 * posteriores, así que la operación inversa no basta.
 */
export class DeleteObjectCmd implements Command {
  readonly id = 'delete-object';
  readonly label = 'Borrar imagen';
  private before: Uint8Array<ArrayBuffer> | null = null;

  constructor(readonly pageIndex: number, readonly objIndex: number) {}

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    c.engine.deleteObject(c.doc, this.pageIndex, this.objIndex);
    c.refresh();
  }

  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
