import type { Command, Ctx } from './Command';
import { sinPaginaBorrada } from '../outline/arbol';

/**
 * Elimina una página; deshacer por snapshot (restaura el documento previo, outline incluido).
 * Los marcadores que apuntaban a la página borrada se quitan EN ESTE MISMO comando (E-071): un
 * destino huérfano acabaría como «acción no soportada» y bloquearía la edición de marcadores.
 */
export class DeletePageCmd implements Command {
  readonly id = 'delete-page';
  readonly label = 'Eliminar página';
  private before: Uint8Array<ArrayBuffer> | null = null;
  constructor(readonly pageIndex: number) {}

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    // El outline se lee ANTES de borrar: después el destino de esa página ya no se resuelve.
    const outlineAntes = c.engine.getOutline(c.doc);
    c.engine.deletePage(c.doc, this.pageIndex);
    const outlineNuevo = sinPaginaBorrada(outlineAntes, this.pageIndex);
    if (outlineNuevo) c.engine.setOutline(c.doc, outlineNuevo);
    c.refresh();
    if (outlineNuevo) c.refreshOutline();
  }
  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
