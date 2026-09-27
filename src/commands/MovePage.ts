import type { Command, Ctx } from './Command';

/** Reordena una página; deshacer = mover de vuelta (sin snapshot). */
export class MovePageCmd implements Command {
  readonly id = 'move-page';
  readonly label = 'Reordenar página';
  constructor(readonly fromIndex: number, readonly toIndex: number) {}

  execute(c: Ctx): void { c.engine.movePage(c.doc, this.fromIndex, this.toIndex); c.refresh(); }
  undo(c: Ctx): void { c.engine.movePage(c.doc, this.toIndex, this.fromIndex); c.refresh(); }
}
