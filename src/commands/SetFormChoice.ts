import type { Command, Ctx } from './Command';

/**
 * Fija la selección de un combo o una lista (una o varias etiquetas si la
 * lista es de selección múltiple). Deshacer por operación inversa (guarda la
 * selección previa en execute). Coalescente por (página, campo), igual que
 * `SetFormTextCmd`.
 */
export class SetFormChoiceCmd implements Command {
  readonly id = 'set-form-choice';
  readonly label = 'Campo de elección';
  readonly coalesceKey: string;

  constructor(
    readonly pageIndex: number,
    readonly annotIndex: number,
    readonly newValues: string[],
    readonly oldValues: string[]
  ) {
    this.coalesceKey = `set-form-choice:${pageIndex}:${annotIndex}`;
  }

  private aplicar(c: Ctx, values: string[]): void {
    c.engine.setFormChoice(c.doc, this.pageIndex, this.annotIndex, values);
    c.refreshPage(this.pageIndex);
  }

  execute(c: Ctx): void { this.aplicar(c, this.newValues); }
  undo(c: Ctx): void { this.aplicar(c, this.oldValues); }

  coalesce(prev: Command): Command | null {
    if (prev instanceof SetFormChoiceCmd && prev.pageIndex === this.pageIndex && prev.annotIndex === this.annotIndex) {
      // Fusionado: conserva el oldValues original y aplica el newValues más reciente.
      return new SetFormChoiceCmd(this.pageIndex, this.annotIndex, this.newValues, prev.oldValues);
    }
    return null;
  }
}
