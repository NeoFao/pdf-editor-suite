import type { Command, Ctx } from './Command';

/** Marca/desmarca una casilla AcroForm. Deshacer por operación inversa (el valor contrario). */
export class SetFormCheckedCmd implements Command {
  readonly id = 'set-form-checked';
  readonly label = 'Casilla de formulario';

  constructor(
    readonly pageIndex: number,
    readonly annotIndex: number,
    readonly checked: boolean
  ) {}

  private aplicar(c: Ctx, checked: boolean): void {
    c.engine.setFormChecked(c.doc, this.pageIndex, this.annotIndex, checked);
    c.refresh();
  }

  execute(c: Ctx): void { this.aplicar(c, this.checked); }
  undo(c: Ctx): void { this.aplicar(c, !this.checked); }
}
