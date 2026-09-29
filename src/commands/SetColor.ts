import type { Command, Ctx } from './Command';

/** Cambia el color de un run. Deshacer restaura el color previo (operación inversa). */
export class SetColorCmd implements Command {
  readonly id = 'set-color';
  readonly label = 'Color del texto';

  constructor(
    readonly pageIndex: number,
    readonly runId: number,
    readonly newColor: [number, number, number],
    readonly oldColor: [number, number, number]
  ) {}

  private aplicar(c: Ctx, color: [number, number, number]): void {
    c.engine.setRunColor(c.doc, this.pageIndex, this.runId, color);
    c.refreshPage(this.pageIndex);
  }

  execute(c: Ctx): void { this.aplicar(c, this.newColor); }
  undo(c: Ctx): void { this.aplicar(c, this.oldColor); }
}
