import type { Command, Ctx } from './Command';

/** Mueve un run por (dxPt, dyPt). Deshacer = mover por el delta inverso (sin snapshot). */
export class MoveRunCmd implements Command {
  readonly id = 'move-run';
  readonly label = 'Mover texto';

  constructor(
    readonly pageIndex: number,
    readonly runId: number,
    readonly dxPt: number,
    readonly dyPt: number
  ) {}

  private aplicar(c: Ctx, dx: number, dy: number): void {
    c.engine.moveRun(c.doc, this.pageIndex, this.runId, dx, dy);
    c.model.setPageRuns(this.pageIndex, c.engine.getPageText(c.doc, this.pageIndex));
  }

  execute(c: Ctx): void { this.aplicar(c, this.dxPt, this.dyPt); }
  undo(c: Ctx): void { this.aplicar(c, -this.dxPt, -this.dyPt); }
}
