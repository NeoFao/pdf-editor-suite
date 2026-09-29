import type { Command, Ctx } from './Command';

/** Rota una página; deshacer = rotar por el delta inverso (sin snapshot). */
export class RotatePageCmd implements Command {
  readonly id = 'rotate-page';
  readonly label = 'Rotar página';
  constructor(readonly pageIndex: number, readonly deltaDeg: number) {}

  execute(c: Ctx): void { c.engine.rotatePage(c.doc, this.pageIndex, this.deltaDeg); c.refreshPage(this.pageIndex); }
  undo(c: Ctx): void { c.engine.rotatePage(c.doc, this.pageIndex, -this.deltaDeg); c.refreshPage(this.pageIndex); }
}
