import type { Command, Ctx } from './Command';

/**
 * Escribe el valor de un campo de texto AcroForm. Deshacer por operación
 * inversa (guarda el valor previo en execute). Coalescente por (página, campo)
 * para que varias escrituras seguidas sobre el mismo campo sean un solo paso
 * de deshacer, aunque en la práctica cada una llega desde un solo evento
 * 'change' del input (al perder el foco), no tecla a tecla.
 */
export class SetFormTextCmd implements Command {
  readonly id = 'set-form-text';
  readonly label = 'Campo de formulario';
  readonly coalesceKey: string;

  constructor(
    readonly pageIndex: number,
    readonly annotIndex: number,
    readonly newValue: string,
    readonly oldValue: string
  ) {
    this.coalesceKey = `set-form-text:${pageIndex}:${annotIndex}`;
  }

  private aplicar(c: Ctx, value: string): void {
    c.engine.setFormText(c.doc, this.pageIndex, this.annotIndex, value);
    c.refreshPage(this.pageIndex);
  }

  execute(c: Ctx): void { this.aplicar(c, this.newValue); }
  undo(c: Ctx): void { this.aplicar(c, this.oldValue); }

  coalesce(prev: Command): Command | null {
    if (prev instanceof SetFormTextCmd && prev.pageIndex === this.pageIndex && prev.annotIndex === this.annotIndex) {
      // Fusionado: conserva el oldValue original y aplica el newValue más reciente.
      return new SetFormTextCmd(this.pageIndex, this.annotIndex, this.newValue, prev.oldValue);
    }
    return null;
  }
}
