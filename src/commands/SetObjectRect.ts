import type { Command, Ctx } from './Command';
import type { RectPt } from '../engine/PdfEngine';

/**
 * Mueve/redimensiona un objeto imagen a un rectángulo dado (marco
 * interactivo del sello/firma insertados, #20/#21 de la tabla de paridad).
 * Deshacer = volver al rect anterior, sin snapshot: `setObjectRect` solo
 * cambia la matriz del objeto existente, no reindexa nada (igual que
 * `MoveRunCmd`/`RotatePageCmd`), así que la operación inversa basta.
 */
export class SetObjectRectCmd implements Command {
  readonly id = 'set-object-rect';
  readonly label = 'Mover/redimensionar imagen';

  constructor(
    readonly pageIndex: number,
    readonly objIndex: number,
    readonly newRect: RectPt,
    readonly oldRect: RectPt
  ) {}

  private aplicar(c: Ctx, rect: RectPt): void {
    c.engine.setObjectRect(c.doc, this.pageIndex, this.objIndex, rect);
    c.refreshPage(this.pageIndex);
  }

  execute(c: Ctx): void { this.aplicar(c, this.newRect); }
  undo(c: Ctx): void { this.aplicar(c, this.oldRect); }
}
